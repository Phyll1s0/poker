import {
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
  type MultiplayerChatKind,
  type MultiplayerChatMessage,
  type MultiplayerChatSnapshot,
} from "./multiplayer-chat.ts";

export type GameRoomStatus = "lobby" | "playing" | "finished" | "closed";
type StoredGameRoomStatus = Exclude<GameRoomStatus, "finished">;

export type GameRoomSummary = {
  id: string;
  name: string;
  joinCode: string;
  ownerAccountId: string;
  status: GameRoomStatus;
  maxPlayers: number;
  memberCount: number;
  revision: number;
};

export type MultiplayerGameSnapshot = {
  room: GameRoomSummary;
  selfAccountId: string;
  table: OnlinePublicRoomState;
  players: ClientPublicPlayer[];
  game: ClientPublicGame | null;
};

export type ClientCard = {
  rank: string;
  suit: "♠" | "♥" | "♦" | "♣";
};

export type ClientPublicPlayer = {
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
  holeCards?: ClientCard[];
  holeCardCount: number;
};

export type ClientPublicGame = {
  handId: string;
  handNo: number;
  street: "preflop" | "flop" | "turn" | "river" | "showdown" | "complete";
  pot: number;
  board: ClientCard[];
  dealerSeat: number;
  actorAccountId: string | null;
  currentBet: number;
  actionStartedAt: number | null;
  actionDeadlineAt: number | null;
  actionSeq: number;
  recentActions: {
    seq: number;
    accountId: string;
    seat: number;
    street: "preflop" | "flop" | "turn" | "river";
    action: "fold" | "check" | "call" | "raise";
    amount: number | null;
    toAmount: number | null;
    raiseTo: number | null;
    potAfter: number | null;
    stackAfter: number | null;
    timedOut: boolean;
    occurredAt: number;
  }[];
  players: ClientPublicPlayer[];
  legalActions: {
    fold: boolean;
    check: boolean;
    callAmount: number | null;
    minRaiseTo: number | null;
    maxRaiseTo: number | null;
    raiseAllInOnly: boolean;
  } | null;
  result: {
    summary: string;
    winners: string[];
    /** Additive and optional so snapshots from an older server remain readable. */
    winningHands?: {
      accountId: string;
      handName: string;
      cards: ClientCard[];
    }[];
  } | null;
};

export class MultiplayerGameError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "MultiplayerGameError";
    this.status = status;
    this.code = code;
  }
}

type GameRoomRow = {
  id: string;
  name: string;
  join_code: string;
  owner_account_id: string;
  status: StoredGameRoomStatus;
  max_players: number;
  revision: number;
  state_json: string | null;
  member_count: number;
};

type GameMemberRow = {
  account_id: string;
  handle: string;
  seat: number;
};

type GameMessageRow = {
  id: number;
  author_seat: number;
  author_handle: string;
  kind: MultiplayerChatKind;
  body: string;
  created_at: number;
};

type D1Result<T = unknown> = {
  results?: T[];
};

type D1Statement = {
  bind(...values: unknown[]): D1Statement;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<{ results: T[] }>;
};

export type MultiplayerGameDatabase = {
  prepare(sql: string): D1Statement;
  batch(statements: D1Statement[]): Promise<D1Result[]>;
};

type ParsedClientCommand = Exclude<OnlinePokerCommand, { type: "join" }>;

const COMMAND_ID_PATTERN = /^[a-zA-Z0-9._:-]{8,128}$/;
const ACTIONS = new Set(["fold", "check", "call", "raise"]);

export type ParsedMultiplayerRoomMessage = {
  requestId: string;
  kind: MultiplayerChatKind;
  content: string;
};

function requiredString(value: unknown, field: string, maxLength = 128): string {
  if (typeof value !== "string" || !value.trim() || value.length > maxLength) {
    throw new MultiplayerGameError(400, "INVALID_COMMAND", `${field} 格式不正确。`);
  }
  return value;
}

