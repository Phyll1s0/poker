import { createClient } from "npm:@supabase/supabase-js@2.95.0";
import {
  ONLINE_BIG_BLIND,
  ONLINE_DEFAULT_ACTION_TIME_MS,
  ONLINE_DEFAULT_TIME_BANK_MS,
  ONLINE_MAX_ACTION_TIME_MS,
  ONLINE_MAX_PLAYERS,
  ONLINE_MAX_STARTING_STACK,
  ONLINE_MAX_TIME_BANK_MS,
  ONLINE_MIN_ACTION_TIME_MS,
  ONLINE_MIN_STARTING_STACK,
  applyOnlinePokerCommand,
  bestOnlineHand,
  createOnlineRoom,
  projectRoomState,
  type OnlineActor,
  type OnlinePokerCommand,
  type OnlinePokerErrorCode,
  type OnlinePublicRoomState,
  type OnlineRoomState,
} from "./online-poker.ts";
import {
  MULTIPLAYER_CHAT_MESSAGE_LIMIT,
  MultiplayerChatValidationError,
  normalizeMultiplayerChatMessage,
  type MultiplayerChatMessage,
} from "./multiplayer-chat.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ROOM_TTL_MS = 24 * 60 * 60 * 1000;
const GUEST_TTL_MS = 180 * 24 * 60 * 60 * 1000;
const JOIN_CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const INVISIBLE_CHARACTERS = /[\p{Cc}\p{Cf}]/gu;
const WHITESPACE = /\s+/gu;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOKEN_PATTERN = /^([0-9a-f-]{36})\.([A-Za-z0-9_-]{40,60})$/;
const COMMAND_ID_PATTERN = /^[a-zA-Z0-9._:-]{8,128}$/;
const ACTIONS = new Set(["fold", "check", "call", "raise"]);
const ALLOWED_ORIGINS = new Set([
  "https://rangecraft-poker-trainer.pigstd.chatgpt.site",
  "https://poker.phyll1s0.com",
  "https://phyll1s0.com",
  "https://phyll1s0.github.io",
]);

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  throw new Error("Supabase runtime configuration is unavailable.");
}

const database = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

type JsonObject = Record<string, unknown>;

type GuestRow = {
  id: string;
  handle: string;
  token_hash: string;
  created_at: string;
  expires_at: string;
};

type RoomRow = {
  id: string;
  join_code: string;
  owner_guest_id: string | null;
  name: string;
  status: "lobby" | "playing" | "closed";
  max_players: number;
  revision: number;
  state: OnlineRoomState;
  hand_no: number;
  created_at: string;
  updated_at: string;
  expires_at: string;
};

type RoomMessageRow = {
  id: number | string;
  room_id?: string;
  guest_id?: string;
  request_id?: string;
  author_seat: number;
  author_handle: string;
  kind: "text" | "reaction";
  body: string;
  created_at: string;
};

type AppendRoomMessageResult = {
  message?: {
    id?: unknown;
    seat?: unknown;
    handle?: unknown;
    kind?: unknown;
    content?: unknown;
    createdAt?: unknown;
  };
  duplicate?: unknown;
  conflict?: unknown;
};

type ReadMemberRoomResult = {
  rateLimited?: unknown;
  room?: unknown;
};

type PollMemberRoomResult = ReadMemberRoomResult & {
  unchanged?: unknown;
};

type ClientCard = {
  rank: string;
  suit: "♠" | "♥" | "♦" | "♣";
};

type ClientPlayer = {
  accountId: string;
  handle: string;
  seat: number;
  stack: number;
  committed: number;
  streetCommitted: number;
  status: "waiting" | "active" | "folded" | "all-in" | "out";
  ready: boolean;
  timeBankMs: number;
  aiAssistsRemaining: number;
  isOwner: boolean;
  isDealer: boolean;
  shown: boolean;
  privatelyPeeked: boolean;
  holeCards?: ClientCard[];
  holeCardCount: number;
};

class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

function requestOrigin(request: Request): string | null {
  const origin = request.headers.get("origin");
  if (!origin) return null;
  if (ALLOWED_ORIGINS.has(origin)) return origin;
  try {
    const url = new URL(origin);
    if ((url.hostname === "localhost" || url.hostname === "127.0.0.1") && url.protocol === "http:") {
      return origin;
    }
  } catch {
    return null;
  }
  return null;
}

function corsHeaders(request: Request): HeadersInit {
  const origin = requestOrigin(request);
  return {
    ...(origin ? { "Access-Control-Allow-Origin": origin } : {}),
    "Access-Control-Allow-Headers": "authorization, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Cache-Control": "private, no-store, max-age=0",
    "Content-Type": "application/json; charset=utf-8",
    "Pragma": "no-cache",
    "Vary": "Origin",
  };
}

function jsonResponse(request: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders(request) });
}

function emptyResponse(request: Request): Response {
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}

function fail(request: Request, error: unknown): Response {
  if (error instanceof ApiError) {
    return jsonResponse(request, { error: error.code, message: error.message }, error.status);
  }
  console.error(error);
  return jsonResponse(request, {
    error: "INTERNAL_ERROR",
    message: "牌桌服务暂时不可用，请稍后重试。",
  }, 500);
}

