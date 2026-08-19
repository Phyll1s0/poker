import {
  ONLINE_BIG_BLIND,
  ONLINE_DEFAULT_ACTION_TIME_MS,
  ONLINE_DEFAULT_TIME_BANK_MS,
  ONLINE_MAX_ACTION_TIME_MS,
  ONLINE_MAX_STARTING_STACK,
  ONLINE_MAX_TIME_BANK_MS,
  ONLINE_MIN_ACTION_TIME_MS,
  ONLINE_MIN_STARTING_STACK,
  createOnlineRoom,
  type OnlineTableMode,
} from "./online-poker.ts";

const HANDLE_MIN_LENGTH = 2;
const HANDLE_MAX_LENGTH = 16;
const ROOM_NAME_MAX_LENGTH = 40;
const ROOM_TTL_MS = 24 * 60 * 60 * 1000;
const JOIN_CODE_LENGTH = 8;
const JOIN_CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

const INVISIBLE_CHARACTERS = /[\p{Cc}\p{Cf}]/gu;
const WHITESPACE = /\s+/gu;

export type MultiplayerStoreErrorCode =
  | "INVALID_HANDLE"
  | "HANDLE_TAKEN"
  | "INVALID_ROOM"
  | "ROOM_NOT_FOUND"
  | "ROOM_FULL";

export class MultiplayerStoreError extends Error {
  readonly code: MultiplayerStoreErrorCode;

  constructor(
    code: MultiplayerStoreErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "MultiplayerStoreError";
    this.code = code;
  }
}

export type MultiplayerAccount = {
  id: string;
  handle: string;
  avatarSeed: string;
  createdAt: number;
};

export type PrivateRoom = {
  id: string;
  joinCode: string;
  name: string;
  ownerAccountId: string;
  ownerHandle: string;
  status: "lobby" | "playing" | "closed";
  maxPlayers: number;
  memberCount: number;
  seat: number;
  isOwner: boolean;
  revision: number;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
};

export type RegistrationResult = {
  account: MultiplayerAccount;
  created: boolean;
};

export type JoinRoomResult = {
  room: PrivateRoom;
  joined: boolean;
};

type AccountRow = {
  id: string;
  auth_subject: string;
  handle: string;
  handle_key: string;
  avatar_seed: string;
  created_at: number;
  updated_at: number;
};

type RoomRow = {
  id: string;
  join_code: string;
  owner_account_id: string;
  owner_handle: string;
  name: string;
  status: "lobby" | "playing" | "closed";
  max_players: number;
  member_count: number;
  seat: number;
  revision: number;
  created_at: number;
  updated_at: number;
  expires_at: number;
};

type RoomAvailabilityRow = {
  status: "lobby" | "playing" | "closed";
  max_players: number;
  member_count: number;
  expires_at: number;
};

type MultiplayerD1Result<T = unknown> = {
  results?: T[];
};

type MultiplayerD1PreparedStatement = {
  bind(...values: unknown[]): MultiplayerD1PreparedStatement;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<{ results: T[] }>;
};

export type MultiplayerD1Database = {
  prepare(sql: string): MultiplayerD1PreparedStatement;
  batch(statements: MultiplayerD1PreparedStatement[]): Promise<MultiplayerD1Result[]>;
};

function normalizeVisibleText(value: string): string {
  return value
    .normalize("NFKC")
    .replace(INVISIBLE_CHARACTERS, "")
    .replace(WHITESPACE, " ")
    .trim();
}

export function normalizeHandle(value: unknown): { handle: string; handleKey: string } {
  if (typeof value !== "string") {
    throw new MultiplayerStoreError("INVALID_HANDLE", "请输入牌桌昵称。");
  }

  const handle = normalizeVisibleText(value);
  const length = Array.from(handle).length;
  if (length < HANDLE_MIN_LENGTH || length > HANDLE_MAX_LENGTH) {
    throw new MultiplayerStoreError(
      "INVALID_HANDLE",
      `昵称需要 ${HANDLE_MIN_LENGTH}–${HANDLE_MAX_LENGTH} 个字符。`,
    );
  }

  return { handle, handleKey: handle.toLocaleLowerCase("en-US") };
}

export function normalizeRoomName(value: unknown): string {
  if (value === undefined || value === null || value === "") return "私人牌桌";
  if (typeof value !== "string") {
    throw new MultiplayerStoreError("INVALID_ROOM", "房间名称格式不正确。");
  }

  const name = normalizeVisibleText(value);
  const length = Array.from(name).length;
  if (!length || length > ROOM_NAME_MAX_LENGTH) {
    throw new MultiplayerStoreError(
      "INVALID_ROOM",
      `房间名称最多 ${ROOM_NAME_MAX_LENGTH} 个字符。`,
    );
  }
  return name;
}