export function parseMultiplayerRoomMessage(payload: Record<string, unknown>): ParsedMultiplayerRoomMessage {
  const requestId = requiredString(payload.requestId, "requestId");
  if (!COMMAND_ID_PATTERN.test(requestId)) {
    throw new MultiplayerGameError(400, "INVALID_MESSAGE", "消息编号格式不正确。");
  }
  try {
    return { requestId, ...normalizeMultiplayerChatMessage(payload.kind, payload.content) };
  } catch (error) {
    if (error instanceof MultiplayerChatValidationError) {
      throw new MultiplayerGameError(400, error.code, error.message);
    }
    throw error;
  }
}

export function parseMultiplayerMessageCursor(value: string | null): number | null {
  if (value === null || value === "") return null;
  if (!/^[1-9][0-9]{0,15}$/.test(value)) {
    throw new MultiplayerGameError(400, "INVALID_MESSAGE_CURSOR", "消息游标格式不正确。");
  }
  const cursor = Number(value);
  if (!Number.isSafeInteger(cursor)) {
    throw new MultiplayerGameError(400, "INVALID_MESSAGE_CURSOR", "消息游标格式不正确。");
  }
  return cursor;
}

export function parseMultiplayerCommand(payload: Record<string, unknown>): ParsedClientCommand {
  const type = requiredString(payload.type, "type", 24);
  const requestId = requiredString(payload.requestId, "requestId");
  if (!COMMAND_ID_PATTERN.test(requestId)) {
    throw new MultiplayerGameError(400, "INVALID_COMMAND", "requestId 格式不正确。");
  }
  const expectedRevision = payload.expectedRevision;
  if (!Number.isInteger(expectedRevision) || Number(expectedRevision) < 0) {
    throw new MultiplayerGameError(400, "INVALID_COMMAND", "expectedRevision 必须是非负整数。" );
  }
  const base = { commandId: requestId, expectedRevision: Number(expectedRevision) };

  if (type === "ready") {
    if (typeof payload.ready !== "boolean") {
      throw new MultiplayerGameError(400, "INVALID_COMMAND", "ready 必须是布尔值。" );
    }
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
    if (typeof payload.show !== "boolean") {
      throw new MultiplayerGameError(400, "INVALID_COMMAND", "show 必须是布尔值。" );
    }
    return { ...base, type, handId, show: payload.show };
  }
  if (type === "act") {
    const action = requiredString(payload.action, "action", 16);
    if (!ACTIONS.has(action)) {
      throw new MultiplayerGameError(400, "INVALID_COMMAND", "action 不合法。" );
    }
    if (action === "raise") {
      if (!Number.isInteger(payload.raiseTo) || Number(payload.raiseTo) < 1) {
        throw new MultiplayerGameError(400, "INVALID_RAISE", "raiseTo 必须是正整数。" );
      }
      return {
        ...base,
        type,
        handId,
        action: "raise",
        raiseTo: Number(payload.raiseTo),
      };
    }
    return {
      ...base,
      type,
      handId,
      action: action as "fold" | "check" | "call",
    };
  }

  throw new MultiplayerGameError(400, "INVALID_COMMAND", "不支持的命令类型。" );
}

function engineErrorStatus(code: OnlinePokerErrorCode): number {
  if (code === "STALE_REVISION" || code === "COMMAND_ID_CONFLICT") return 409;
  if (code === "NOT_ROOM_OWNER") return 403;
  if (code === "NOT_A_MEMBER") return 404;
  return 400;
}

function mapRoom(row: GameRoomRow): GameRoomSummary {
  return {
    id: row.id,
    name: row.name,
    joinCode: row.join_code,
    ownerAccountId: row.owner_account_id,
    status: row.status,
    maxPlayers: row.max_players,
    memberCount: Number(row.member_count),
    revision: row.revision,
  };
}

function parseStoredState(value: string): OnlineRoomState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("The stored multiplayer state is not valid JSON.");
  }
  if (!parsed || typeof parsed !== "object" || !("roomId" in parsed) || !("revision" in parsed)) {
    throw new Error("The stored multiplayer state has an invalid shape.");
  }
  return parsed as OnlineRoomState;
}