async function readPayload(request: Request): Promise<JsonObject> {
  if (request.method !== "POST") {
    throw new ApiError(405, "METHOD_NOT_ALLOWED", "只支持 POST 请求。");
  }
  const origin = request.headers.get("origin");
  if (origin && !requestOrigin(request)) {
    throw new ApiError(403, "ORIGIN_NOT_ALLOWED", "当前网页来源不能访问牌桌服务。");
  }
  if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
    throw new ApiError(415, "JSON_REQUIRED", "请求必须使用 JSON 格式。");
  }
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > 12_000) {
    throw new ApiError(413, "PAYLOAD_TOO_LARGE", "请求内容过大。");
  }
  const text = await request.text();
  if (text.length > 12_000) throw new ApiError(413, "PAYLOAD_TOO_LARGE", "请求内容过大。");
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new ApiError(400, "INVALID_JSON", "请求内容不是有效 JSON。");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiError(400, "INVALID_JSON", "请求内容必须是 JSON 对象。");
  }
  return value as JsonObject;
}

function normalizeVisibleText(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.normalize("NFKC").replace(INVISIBLE_CHARACTERS, "").replace(WHITESPACE, " ").trim();
}

function normalizeHandle(value: unknown): { handle: string; handleKey: string } {
  const handle = normalizeVisibleText(value);
  const length = Array.from(handle).length;
  if (length < 2 || length > 16) {
    throw new ApiError(400, "INVALID_HANDLE", "昵称需要 2–16 个可见字符。");
  }
  return { handle, handleKey: handle.toLocaleLowerCase("en-US") };
}

function normalizeRoomName(value: unknown): string {
  const name = normalizeVisibleText(value) || "朋友练习桌";
  if (Array.from(name).length > 40) {
    throw new ApiError(400, "INVALID_ROOM", "房间名称最多 40 个字符。");
  }
  return name;
}

function normalizeMaxPlayers(value: unknown): number {
  if (!Number.isInteger(value) || Number(value) < 2 || Number(value) > ONLINE_MAX_PLAYERS) {
    throw new ApiError(400, "INVALID_ROOM", `房间人数需要是 2–${ONLINE_MAX_PLAYERS}。`);
  }
  return Number(value);
}

function normalizeRoomSettings(payload: JsonObject): {
  tableMode: "cash" | "tournament";
  startingStack: number;
  actionTimeMs: number;
  initialTimeBankMs: number;
  aiAssistLimit: 0 | 5 | 10;
} {
  const tableMode = payload.tableMode ?? "cash";
  if (tableMode !== "cash" && tableMode !== "tournament") {
    throw new ApiError(400, "INVALID_ROOM", "牌局模式不正确。");
  }
  const startingStack = payload.startingStack ?? ONLINE_BIG_BLIND * 100;
  if (
    !Number.isInteger(startingStack)
    || Number(startingStack) < ONLINE_MIN_STARTING_STACK
    || Number(startingStack) > ONLINE_MAX_STARTING_STACK
    || Number(startingStack) % ONLINE_BIG_BLIND !== 0
  ) {
    throw new ApiError(400, "INVALID_ROOM", "起始筹码需要是 200–10000，并且是 10 的倍数。");
  }
  const actionTimeMs = payload.actionSeconds === undefined
    ? ONLINE_DEFAULT_ACTION_TIME_MS
    : Number(payload.actionSeconds) * 1_000;
  if (!Number.isInteger(actionTimeMs) || actionTimeMs < ONLINE_MIN_ACTION_TIME_MS || actionTimeMs > ONLINE_MAX_ACTION_TIME_MS) {
    throw new ApiError(400, "INVALID_ROOM", "每次行动时间需要是 5–60 秒。");
  }
  const initialTimeBankMs = payload.timeBankSeconds === undefined
    ? ONLINE_DEFAULT_TIME_BANK_MS
    : Number(payload.timeBankSeconds) * 1_000;
  if (!Number.isInteger(initialTimeBankMs) || initialTimeBankMs < 0 || initialTimeBankMs > ONLINE_MAX_TIME_BANK_MS) {
    throw new ApiError(400, "INVALID_ROOM", "整局时间库需要是 0–600 秒。");
  }
  const aiAssistLimit = payload.aiAssistLimit ?? 5;
  if (aiAssistLimit !== 0 && aiAssistLimit !== 5 && aiAssistLimit !== 10) {
    throw new ApiError(400, "INVALID_ROOM", "AI 辅助次数需要是 0、5 或 10。");
  }
  return {
    tableMode,
    startingStack: Number(startingStack),
    actionTimeMs,
    initialTimeBankMs,
    aiAssistLimit,
  };
}

function normalizeJoinCode(value: unknown): string {
  if (typeof value !== "string") throw new ApiError(400, "ROOM_NOT_FOUND", "邀请码格式不正确。");
  const code = value.normalize("NFKC").replace(/[\s-]+/gu, "").toUpperCase();
  if (code.length !== 8 || !Array.from(code).every((character) => JOIN_CODE_ALPHABET.includes(character))) {
    throw new ApiError(400, "ROOM_NOT_FOUND", "邀请码格式不正确。");
  }
  return code;
}

function randomJoinCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (byte) => JOIN_CODE_ALPHABET[byte % JOIN_CODE_ALPHABET.length]).join("");
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function databaseFailure(error: { message?: string; code?: string } | null, fallback: string): never {
  console.error(error);
  throw new ApiError(500, "DATABASE_ERROR", fallback);
}

async function consumeRateLimit(key: string, limit: number, windowSeconds: number): Promise<void> {
  const { data, error } = await database.rpc("poker_consume_rate_limit", {
    p_key: key,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  });
  if (error) databaseFailure(error, "暂时无法检查请求频率。");
  if (data !== true) throw new ApiError(429, "RATE_LIMITED", "操作太频繁，请稍后再试。");
}

async function registerGuest(request: Request, payload: JsonObject): Promise<Response> {
  const { handle, handleKey } = normalizeHandle(payload.handle);
  const ip = (request.headers.get("x-forwarded-for") ?? request.headers.get("cf-connecting-ip") ?? "unknown")
    .split(",")[0].trim();
  await consumeRateLimit(`register:${await sha256Hex(ip)}`, 20, 3600);

  const id = crypto.randomUUID();
  const secret = base64Url(crypto.getRandomValues(new Uint8Array(32)));
  const token = `${id}.${secret}`;
  const tokenHash = await sha256Hex(token);
  const expiresAt = new Date(Date.now() + GUEST_TTL_MS).toISOString();
  const { data, error } = await database.from("poker_guests").insert({
    id,
    handle,
    handle_key: handleKey,
    token_hash: tokenHash,
    expires_at: expiresAt,
  }).select("id, handle, created_at, expires_at").single();

  if (error?.code === "23505") {
    throw new ApiError(409, "HANDLE_TAKEN", "这个昵称已经有人使用，换一个试试。");
  }
  if (error || !data) databaseFailure(error, "昵称保存失败，请稍后重试。");
  return jsonResponse(request, {
    token,
    account: { id: data.id, handle: data.handle, avatarSeed: data.id },
  }, 201);
}

async function authenticate(request: Request): Promise<GuestRow> {
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  const match = TOKEN_PATTERN.exec(token);
  if (!match || !UUID_PATTERN.test(match[1])) {
    throw new ApiError(401, "UNAUTHENTICATED", "请先输入牌桌昵称。");
  }
  const tokenHash = await sha256Hex(token);
  const { data, error } = await database.from("poker_guests")
    .select("id, handle, token_hash, created_at, expires_at")
    .eq("id", match[1])
    .eq("token_hash", tokenHash)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (error) databaseFailure(error, "无法验证牌手身份。");
  if (!data) throw new ApiError(401, "UNAUTHENTICATED", "牌手身份已失效，请重新输入昵称。");
  return data as GuestRow;
}

function publicSeatId(seat: number): string {
  return `seat:${seat}`;
}

function clientCard(card: { rank: number; suit: string | number }): ClientCard {
  const ranks: Record<number, string> = { 14: "A", 13: "K", 12: "Q", 11: "J" };
  const suits = ["♠", "♥", "♦", "♣"] as const;
  const suit = typeof card.suit === "number" ? suits[card.suit] : card.suit;
  if (!suit || !suits.includes(suit as (typeof suits)[number])) throw new Error("Invalid card suit.");
  return { rank: ranks[card.rank] ?? String(card.rank), suit: suit as ClientCard["suit"] };
}

function clientPlayers(table: OnlinePublicRoomState): ClientPlayer[] {
  return table.seats.map((seat) => {
    let status: ClientPlayer["status"] = table.hand ? "active" : "waiting";
    if (seat.folded) status = "folded";
    else if (table.hand && seat.stack === 0) status = "all-in";
    else if (!table.hand && seat.stack === 0) status = "out";
    return {
      accountId: publicSeatId(seat.seat),
      handle: seat.displayName,
      seat: seat.seat,
      stack: seat.stack,
      committed: seat.contributed,
      streetCommitted: seat.bet,
      status,
      ready: seat.ready,
      timeBankMs: seat.timeBankMs,
      aiAssistsRemaining: seat.aiAssistsRemaining,
      isOwner: seat.seat === table.ownerSeat,
      isDealer: seat.seat === table.hand?.dealerSeat,
      shown: seat.shown,
      privatelyPeeked: seat.privatelyPeeked,
      ...(seat.holeCards ? { holeCards: seat.holeCards.map(clientCard) } : {}),
      holeCardCount: seat.holeCardCount,
    };
  });
}

function stateStatus(state: OnlineRoomState): RoomRow["status"] {
  if (state.phase === "lobby") return "lobby";
  if (state.phase === "closed") return "closed";
  return "playing";
}

function roomSummary(row: RoomRow, memberCount: number, ownerAccountId = "private") {
  return {
    id: row.id,
    name: row.name,
    joinCode: row.join_code,
    ownerAccountId,
    status: row.state?.phase === "finished" ? "finished" as const : row.status,
    maxPlayers: row.max_players,
    memberCount,
    revision: Number(row.revision),
  };
}