export function normalizeMaxPlayers(value: unknown): number {
  if (value === undefined || value === null) return 6;
  if (!Number.isInteger(value) || Number(value) < 2 || Number(value) > 6) {
    throw new MultiplayerStoreError("INVALID_ROOM", "房间人数需要是 2–6。");
  }
  return Number(value);
}

export type MultiplayerRoomSettings = {
  tableMode: OnlineTableMode;
  startingStack: number;
  actionTimeMs: number;
  initialTimeBankMs: number;
};

export function normalizeRoomSettings(value: {
  tableMode?: unknown;
  startingStack?: unknown;
  actionSeconds?: unknown;
  timeBankSeconds?: unknown;
} = {}): MultiplayerRoomSettings {
  const tableMode = value.tableMode ?? "cash";
  if (tableMode !== "cash" && tableMode !== "tournament") {
    throw new MultiplayerStoreError("INVALID_ROOM", "牌局模式不正确。");
  }
  const startingStack = value.startingStack ?? ONLINE_BIG_BLIND * 100;
  if (
    !Number.isInteger(startingStack)
    || Number(startingStack) < ONLINE_MIN_STARTING_STACK
    || Number(startingStack) > ONLINE_MAX_STARTING_STACK
    || Number(startingStack) % ONLINE_BIG_BLIND !== 0
  ) {
    throw new MultiplayerStoreError("INVALID_ROOM", "起始筹码需要是 200–10000，并且是 10 的倍数。");
  }
  const actionTimeMs = value.actionSeconds === undefined
    ? ONLINE_DEFAULT_ACTION_TIME_MS
    : Number(value.actionSeconds) * 1_000;
  if (!Number.isInteger(actionTimeMs) || actionTimeMs < ONLINE_MIN_ACTION_TIME_MS || actionTimeMs > ONLINE_MAX_ACTION_TIME_MS) {
    throw new MultiplayerStoreError("INVALID_ROOM", "每次行动时间需要是 5–60 秒。");
  }
  const initialTimeBankMs = value.timeBankSeconds === undefined
    ? ONLINE_DEFAULT_TIME_BANK_MS
    : Number(value.timeBankSeconds) * 1_000;
  if (!Number.isInteger(initialTimeBankMs) || initialTimeBankMs < 0 || initialTimeBankMs > ONLINE_MAX_TIME_BANK_MS) {
    throw new MultiplayerStoreError("INVALID_ROOM", "整局时间库需要是 0–600 秒。");
  }
  return {
    tableMode,
    startingStack: Number(startingStack),
    actionTimeMs,
    initialTimeBankMs,
  };
}

export function normalizeJoinCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const code = value.normalize("NFKC").replace(/[\s-]+/gu, "").toUpperCase();
  if (code.length !== JOIN_CODE_LENGTH) return null;
  return Array.from(code).every((character) => JOIN_CODE_ALPHABET.includes(character))
    ? code
    : null;
}

export function generateJoinCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(JOIN_CODE_LENGTH));
  return Array.from(bytes, (byte) => JOIN_CODE_ALPHABET[byte % JOIN_CODE_ALPHABET.length]).join("");
}

function mapAccount(row: AccountRow): MultiplayerAccount {
  return {
    id: row.id,
    handle: row.handle,
    avatarSeed: row.avatar_seed,
    createdAt: row.created_at,
  };
}

function mapRoom(row: RoomRow, accountId: string): PrivateRoom {
  return {
    id: row.id,
    joinCode: row.join_code,
    name: row.name,
    ownerAccountId: row.owner_account_id,
    ownerHandle: row.owner_handle,
    status: row.status,
    maxPlayers: row.max_players,
    memberCount: row.member_count,
    seat: row.seat,
    isOwner: row.owner_account_id === accountId,
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    expiresAt: row.expires_at,
  };
}

function isJoinCodeConstraint(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("join_code") || message.includes("idx_rooms_join_code");
}

export class MultiplayerStore {
  private readonly database: MultiplayerD1Database;

  constructor(database: MultiplayerD1Database) {
    this.database = database;
  }

  async getAccountBySubject(authSubject: string): Promise<MultiplayerAccount | null> {
    const row = await this.database.prepare(`
      SELECT id, auth_subject, handle, handle_key, avatar_seed, created_at, updated_at
      FROM accounts
      WHERE auth_subject = ?
      LIMIT 1
    `).bind(authSubject).first<AccountRow>();
    return row ? mapAccount(row) : null;
  }