function actorFor(member: GameMemberRow): OnlineActor {
  return { accountId: member.account_id, displayName: member.handle };
}

function hydrateRoomState(row: GameRoomRow, members: GameMemberRow[]): OnlineRoomState {
  let state = row.state_json
    ? parseStoredState(row.state_json)
    : (() => {
        const owner = members.find((member) => member.account_id === row.owner_account_id);
        if (!owner) throw new Error("The room owner is not a room member.");
        return createOnlineRoom({
          roomId: row.id,
          owner: actorFor(owner),
          maxPlayers: row.max_players,
        });
      })();

  if (state.roomId !== row.id || state.maxPlayers !== row.max_players) {
    throw new Error("The stored multiplayer state does not match the room record.");
  }

  const sortedMembers = [...members].sort((left, right) => left.seat - right.seat);
  for (const member of sortedMembers) {
    if (state.seats.some((seat) => seat.accountId === member.account_id)) continue;
    const joined = applyOnlinePokerCommand(state, actorFor(member), {
      type: "join",
      commandId: `sync-join:${member.account_id}:${state.revision}`,
      expectedRevision: state.revision,
    });
    if (!joined.ok) throw new Error(`Unable to synchronize room member: ${joined.error.code}`);
    state = joined.state;
  }

  const databaseMembers = new Set(members.map((member) => member.account_id));
  if (state.seats.some((seat) => !databaseMembers.has(seat.accountId) && seat.pendingLeave !== true)) {
    throw new Error("The stored multiplayer state contains an unexpected member.");
  }
  if (state.revision !== row.revision) {
    throw new Error(`Room revision mismatch: state=${state.revision}, row=${row.revision}.`);
  }
  return state;
}

function stateStatus(state: OnlineRoomState): StoredGameRoomStatus {
  if (state.phase === "lobby") return "lobby";
  if (state.phase === "closed") return "closed";
  return "playing";
}

function publicSeatId(seat: number): string {
  return `seat:${seat}`;
}

function clientCard(card: { rank: number; suit: string | number }): ClientCard {
  const ranks: Record<number, string> = { 14: "A", 13: "K", 12: "Q", 11: "J" };
  const numericSuits = ["♠", "♥", "♦", "♣"] as const;
  const suit = typeof card.suit === "number" ? numericSuits[card.suit] : card.suit;
  if (!suit || !numericSuits.includes(suit as (typeof numericSuits)[number])) {
    throw new Error("The stored multiplayer card has an invalid suit.");
  }
  return { rank: ranks[card.rank] ?? String(card.rank), suit: suit as ClientCard["suit"] };
}

function clientPlayers(table: OnlinePublicRoomState): ClientPublicPlayer[] {
  return table.seats.map((seat) => {
    let status: ClientPublicPlayer["status"] = table.hand ? "active" : "waiting";
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
      ...(seat.holeCards ? { holeCards: seat.holeCards.map(clientCard) } : {}),
      holeCardCount: seat.holeCardCount,
    };
  });
}

function clientGame(table: OnlinePublicRoomState, players: ClientPublicPlayer[]): ClientPublicGame | null {
  const hand = table.hand;
  if (!hand) return null;
  const actorAccountId = hand.currentSeat === null
    ? null
    : publicSeatId(hand.currentSeat);
  const legal = table.legalActions;
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
        // Only public showdown cards may enter the best-five payload. In
        // particular, the viewer's own otherwise-visible hole cards do not
        // bypass a winner's decision to muck.
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
    street: result
      ? "complete"
      : table.phase === "showdown"
      ? "showdown"
      : table.phase === "between_hands"
        ? "complete"
        : hand.street,
    pot: result?.totalPot ?? hand.committedPot,
    board: hand.community.map(clientCard),
    dealerSeat: hand.dealerSeat,
    actorAccountId,
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
    legalActions: legal
      ? {
          fold: legal.fold,
          check: legal.check,
          callAmount: legal.callAmount,
          minRaiseTo: legal.raise?.minRaiseTo ?? null,
          maxRaiseTo: legal.raise?.maxRaiseTo ?? null,
          raiseAllInOnly: legal.raise?.allInOnly ?? false,
        }
      : null,
    result: result
      ? {
          summary: resultSummary || "本手已经结束。",
          winners: result.winnerSeats.flatMap((seat) => {
            const winner = gamePlayers.find((candidate) => candidate.seat === seat);
            return winner ? [winner.accountId] : [];
          }),
          winningHands,
        }
      : null,
  };
}