function makeSnapshot(row: RoomRow, state: OnlineRoomState, guestId: string) {
  const table = projectRoomState(state, guestId);
  const players = clientPlayers(table);
  const selfAccountId = table.viewerSeat === null ? "departed" : publicSeatId(table.viewerSeat);
  const publicOwnerId = table.ownerSeat === null ? "departed" : publicSeatId(table.ownerSeat);
  const hand = table.hand;
  const game = hand ? (() => {
    const result = hand.result;
    const gamePlayers = result
      ? [
          ...players,
          ...result.winnerDetails.flatMap((winner) => {
            if (players.some((player) => player.seat === winner.seat)) return [];
            return [{
              accountId: publicSeatId(winner.seat),
              handle: winner.displayName,
              seat: winner.seat,
              stack: 0,
              committed: 0,
              streetCommitted: 0,
              status: "out" as const,
              ready: false,
              timeBankMs: 0,
              aiAssistsRemaining: 0,
              isOwner: false,
              isDealer: winner.seat === hand.dealerSeat,
              shown: Boolean(winner.holeCards),
              privatelyPeeked: false,
              ...(winner.holeCards ? { holeCards: winner.holeCards.map(clientCard) } : {}),
              holeCardCount: 2,
            }];
          }),
        ]
      : players;
    const resultSummary = result
      ? [
          ...result.payouts.map((payout) => {
            const player = gamePlayers.find((candidate) => candidate.seat === payout.seat);
            const handName = result.handNames.find((entry) => entry.seat === payout.seat)?.name;
            return `${player?.handle ?? `座位 ${payout.seat + 1}`}${handName ? `（${handName}）` : ""} 赢得 ${payout.amount}`;
          }),
          ...result.returns.map((entry) => {
            const player = gamePlayers.find((candidate) => candidate.seat === entry.seat);
            return `${player?.handle ?? `座位 ${entry.seat + 1}`} 收回未跟注 ${entry.amount}`;
          }),
        ].join("；")
      : null;
    const winningHands = result
      ? result.winnerSeats.flatMap((seat) => {
          const detail = result.winnerDetails.find((candidate) => candidate.seat === seat);
          const winner = gamePlayers.find((candidate) => candidate.seat === seat);
          // winnerDetails is already the public-safe projection. Never derive
          // this payload from private engine state or the viewer's own cards.
          if (!detail?.holeCards || !winner || hand.community.length + detail.holeCards.length < 5) return [];
          const best = bestOnlineHand([...hand.community, ...detail.holeCards]);
          return [{
            accountId: winner.accountId,
            handName: best.name,
            cards: best.cards.map(clientCard),
          }];
        })
      : [];
    return {
      handId: hand.id,
      handNo: hand.number,
      street: result ? "complete" : table.phase === "showdown" ? "showdown" : table.phase === "between_hands" ? "complete" : hand.street,
      pot: result?.totalPot ?? hand.committedPot,
      board: hand.community.map(clientCard),
      dealerSeat: hand.dealerSeat,
      actorAccountId: hand.currentSeat === null ? null : publicSeatId(hand.currentSeat),
      currentBet: hand.highestBet,
      actionStartedAt: hand.actionStartedAt,
      actionDeadlineAt: hand.actionDeadlineAt,
      actionSeq: hand.actionSeq,
      recentActions: hand.recentActions.map((event) => ({
        seq: event.seq,
        accountId: publicSeatId(event.seat),
        seat: event.seat,
        street: event.street,
        action: event.action,
        amount: event.amount,
        toAmount: event.toAmount,
        raiseTo: event.raiseTo,
        potAfter: event.potAfter,
        stackAfter: event.stackAfter,
        timedOut: event.timedOut,
        occurredAt: event.occurredAt,
      })),
      players: gamePlayers,
      privatePeekTargets: (hand.privatePeekTargets ?? []).map((target) => ({
        seat: target.seat,
        handle: target.displayName,
        shown: target.shown,
        privatelyPeeked: target.privatelyPeeked,
        waitingForShowDecision: target.waitingForShowDecision,
        ...(target.holeCards ? { holeCards: target.holeCards.map(clientCard) } : {}),
      })),
      legalActions: table.legalActions ? {
        fold: table.legalActions.fold,
        check: table.legalActions.check,
        callAmount: table.legalActions.callAmount,
        minRaiseTo: table.legalActions.raise?.minRaiseTo ?? null,
        maxRaiseTo: table.legalActions.raise?.maxRaiseTo ?? null,
        raiseAllInOnly: table.legalActions.raise?.allInOnly ?? false,
      } : null,
      result: result ? {
        summary: resultSummary || "本手已经结束。",
        winners: result.winnerSeats.flatMap((seat) => {
          const winner = gamePlayers.find((candidate) => candidate.seat === seat);
          return winner ? [winner.accountId] : [];
        }),
        winningHands,
      } : null,
    };
  })() : null;

  return {
    room: roomSummary(
      { ...row, status: stateStatus(state), revision: state.revision, state },
      state.seats.filter((seat) => !seat.pendingLeave).length,
      publicOwnerId,
    ),
    selfAccountId,
    players,
    game,
    table,
  };
}