  async registerAccount(authSubject: string, rawHandle: unknown): Promise<RegistrationResult> {
    const existing = await this.getAccountBySubject(authSubject);
    if (existing) return { account: existing, created: false };

    const { handle, handleKey } = normalizeHandle(rawHandle);
    const handleOwner = await this.database.prepare(`
      SELECT id
      FROM accounts
      WHERE handle_key = ?
      LIMIT 1
    `).bind(handleKey).first<{ id: string }>();
    if (handleOwner) {
      throw new MultiplayerStoreError("HANDLE_TAKEN", "这个昵称已经有人使用。");
    }

    const id = crypto.randomUUID();
    const now = Date.now();
    try {
      const row = await this.database.prepare(`
        INSERT INTO accounts (
          id, auth_subject, handle, handle_key, avatar_seed, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        RETURNING id, auth_subject, handle, handle_key, avatar_seed, created_at, updated_at
      `).bind(id, authSubject, handle, handleKey, id, now, now).first<AccountRow>();

      if (!row) throw new Error("The account insert returned no row.");
      return { account: mapAccount(row), created: true };
    } catch (error) {
      const concurrentAccount = await this.getAccountBySubject(authSubject);
      if (concurrentAccount) return { account: concurrentAccount, created: false };

      const concurrentHandleOwner = await this.database.prepare(`
        SELECT id
        FROM accounts
        WHERE handle_key = ?
        LIMIT 1
      `).bind(handleKey).first<{ id: string }>();
      if (concurrentHandleOwner) {
        throw new MultiplayerStoreError("HANDLE_TAKEN", "这个昵称已经有人使用。");
      }
      throw error;
    }
  }

  async listRooms(accountId: string): Promise<PrivateRoom[]> {
    const now = Date.now();
    const result = await this.database.prepare(`
      SELECT
        r.id,
        r.join_code,
        r.owner_account_id,
        owner.handle AS owner_handle,
        r.name,
        r.status,
        r.max_players,
        (SELECT count(*) FROM room_members members WHERE members.room_id = r.id) AS member_count,
        mine.seat,
        r.revision,
        r.created_at,
        r.updated_at,
        r.expires_at
      FROM rooms r
      JOIN room_members mine ON mine.room_id = r.id AND mine.account_id = ?
      JOIN accounts owner ON owner.id = r.owner_account_id
      WHERE r.status != 'closed' AND r.expires_at > ?
      ORDER BY r.updated_at DESC, r.id DESC
      LIMIT 50
    `).bind(accountId, now).all<RoomRow>();
    return result.results.map((row) => mapRoom(row, accountId));
  }

  async createRoom(
    accountId: string,
    rawName: unknown,
    rawMaxPlayers: unknown,
    rawSettings: Parameters<typeof normalizeRoomSettings>[0] = {},
  ): Promise<PrivateRoom> {
    const name = normalizeRoomName(rawName);
    const maxPlayers = normalizeMaxPlayers(rawMaxPlayers);
    const settings = normalizeRoomSettings(rawSettings);
    const owner = await this.database.prepare(`
      SELECT handle
      FROM accounts
      WHERE id = ?
      LIMIT 1
    `).bind(accountId).first<{ handle: string }>();
    if (!owner) throw new MultiplayerStoreError("INVALID_ROOM", "房主身份不存在。");

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const id = crypto.randomUUID();
      const joinCode = generateJoinCode();
      const now = Date.now();
      const expiresAt = now + ROOM_TTL_MS;
      const state = createOnlineRoom({
        roomId: id,
        owner: { accountId, displayName: owner.handle },
        maxPlayers,
        ...settings,
      });
      try {
        await this.database.batch([
          this.database.prepare(`
            INSERT INTO rooms (
              id, join_code, owner_account_id, name, status, max_players,
              revision, state_json, created_at, updated_at, expires_at
            ) VALUES (?, ?, ?, ?, 'lobby', ?, 0, ?, ?, ?, ?)
          `).bind(id, joinCode, accountId, name, maxPlayers, JSON.stringify(state), now, now, expiresAt),
          this.database.prepare(`
            INSERT INTO room_members (room_id, account_id, seat, ready, joined_at)
            VALUES (?, ?, 0, 0, ?)
          `).bind(id, accountId, now),
        ]);

        const room = await this.getRoomForAccount(id, accountId);
        if (!room) throw new Error("The room insert returned no room.");
        return room;
      } catch (error) {
        if (attempt < 4 && isJoinCodeConstraint(error)) continue;
        throw error;
      }
    }