function clientRoomMessage(row: GameMessageRow): MultiplayerChatMessage {
  return {
    id: String(row.id),
    seat: row.author_seat,
    handle: row.author_handle,
    kind: row.kind,
    content: row.body,
    createdAt: row.created_at,
  };
}

export class MultiplayerGameService {
  private readonly database: MultiplayerGameDatabase;

  constructor(database: MultiplayerGameDatabase) {
    this.database = database;
  }

  private async loadRoom(roomId: string, accountId: string) {
    const row = await this.database.prepare(`
      SELECT
        r.id,
        r.name,
        r.join_code,
        r.owner_account_id,
        r.status,
        r.max_players,
        r.revision,
        r.state_json,
        (SELECT count(*) FROM room_members count_members WHERE count_members.room_id = r.id) AS member_count
      FROM rooms r
      JOIN room_members mine ON mine.room_id = r.id AND mine.account_id = ?
      WHERE r.id = ? AND r.status != 'closed' AND r.expires_at > ?
      LIMIT 1
    `).bind(accountId, roomId, Date.now()).first<GameRoomRow>();
    if (!row) {
      throw new MultiplayerGameError(404, "ROOM_NOT_FOUND", "没有找到这个房间。" );
    }
    const members = await this.database.prepare(`
      SELECT members.account_id, accounts.handle, members.seat
      FROM room_members members
      JOIN accounts ON accounts.id = members.account_id
      WHERE members.room_id = ?
      ORDER BY members.seat ASC
    `).bind(roomId).all<GameMemberRow>();
    return { row, members: members.results };
  }

  private makeSnapshot(row: GameRoomRow, state: OnlineRoomState, accountId: string): MultiplayerGameSnapshot {
    const table = projectRoomState(state, accountId);
    const players = clientPlayers(table);
    const selfAccountId = table.viewerSeat === null ? "departed" : publicSeatId(table.viewerSeat);
    const publicOwnerId = table.ownerSeat === null ? "departed" : publicSeatId(table.ownerSeat);
    const room = mapRoom({
        ...row,
        owner_account_id: publicOwnerId,
        status: stateStatus(state),
        revision: state.revision,
        member_count: state.seats.filter((seat) => !seat.pendingLeave).length,
      });
    return {
      room: {
        ...room,
        status: state.phase === "finished" ? "finished" : room.status,
      },
      selfAccountId,
      table,
      players,
      game: clientGame(table, players),
    };
  }

  async getSnapshot(roomId: string, accountId: string): Promise<MultiplayerGameSnapshot> {
    const { row, members } = await this.loadRoom(roomId, accountId);
    const state = hydrateRoomState(row, members);
    return this.makeSnapshot(row, state, accountId);
  }

  async getMessages(
    roomId: string,
    accountId: string,
    afterMessageId: number | null,
  ): Promise<MultiplayerChatSnapshot> {
    await this.loadRoom(roomId, accountId);
    if (afterMessageId !== null) {
      const rows = await this.database.prepare(`
        SELECT id, author_seat, author_handle, kind, body, created_at
        FROM room_messages
        WHERE room_id = ? AND id > ?
        ORDER BY id ASC
        LIMIT ?
      `).bind(roomId, afterMessageId, MULTIPLAYER_CHAT_MESSAGE_LIMIT).all<GameMessageRow>();
      return { messages: rows.results.map(clientRoomMessage) };
    }
    const rows = await this.database.prepare(`
      SELECT id, author_seat, author_handle, kind, body, created_at
      FROM room_messages
      WHERE room_id = ?
      ORDER BY id DESC
      LIMIT ?
    `).bind(roomId, MULTIPLAYER_CHAT_MESSAGE_LIMIT).all<GameMessageRow>();
    return { messages: rows.results.map(clientRoomMessage).reverse() };
  }