async function memberRoom(roomId: string, guestId: string): Promise<RoomRow> {
  if (!UUID_PATTERN.test(roomId)) throw new ApiError(404, "ROOM_NOT_FOUND", "没有找到这个房间。");
  const { data: member, error: memberError } = await database.from("poker_room_members")
    .select("room_id")
    .eq("room_id", roomId)
    .eq("guest_id", guestId)
    .maybeSingle();
  if (memberError) databaseFailure(memberError, "无法读取房间成员。");
  if (!member) throw new ApiError(404, "ROOM_NOT_FOUND", "没有找到这个房间。");
  const { data, error } = await database.from("poker_rooms")
    .select("*")
    .eq("id", roomId)
    .neq("status", "closed")
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (error) databaseFailure(error, "无法读取牌桌。");
  if (!data) throw new ApiError(404, "ROOM_NOT_FOUND", "没有找到这个房间。");
  return data as RoomRow;
}

async function rateLimitedMemberRoom(
  roomId: string,
  guestId: string,
  rateKey: string,
  limit: number,
  windowSeconds: number,
): Promise<RoomRow> {
  if (!UUID_PATTERN.test(roomId)) throw new ApiError(404, "ROOM_NOT_FOUND", "没有找到这个房间。");
  const { data, error } = await database.rpc("poker_read_member_room", {
    p_room_id: roomId,
    p_guest_id: guestId,
    p_rate_key: rateKey,
    p_rate_limit: limit,
    p_rate_window_seconds: windowSeconds,
  });
  if (error) databaseFailure(error, "无法读取牌桌。");
  const result = (data ?? {}) as ReadMemberRoomResult;
  if (result.rateLimited === true) {
    throw new ApiError(429, "RATE_LIMITED", "操作太频繁，请稍后再试。");
  }
  if (!result.room || typeof result.room !== "object" || Array.isArray(result.room)) {
    throw new ApiError(404, "ROOM_NOT_FOUND", "没有找到这个房间。");
  }
  return result.room as RoomRow;
}

async function rateLimitedRoomPoll(
  roomId: string,
  guestId: string,
  afterRevision: number | null,
): Promise<RoomRow | null> {
  if (!UUID_PATTERN.test(roomId)) throw new ApiError(404, "ROOM_NOT_FOUND", "没有找到这个房间。");
  const { data, error } = await database.rpc("poker_poll_member_room", {
    p_room_id: roomId,
    p_guest_id: guestId,
    p_rate_key: `state:${guestId}`,
    p_rate_limit: 360,
    p_rate_window_seconds: 60,
    p_after_revision: afterRevision,
  });
  if (error) databaseFailure(error, "无法读取牌桌。");
  const result = (data ?? {}) as PollMemberRoomResult;
  if (result.rateLimited === true) {
    throw new ApiError(429, "RATE_LIMITED", "操作太频繁，请稍后再试。");
  }
  if (result.unchanged === true) return null;
  if (!result.room || typeof result.room !== "object" || Array.isArray(result.room)) {
    throw new ApiError(404, "ROOM_NOT_FOUND", "没有找到这个房间。");
  }
  return result.room as RoomRow;
}

function publicRoomMessage(row: RoomMessageRow): MultiplayerChatMessage {
  const createdAt = Date.parse(row.created_at);
  if (
    !/^[1-9][0-9]{0,18}$/.test(String(row.id))
    || !Number.isInteger(row.author_seat)
    || row.author_seat < 0
    || row.author_seat >= ONLINE_MAX_PLAYERS
    || typeof row.author_handle !== "string"
    || (row.kind !== "text" && row.kind !== "reaction")
    || typeof row.body !== "string"
    || !Number.isFinite(createdAt)
  ) {
    throw new ApiError(500, "DATABASE_ERROR", "牌桌消息格式不正确。");
  }
  return {
    id: String(row.id),
    seat: row.author_seat,
    handle: row.author_handle,
    kind: row.kind,
    content: row.body,
    createdAt,
  };
}

function publicRpcRoomMessage(value: AppendRoomMessageResult["message"]): MultiplayerChatMessage {
  if (!value) throw new ApiError(500, "DATABASE_ERROR", "牌桌消息没有正确保存。");
  if (value.kind !== "text" && value.kind !== "reaction") {
    throw new ApiError(500, "DATABASE_ERROR", "牌桌消息格式不正确。");
  }
  return publicRoomMessage({
    id: typeof value.id === "string" || typeof value.id === "number" ? value.id : "",
    author_seat: Number(value.seat),
    author_handle: typeof value.handle === "string" ? value.handle : "",
    kind: value.kind,
    body: typeof value.content === "string" ? value.content : "",
    created_at: typeof value.createdAt === "string" ? value.createdAt : "",
  });
}

function messageCursor(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !/^[1-9][0-9]{0,18}$/.test(value)) {
    throw new ApiError(400, "INVALID_MESSAGE_CURSOR", "消息游标格式不正确。");
  }
  const maxBigint = "9223372036854775807";
  if (value.length === maxBigint.length && value > maxBigint) {
    throw new ApiError(400, "INVALID_MESSAGE_CURSOR", "消息游标格式不正确。");
  }
  return value;
}