    throw new Error("Unable to allocate a unique room invitation code.");
  }

  async joinRoom(accountId: string, rawJoinCode: unknown): Promise<JoinRoomResult> {
    const joinCode = normalizeJoinCode(rawJoinCode);
    if (!joinCode) {
      throw new MultiplayerStoreError("ROOM_NOT_FOUND", "没有找到这个房间。");
    }

    const now = Date.now();
    const room = await this.database.prepare(`
      SELECT id
      FROM rooms
      WHERE join_code = ? AND status = 'lobby' AND expires_at > ?
      LIMIT 1
    `).bind(joinCode, now).first<{ id: string }>();
    if (!room) {
      throw new MultiplayerStoreError("ROOM_NOT_FOUND", "没有找到这个房间。");
    }

    const existing = await this.getRoomForAccount(room.id, accountId);
    if (existing) return { room: existing, joined: false };

    const results = await this.database.batch([
      this.database.prepare(`
        WITH seats(seat) AS (VALUES (0), (1), (2), (3), (4), (5))
        INSERT INTO room_members (room_id, account_id, seat, ready, joined_at)
        SELECT r.id, ?, seats.seat, 0, ?
        FROM rooms r
        CROSS JOIN seats
        WHERE r.id = ?
          AND r.status = 'lobby'
          AND r.expires_at > ?
          AND seats.seat < r.max_players
          AND NOT EXISTS (
            SELECT 1 FROM room_members own_membership
            WHERE own_membership.room_id = r.id AND own_membership.account_id = ?
          )
          AND NOT EXISTS (
            SELECT 1 FROM room_members occupied
            WHERE occupied.room_id = r.id AND occupied.seat = seats.seat
          )
        ORDER BY seats.seat
        LIMIT 1
        RETURNING seat
      `).bind(accountId, now, room.id, now, accountId),
      this.database.prepare(`
        UPDATE rooms
        SET revision = revision + 1, updated_at = ?
        WHERE id = ?
          AND changes() = 1
          AND EXISTS (
            SELECT 1 FROM room_members joined
            WHERE joined.room_id = rooms.id
              AND joined.account_id = ?
              AND joined.joined_at = ?
          )
      `).bind(now, room.id, accountId, now),
    ]);

    const inserted = results[0]?.results?.[0] as { seat?: number } | undefined;
    const joinedRoom = await this.getRoomForAccount(room.id, accountId);
    if (joinedRoom) return { room: joinedRoom, joined: inserted?.seat !== undefined };

    const availability = await this.database.prepare(`
      SELECT
        r.status,
        r.max_players,
        r.expires_at,
        (SELECT count(*) FROM room_members members WHERE members.room_id = r.id) AS member_count
      FROM rooms r
      WHERE r.id = ?
      LIMIT 1
    `).bind(room.id).first<RoomAvailabilityRow>();
    if (!availability || availability.status !== "lobby" || availability.expires_at <= Date.now()) {
      throw new MultiplayerStoreError("ROOM_NOT_FOUND", "没有找到这个房间。");
    }
    throw new MultiplayerStoreError("ROOM_FULL", "这个房间已经坐满了。");
  }

  private async getRoomForAccount(roomId: string, accountId: string): Promise<PrivateRoom | null> {
    const row = await this.database.prepare(`
      SELECT
        r.id,
        r.join_code,
        r.owner_account_id,
        owner.handle AS owner_handle,
        r.name,
        r.status,
        r.max_players,
        (SELECT count(*) FROM room_members members WHERE members.room_id = r.id) AS member_count,
        mine.seat,
        r.revision,
        r.created_at,
        r.updated_at,
        r.expires_at
      FROM rooms r
      JOIN room_members mine ON mine.room_id = r.id AND mine.account_id = ?
      JOIN accounts owner ON owner.id = r.owner_account_id
      WHERE r.id = ?
      LIMIT 1
    `).bind(accountId, roomId).first<RoomRow>();
    return row ? mapRoom(row, accountId) : null;
  }
}

export async function getMultiplayerStore(): Promise<MultiplayerStore> {
  // TypeScript is checked outside the Worker runtime, while Vinext provides
  // this built-in module during the Cloudflare server build.
  // @ts-expect-error Cloudflare runtime module supplied by the Sites worker.
  const { env } = await import("cloudflare:workers");
  if (!env.DB) throw new Error("Cloudflare D1 binding `DB` is unavailable.");
  return new MultiplayerStore(env.DB as MultiplayerD1Database);
}