  async sendMessage(
    roomId: string,
    accountId: string,
    message: ParsedMultiplayerRoomMessage,
  ): Promise<{ message: MultiplayerChatMessage; duplicate: boolean }> {
    await this.loadRoom(roomId, accountId);
    const existing = await this.database.prepare(`
      SELECT id, author_seat, author_handle, kind, body, created_at
      FROM room_messages
      WHERE room_id = ? AND account_id = ? AND request_id = ?
      LIMIT 1
    `).bind(roomId, accountId, message.requestId).first<GameMessageRow>();
    if (existing) {
      if (existing.kind !== message.kind || existing.body !== message.content) {
        throw new MultiplayerGameError(409, "MESSAGE_ID_CONFLICT", "这条消息编号已经用于其他内容。");
      }
      return { message: clientRoomMessage(existing), duplicate: true };
    }

    const now = Date.now();
    const inserted = await this.database.prepare(`
      INSERT INTO room_messages (
        room_id, account_id, request_id, author_seat, author_handle, kind, body, created_at
      )
      SELECT ?, ?, ?, members.seat, accounts.handle, ?, ?, ?
      FROM room_members AS members
      JOIN accounts ON accounts.id = members.account_id
      JOIN rooms ON rooms.id = members.room_id
      WHERE members.room_id = ? AND members.account_id = ?
        AND rooms.status != 'closed' AND rooms.expires_at > ?
        AND (
          SELECT count(*) FROM room_messages AS burst
          WHERE burst.room_id = ? AND burst.account_id = ? AND burst.created_at >= ?
        ) < 6
        AND (
          SELECT count(*) FROM room_messages AS per_user
          WHERE per_user.room_id = ? AND per_user.account_id = ? AND per_user.created_at >= ?
        ) < 30
        AND (
          SELECT count(*) FROM room_messages AS per_room
          WHERE per_room.room_id = ? AND per_room.created_at >= ?
        ) < 120
      ON CONFLICT(room_id, account_id, request_id) DO NOTHING
      RETURNING id, author_seat, author_handle, kind, body, created_at
    `).bind(
      roomId,
      accountId,
      message.requestId,
      message.kind,
      message.content,
      now,
      roomId,
      accountId,
      now,
      roomId,
      accountId,
      now - 10_000,
      roomId,
      accountId,
      now - 60_000,
      roomId,
      now - 60_000,
    ).first<GameMessageRow>();

    if (!inserted) {
      const raced = await this.database.prepare(`
        SELECT id, author_seat, author_handle, kind, body, created_at
        FROM room_messages
        WHERE room_id = ? AND account_id = ? AND request_id = ?
        LIMIT 1
      `).bind(roomId, accountId, message.requestId).first<GameMessageRow>();
      if (!raced) {
        const currentMember = await this.database.prepare(`
          SELECT count(*) AS count
          FROM room_members AS members
          JOIN rooms ON rooms.id = members.room_id
          WHERE members.room_id = ? AND members.account_id = ?
            AND rooms.status != 'closed' AND rooms.expires_at > ?
        `).bind(roomId, accountId, Date.now()).first<{ count: number }>();
        if ((currentMember?.count ?? 0) > 0) {
          throw new MultiplayerGameError(429, "RATE_LIMITED", "发送得太快了，请稍等几秒再试。");
        }
        throw new MultiplayerGameError(404, "ROOM_NOT_FOUND", "你已经不在这个房间。" );
      }
      if (raced.kind !== message.kind || raced.body !== message.content) {
        throw new MultiplayerGameError(409, "MESSAGE_ID_CONFLICT", "这条消息编号已经用于其他内容。");
      }
      return { message: clientRoomMessage(raced), duplicate: true };
    }

    await this.database.prepare(`
      DELETE FROM room_messages
      WHERE room_id = ? AND id IN (
        SELECT id FROM room_messages
        WHERE room_id = ?
        ORDER BY id DESC
        LIMIT -1 OFFSET 200
      )
    `).bind(roomId, roomId).first();
    return { message: clientRoomMessage(inserted), duplicate: false };
  }