async function listRoomMessages(guest: GuestRow, payload: JsonObject) {
  const roomId = requiredString(payload.roomId, "roomId", 64);
  await memberRoom(roomId, guest.id);
  await consumeRateLimit(`chat-read:${roomId}:${guest.id}`, 180, 60);
  const after = messageCursor(payload.afterMessageId);
  const columns = "id, author_seat, author_handle, kind, body, created_at";

  if (after) {
    const { data, error } = await database.from("poker_room_messages")
      .select(columns)
      .eq("room_id", roomId)
      .gt("id", after)
      .order("id", { ascending: true })
      .limit(MULTIPLAYER_CHAT_MESSAGE_LIMIT);
    if (error) databaseFailure(error, "无法读取牌桌消息。");
    return { messages: (data ?? []).map((row) => publicRoomMessage(row as RoomMessageRow)) };
  }

  const { data, error } = await database.from("poker_room_messages")
    .select(columns)
    .eq("room_id", roomId)
    .order("id", { ascending: false })
    .limit(MULTIPLAYER_CHAT_MESSAGE_LIMIT);
  if (error) databaseFailure(error, "无法读取牌桌消息。");
  return {
    messages: (data ?? [])
      .map((row) => publicRoomMessage(row as RoomMessageRow))
      .reverse(),
  };
}

async function sendRoomMessage(guest: GuestRow, payload: JsonObject) {
  const roomId = requiredString(payload.roomId, "roomId", 64);
  const requestId = requiredString(payload.requestId, "requestId");
  if (!COMMAND_ID_PATTERN.test(requestId)) {
    throw new ApiError(400, "INVALID_MESSAGE", "消息编号格式不正确。");
  }
  await memberRoom(roomId, guest.id);

  let normalized: ReturnType<typeof normalizeMultiplayerChatMessage>;
  try {
    normalized = normalizeMultiplayerChatMessage(payload.kind, payload.content);
  } catch (error) {
    if (error instanceof MultiplayerChatValidationError) {
      throw new ApiError(400, error.code, error.message);
    }
    throw error;
  }

  const { data: existing, error: existingError } = await database.from("poker_room_messages")
    .select("id, author_seat, author_handle, kind, body, created_at")
    .eq("room_id", roomId)
    .eq("guest_id", guest.id)
    .eq("request_id", requestId)
    .maybeSingle();
  if (existingError) databaseFailure(existingError, "无法检查牌桌消息。");
  if (existing) {
    const existingRow = existing as RoomMessageRow;
    if (existingRow.kind !== normalized.kind || existingRow.body !== normalized.content) {
      throw new ApiError(409, "MESSAGE_ID_CONFLICT", "这条消息编号已经用于其他内容。");
    }
    return { message: publicRoomMessage(existingRow), duplicate: true };
  }

  await consumeRateLimit(`chat-burst:${roomId}:${guest.id}`, 6, 10);
  await consumeRateLimit(`chat-user:${roomId}:${guest.id}`, 30, 60);
  await consumeRateLimit(`chat-room:${roomId}`, 120, 60);

  const { data, error } = await database.rpc("poker_append_room_message", {
    p_room_id: roomId,
    p_guest_id: guest.id,
    p_request_id: requestId,
    p_kind: normalized.kind,
    p_body: normalized.content,
  });
  if (error) databaseFailure(error, "发送牌桌消息失败。");
  const result = (data ?? {}) as AppendRoomMessageResult;
  if (result.conflict === true) {
    throw new ApiError(409, "MESSAGE_ID_CONFLICT", "这条消息编号已经用于其他内容。");
  }
  return {
    message: publicRpcRoomMessage(result.message),
    duplicate: result.duplicate === true,
  };
}

async function listRooms(guest: GuestRow) {
  const { data: memberships, error: memberError } = await database.from("poker_room_members")
    .select("room_id")
    .eq("guest_id", guest.id)
    .order("joined_at", { ascending: false })
    .limit(50);
  if (memberError) databaseFailure(memberError, "无法读取房间列表。");
  const roomIds = (memberships ?? []).map((entry) => entry.room_id as string);
  if (!roomIds.length) return [];
  const { data: rooms, error: roomError } = await database.from("poker_rooms")
    .select("*")
    .in("id", roomIds)
    .neq("status", "closed")
    .gt("expires_at", new Date().toISOString())
    .order("updated_at", { ascending: false });
  if (roomError) databaseFailure(roomError, "无法读取房间列表。");
  const { data: allMembers, error: countError } = await database.from("poker_room_members")
    .select("room_id")
    .in("room_id", roomIds);
  if (countError) databaseFailure(countError, "无法读取房间人数。");
  const counts = new Map<string, number>();
  for (const member of allMembers ?? []) counts.set(member.room_id, (counts.get(member.room_id) ?? 0) + 1);
  return (rooms ?? []).map((room) => roomSummary(room as RoomRow, counts.get(room.id) ?? 0));
}

async function createRoom(guest: GuestRow, payload: JsonObject) {
  const name = normalizeRoomName(payload.name);
  const maxPlayers = normalizeMaxPlayers(payload.maxPlayers);
  const settings = normalizeRoomSettings(payload);
  await consumeRateLimit(`create:${guest.id}`, 12, 3600);
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const roomId = crypto.randomUUID();
    const joinCode = randomJoinCode();
    const state = createOnlineRoom({
      roomId,
      owner: { accountId: guest.id, displayName: guest.handle },
      maxPlayers,
      ...settings,
    });
    const expiresAt = new Date(Date.now() + ROOM_TTL_MS).toISOString();
    const { data, error } = await database.rpc("poker_create_room", {
      p_room_id: roomId,
      p_join_code: joinCode,
      p_owner_guest_id: guest.id,
      p_name: name,
      p_max_players: maxPlayers,
      p_state: state,
      p_expires_at: expiresAt,
    });
    if (!error && data === true) {
      const row: RoomRow = {
        id: roomId, join_code: joinCode, owner_guest_id: guest.id, name,
        status: "lobby", max_players: maxPlayers, revision: 0, state,
        hand_no: 0, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), expires_at: expiresAt,
      };
      return roomSummary(row, 1);
    }
    if (error?.code !== "23505") databaseFailure(error, "创建房间失败，请稍后重试。");
  }
  throw new ApiError(503, "ROOM_CODE_UNAVAILABLE", "暂时无法生成邀请码，请稍后重试。");
}

async function joinRoom(guest: GuestRow, payload: JsonObject) {
  const joinCode = normalizeJoinCode(payload.joinCode);
  await consumeRateLimit(`join:${guest.id}`, 40, 3600);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const { data, error } = await database.from("poker_rooms")
      .select("*")
      .eq("join_code", joinCode)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();
    if (error) databaseFailure(error, "无法查找房间。");
    if (!data) throw new ApiError(404, "ROOM_NOT_FOUND", "没有找到这个房间，请检查邀请码。");
    const room = data as RoomRow;
    const state = room.state as OnlineRoomState;
    if (state.seats.some((seat) => seat.accountId === guest.id && !seat.pendingLeave)) {
      return roomSummary(room, state.seats.filter((seat) => !seat.pendingLeave).length);
    }
    const command: OnlinePokerCommand = {
      type: "join",
      commandId: `join:${crypto.randomUUID()}`,
      expectedRevision: Number(room.revision),
    };
    const result = applyOnlinePokerCommand(state, { accountId: guest.id, displayName: guest.handle }, command);
    if (!result.ok) {
      const status = result.error.code === "ROOM_FULL" ? 409 : 400;
      throw new ApiError(status, result.error.code, result.error.message);
    }
    const committed = await database.rpc("poker_join_room", {
      p_room_id: room.id,
      p_guest_id: guest.id,
      p_expected_revision: Number(room.revision),
      p_next_state: result.state,
    });
    if (committed.error?.code === "23505") continue;
    if (committed.error) databaseFailure(committed.error, "加入房间失败，请稍后重试。");
    if (committed.data === true) {
      return roomSummary(
        { ...room, revision: result.state.revision, state: result.state },
        result.state.seats.filter((seat) => !seat.pendingLeave).length,
      );
    }
  }
  throw new ApiError(409, "REVISION_CONFLICT", "牌桌刚刚发生了变化，请重试。");
}

function requiredString(value: unknown, field: string, maxLength = 128): string {
  if (typeof value !== "string" || !value.trim() || value.length > maxLength) {
    throw new ApiError(400, "INVALID_COMMAND", `${field} 格式不正确。`);
  }
  return value;
}

function parseCommand(payload: JsonObject): Exclude<OnlinePokerCommand, { type: "join" }> {
  const type = requiredString(payload.type, "type", 24);
  const requestId = requiredString(payload.requestId, "requestId");
  if (!COMMAND_ID_PATTERN.test(requestId)) throw new ApiError(400, "INVALID_COMMAND", "requestId 格式不正确。");
  if (!Number.isInteger(payload.expectedRevision) || Number(payload.expectedRevision) < 0) {
    throw new ApiError(400, "INVALID_COMMAND", "expectedRevision 必须是非负整数。");
  }
  const base = { commandId: requestId, expectedRevision: Number(payload.expectedRevision) };
  if (type === "ready") {
    if (typeof payload.ready !== "boolean") throw new ApiError(400, "INVALID_COMMAND", "ready 必须是布尔值。");
    return { ...base, type, ready: payload.ready };
  }
  if (type === "start" || type === "finish" || type === "restart" || type === "leave") {
    return { ...base, type };
  }
  const handId = requiredString(payload.handId, "handId");
  if (type === "use-time-bank" || type === "use-ai-assist" || type === "timeout") {
    return { ...base, type, handId };
  }
  if (type === "show") {
    if (typeof payload.show !== "boolean") throw new ApiError(400, "INVALID_COMMAND", "show 必须是布尔值。");
    return { ...base, type, handId, show: payload.show };
  }
  if (type === "peek") {
    if (!Number.isInteger(payload.targetSeat) || Number(payload.targetSeat) < 0 || Number(payload.targetSeat) >= ONLINE_MAX_PLAYERS) {
      throw new ApiError(400, "INVALID_COMMAND", "targetSeat 必须是有效座位编号。");
    }
    return { ...base, type, handId, targetSeat: Number(payload.targetSeat) };
  }
  if (type === "act") {
    const action = requiredString(payload.pokerAction, "pokerAction", 16);
    if (!ACTIONS.has(action)) throw new ApiError(400, "ILLEGAL_ACTION", "这个行动在当前局面不合法。");
    if (action === "raise") {
      if (!Number.isInteger(payload.raiseTo) || Number(payload.raiseTo) < 1) {
        throw new ApiError(400, "INVALID_RAISE", "加注额必须是正整数。");
      }
      return { ...base, type, handId, action, raiseTo: Number(payload.raiseTo) };
    }
    return { ...base, type, handId, action: action as "fold" | "check" | "call" };
  }
  throw new ApiError(400, "INVALID_COMMAND", "不支持的命令类型。");
}