  async applyCommand(
    roomId: string,
    accountId: string,
    command: ParsedClientCommand,
  ): Promise<MultiplayerGameSnapshot> {
    const loaded = await this.loadRoom(roomId, accountId);
    const state = hydrateRoomState(loaded.row, loaded.members);
    const actorMember = loaded.members.find((member) => member.account_id === accountId);
    if (!actorMember) {
      throw new MultiplayerGameError(404, "ROOM_NOT_FOUND", "没有找到这个房间。" );
    }
    const result = applyOnlinePokerCommand(state, actorFor(actorMember), command);
    if (!result.ok) {
      throw new MultiplayerGameError(
        engineErrorStatus(result.error.code),
        result.error.code,
        result.error.message,
      );
    }
    if (result.duplicate) return this.makeSnapshot(loaded.row, result.state, accountId);

    const next = result.state;
    const nextStatus = stateStatus(next);
    const nextOwner = next.seats.find((seat) => seat.accountId === next.ownerAccountId)
      ? next.ownerAccountId
      : loaded.row.owner_account_id;
    const update = this.database.prepare(`
      UPDATE rooms
      SET
        owner_account_id = ?,
        status = ?,
        revision = ?,
        state_json = ?,
        current_hand_id = ?,
        hand_no = ?,
        updated_at = ?
      WHERE id = ? AND revision = ?
      RETURNING revision
    `).bind(
      nextOwner,
      nextStatus,
      next.revision,
      JSON.stringify(next),
      next.hand?.id ?? null,
      next.hand?.number ?? 0,
      Date.now(),
      roomId,
      loaded.row.revision,
    );

    let updatedRevision: number | null = null;
    if (command.type === "leave") {
      const results = await this.database.batch([
        update,
        this.database.prepare(`
          DELETE FROM room_members
          WHERE room_id = ? AND account_id = ?
            AND changes() = 1
            AND EXISTS (SELECT 1 FROM rooms WHERE id = ? AND revision = ?)
        `).bind(roomId, accountId, roomId, next.revision),
      ]);
      const returned = results[0]?.results?.[0] as { revision?: number } | undefined;
      updatedRevision = returned?.revision ?? null;
    } else {
      const returned = await update.first<{ revision: number }>();
      updatedRevision = returned?.revision ?? null;
    }

    if (updatedRevision !== next.revision) {
      const latest = await this.loadRoom(roomId, accountId);
      const latestState = hydrateRoomState(latest.row, latest.members);
      const retried = applyOnlinePokerCommand(latestState, actorFor(actorMember), command);
      if (retried.ok && retried.duplicate) {
        return this.makeSnapshot(latest.row, latestState, accountId);
      }
      throw new MultiplayerGameError(409, "REVISION_CONFLICT", "牌桌已经更新，请刷新后重试。" );
    }

    return this.makeSnapshot({
      ...loaded.row,
      owner_account_id: nextOwner,
      status: nextStatus,
      revision: next.revision,
      state_json: JSON.stringify(next),
      member_count: next.seats.filter((seat) => !seat.pendingLeave).length,
    }, next, accountId);
  }
}

export async function getMultiplayerGameService(): Promise<MultiplayerGameService> {
  // @ts-expect-error Cloudflare runtime module supplied by the Sites worker.
  const { env } = await import("cloudflare:workers");
  if (!env.DB) throw new Error("Cloudflare D1 binding `DB` is unavailable.");
  return new MultiplayerGameService(env.DB as MultiplayerGameDatabase);
}