function engineStatus(code: OnlinePokerErrorCode): number {
  if (code === "STALE_REVISION" || code === "COMMAND_ID_CONFLICT") return 409;
  if (code === "NOT_ROOM_OWNER") return 403;
  if (code === "NOT_A_MEMBER") return 404;
  return 400;
}

async function applyCommand(guest: GuestRow, payload: JsonObject) {
  const roomId = requiredString(payload.roomId, "roomId", 64);
  const command = parseCommand(payload);
  const room = await rateLimitedMemberRoom(roomId, guest.id, `command:${guest.id}`, 240, 60);
  const state = room.state as OnlineRoomState;
  const actor: OnlineActor = { accountId: guest.id, displayName: guest.handle };
  const result = applyOnlinePokerCommand(state, actor, command);
  if (!result.ok) throw new ApiError(engineStatus(result.error.code), result.error.code, result.error.message);
  if (result.duplicate) return makeSnapshot(room, state, guest.id);

  const next = result.state;
  const { data, error } = await database.rpc("poker_commit_room_state", {
    p_room_id: room.id,
    p_guest_id: guest.id,
    p_expected_revision: Number(room.revision),
    p_next_state: next,
    p_status: stateStatus(next),
    p_hand_no: next.hand?.number ?? 0,
    p_new_owner_guest_id: next.ownerAccountId,
    p_remove_member: command.type === "leave",
  });
  if (error) databaseFailure(error, "牌桌行动保存失败。");
  if (data !== true) {
    const latest = await memberRoom(roomId, guest.id);
    const replay = applyOnlinePokerCommand(latest.state as OnlineRoomState, actor, command);
    if (replay.ok && replay.duplicate) return makeSnapshot(latest, latest.state as OnlineRoomState, guest.id);
    throw new ApiError(409, "REVISION_CONFLICT", "牌桌刚刚发生了变化，已为你刷新。");
  }
  return makeSnapshot({
    ...room,
    owner_guest_id: next.ownerAccountId,
    status: stateStatus(next),
    revision: next.revision,
    state: next,
    hand_no: next.hand?.number ?? 0,
    updated_at: new Date().toISOString(),
  }, next, guest.id);
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") {
    if (request.headers.get("origin") && !requestOrigin(request)) {
      return jsonResponse(request, { error: "ORIGIN_NOT_ALLOWED" }, 403);
    }
    return new Response(null, { status: 204, headers: corsHeaders(request) });
  }

  try {
    const payload = await readPayload(request);
    const action = requiredString(payload.action, "action", 32);
    if (action === "register") return await registerGuest(request, payload);

    const guest = await authenticate(request);
    if (action === "account") {
      return jsonResponse(request, { account: { id: guest.id, handle: guest.handle, avatarSeed: guest.id } });
    }
    if (action === "rooms") return jsonResponse(request, { rooms: await listRooms(guest) });
    if (action === "create-room") return jsonResponse(request, { room: await createRoom(guest, payload) }, 201);
    if (action === "join-room") return jsonResponse(request, { room: await joinRoom(guest, payload) });
    if (action === "room-state") {
      const roomId = requiredString(payload.roomId, "roomId", 64);
      let afterRevision: number | null = null;
      if (payload.afterRevision !== undefined) {
        if (
          typeof payload.afterRevision !== "number"
          || !Number.isSafeInteger(payload.afterRevision)
          || payload.afterRevision < 0
        ) {
          throw new ApiError(400, "INVALID_REVISION", "afterRevision 必须是非负整数。");
        }
        afterRevision = payload.afterRevision;
      }
      const room = await rateLimitedRoomPoll(roomId, guest.id, afterRevision);
      if (!room) return emptyResponse(request);
      return jsonResponse(request, makeSnapshot(room, room.state as OnlineRoomState, guest.id));
    }
    if (action === "room-messages") {
      return jsonResponse(request, await listRoomMessages(guest, payload));
    }
    if (action === "send-message") {
      const result = await sendRoomMessage(guest, payload);
      return jsonResponse(request, result, result.duplicate ? 200 : 201);
    }
    if (action === "command") return jsonResponse(request, await applyCommand(guest, payload));
    throw new ApiError(404, "UNKNOWN_ACTION", "不支持的牌桌请求。");
  } catch (error) {
    return fail(request, error);
  }
});
