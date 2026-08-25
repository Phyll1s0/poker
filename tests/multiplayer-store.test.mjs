import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  MultiplayerStore,
  MultiplayerStoreError,
  generateJoinCode,
  normalizeHandle,
  normalizeJoinCode,
  normalizeMaxPlayers,
  normalizeRoomName,
  normalizeRoomSettings,
} from "../lib/multiplayer-store.ts";
import {
  MultiplayerGameError,
  MultiplayerGameService,
  parseMultiplayerCommand,
  parseMultiplayerMessageCursor,
  parseMultiplayerRoomMessage,
} from "../lib/multiplayer-game.ts";

class SqliteD1Statement {
  constructor(database, sql, values = []) {
    this.database = database;
    this.sql = sql;
    this.values = values;
  }

  bind(...values) {
    return new SqliteD1Statement(this.database, this.sql, values);
  }

  async first() {
    return this.database.prepare(this.sql).get(...this.values) ?? null;
  }

  async all() {
    return { results: this.database.prepare(this.sql).all(...this.values) };
  }

  execute() {
    return { results: this.database.prepare(this.sql).all(...this.values) };
  }
}

class SqliteD1Database {
  constructor(database) {
    this.database = database;
  }

  prepare(sql) {
    return new SqliteD1Statement(this.database, sql);
  }

  async batch(statements) {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const results = statements.map((statement) => statement.execute());
      this.database.exec("COMMIT");
      return results;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }
}

class RacingSqliteD1Database extends SqliteD1Database {
  beforeNextBatch = null;

  async batch(statements) {
    const race = this.beforeNextBatch;
    this.beforeNextBatch = null;
    if (race) race(this.database);
    return super.batch(statements);
  }
}

async function testStore() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  const migrationDirectory = new URL("../drizzle/", import.meta.url);
  const migrationFiles = (await readdir(migrationDirectory))
    .filter((name) => /^\d{4}_.+\.sql$/.test(name))
    .sort();
  for (const migrationFile of migrationFiles) {
    const migration = await readFile(new URL(migrationFile, migrationDirectory), "utf8");
    sqlite.exec(migration.replaceAll("--> statement-breakpoint", ""));
  }
  return {
    sqlite,
    store: new MultiplayerStore(new SqliteD1Database(sqlite)),
  };
}

test("handle normalization applies NFKC, removes controls, and collapses whitespace", () => {
  assert.deepEqual(normalizeHandle("  Ａlice\u0000\t 王  "), {
    handle: "Alice 王",
    handleKey: "alice 王",
  });
  assert.deepEqual(normalizeHandle("Straße"), {
    handle: "Straße",
    handleKey: "straße",
  });
});

test("handle validation rejects missing and out-of-range names", () => {
  assert.throws(
    () => normalizeHandle("Ａ"),
    (error) => error instanceof MultiplayerStoreError && error.code === "INVALID_HANDLE",
  );
  assert.throws(
    () => normalizeHandle("牌".repeat(17)),
    (error) => error instanceof MultiplayerStoreError && error.code === "INVALID_HANDLE",
  );
  assert.throws(
    () => normalizeHandle(null),
    (error) => error instanceof MultiplayerStoreError && error.code === "INVALID_HANDLE",
  );
});

test("room inputs are normalized and constrained to private table limits", () => {
  assert.equal(normalizeRoomName(undefined), "私人牌桌");
  assert.equal(normalizeRoomName("  周五\u200b   深筹桌 "), "周五 深筹桌");
  assert.equal(normalizeMaxPlayers(undefined), 6);
  assert.equal(normalizeMaxPlayers(2), 2);
  assert.equal(normalizeMaxPlayers(6), 6);
  assert.equal(normalizeMaxPlayers(8), 8);
  assert.equal(normalizeMaxPlayers(10), 10);
  assert.throws(
    () => normalizeMaxPlayers(11),
    (error) => error instanceof MultiplayerStoreError && error.code === "INVALID_ROOM",
  );
  assert.throws(
    () => normalizeMaxPlayers("6"),
    (error) => error instanceof MultiplayerStoreError && error.code === "INVALID_ROOM",
  );
  assert.deepEqual(normalizeRoomSettings({
    tableMode: "cash",
    startingStack: 2_000,
    actionSeconds: 10,
    timeBankSeconds: 100,
    aiAssistLimit: 10,
  }), {
    tableMode: "cash",
    startingStack: 2_000,
    actionTimeMs: 10_000,
    initialTimeBankMs: 100_000,
    aiAssistLimit: 10,
  });
  assert.equal(normalizeRoomSettings().aiAssistLimit, 5);
  assert.equal(normalizeRoomSettings({ aiAssistLimit: 0 }).aiAssistLimit, 0);
  assert.throws(
    () => normalizeRoomSettings({ aiAssistLimit: 1 }),
    (error) => error instanceof MultiplayerStoreError && error.code === "INVALID_ROOM",
  );
  assert.throws(
    () => normalizeRoomSettings({ startingStack: 205 }),
    (error) => error instanceof MultiplayerStoreError && error.code === "INVALID_ROOM",
  );
});

test("join codes tolerate visual separators but reject ambiguous characters", () => {
  assert.equal(normalizeJoinCode("abcd-efgh"), "ABCDEFGH");
  assert.equal(normalizeJoinCode("ＡＢＣＤ ＥＦＧＨ"), "ABCDEFGH");
  assert.equal(normalizeJoinCode("ABCD0FGH"), null);
  assert.equal(normalizeJoinCode("short"), null);

  const generated = Array.from({ length: 64 }, generateJoinCode);
  assert.ok(generated.every((code) => /^[2-9A-HJ-NP-Z]{8}$/.test(code)));
  assert.equal(new Set(generated).size, generated.length);
});

test("multiplayer command parsing accepts one hand-scoped AI assist request", () => {
  assert.deepEqual(parseMultiplayerCommand({
    type: "use-ai-assist",
    handId: "hand-room-1",
    requestId: "ai-assist-request-1",
    expectedRevision: 7,
  }), {
    type: "use-ai-assist",
    handId: "hand-room-1",
    commandId: "ai-assist-request-1",
    expectedRevision: 7,
  });
  assert.throws(
    () => parseMultiplayerCommand({
      type: "use-ai-assist",
      requestId: "ai-assist-request-2",
      expectedRevision: 7,
    }),
    (error) => error instanceof MultiplayerGameError && error.code === "INVALID_COMMAND",
  );
});

test("multiplayer command parsing accepts a seat-scoped private peek and rejects malformed targets", () => {
  assert.deepEqual(parseMultiplayerCommand({
    type: "peek",
    handId: "hand-private-peek-1",
    targetSeat: 4,
    requestId: "private-peek-request-1",
    expectedRevision: 12,
  }), {
    type: "peek",
    handId: "hand-private-peek-1",
    targetSeat: 4,
    commandId: "private-peek-request-1",
    expectedRevision: 12,
  });

  assert.equal(parseMultiplayerCommand({
    type: "peek",
    handId: "hand-private-peek-1",
    targetSeat: 9,
    requestId: "private-peek-seat-nine",
    expectedRevision: 12,
  }).targetSeat, 9);

  for (const targetSeat of [undefined, null, "1", -1, 10, 1.5]) {
    assert.throws(
      () => parseMultiplayerCommand({
        type: "peek",
        handId: "hand-private-peek-1",
        targetSeat,
        requestId: `bad-peek-target-${String(targetSeat)}`,
        expectedRevision: 12,
      }),
      (error) => error instanceof MultiplayerGameError && error.code === "INVALID_COMMAND",
    );
  }
});

test("registration is idempotent and normalized handles stay unique", async (context) => {
  const { sqlite, store } = await testStore();
  context.after(() => sqlite.close());

  const first = await store.registerAccount("siwc-owner", "  Ａlice  ");
  assert.equal(first.created, true);
  assert.equal(first.account.handle, "Alice");

  const repeated = await store.registerAccount("siwc-owner", "另一个名字");
  assert.equal(repeated.created, false);
  assert.equal(repeated.account.id, first.account.id);
  assert.equal(repeated.account.handle, "Alice");

  await assert.rejects(
    store.registerAccount("siwc-other", "alice"),
    (error) => error instanceof MultiplayerStoreError && error.code === "HANDLE_TAKEN",
  );
});

test("room creation seats the owner and concurrent joins cannot exceed capacity", async (context) => {
  const { sqlite, store } = await testStore();
  context.after(() => sqlite.close());

  const owner = (await store.registerAccount("siwc-owner", "庄家")).account;
  const guestOne = (await store.registerAccount("siwc-guest-1", "来宾一")).account;
  const guestTwo = (await store.registerAccount("siwc-guest-2", "来宾二")).account;
  const room = await store.createRoom(owner.id, " 周五\u200b 练习桌 ", 2, {
    tableMode: "cash",
    startingStack: 2_000,
    actionSeconds: 10,
    timeBankSeconds: 100,
    aiAssistLimit: 10,
  });

  assert.equal(room.name, "周五 练习桌");
  assert.equal(room.memberCount, 1);
  assert.equal(room.seat, 0);
  assert.equal(room.isOwner, true);
  const persistedState = JSON.parse(sqlite.prepare("SELECT state_json FROM rooms WHERE id = ?").get(room.id).state_json);
  assert.equal(persistedState.tableMode, "cash");
  assert.equal(persistedState.startingStack, 2_000);
  assert.equal(persistedState.actionTimeMs, 10_000);
  assert.equal(persistedState.initialTimeBankMs, 100_000);
  assert.equal(persistedState.aiAssistLimit, 10);

  const attempts = await Promise.allSettled([
    store.joinRoom(guestOne.id, `${room.joinCode.slice(0, 4)}-${room.joinCode.slice(4)}`),
    store.joinRoom(guestTwo.id, room.joinCode.toLowerCase()),
  ]);
  const joined = attempts.filter((result) => result.status === "fulfilled");
  const rejected = attempts.filter((result) => result.status === "rejected");
  assert.equal(joined.length, 1);
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].reason.code, "ROOM_FULL");

  const joinResult = joined[0].value;
  assert.equal(joinResult.room.seat, 1);
  assert.equal(joinResult.room.memberCount, 2);
  assert.equal(joinResult.room.revision, 1);

  const joinedAccountId = attempts[0].status === "fulfilled" ? guestOne.id : guestTwo.id;
  const repeated = await store.joinRoom(joinedAccountId, room.joinCode);
  assert.equal(repeated.joined, false);
  assert.equal(repeated.room.memberCount, 2);

  const ownerRooms = await store.listRooms(owner.id);
  assert.equal(ownerRooms.length, 1);
  assert.equal(ownerRooms[0].memberCount, 2);
});

test("D1 rooms allocate every seat through ten-max and preserve seat-nine chat identity", async (context) => {
  const { sqlite, store } = await testStore();
  context.after(() => sqlite.close());

  const accounts = [];
  for (let index = 0; index < 11; index += 1) {
    accounts.push((await store.registerAccount(`ten-max-subject-${index}`, `玩家${index + 1}`)).account);
  }
  const room = await store.createRoom(accounts[0].id, "十人测试桌", 10);
  for (let index = 1; index < 10; index += 1) {
    const joined = await store.joinRoom(accounts[index].id, room.joinCode);
    assert.equal(joined.room.seat, index);
    assert.equal(joined.room.memberCount, index + 1);
  }
  await assert.rejects(
    store.joinRoom(accounts[10].id, room.joinCode),
    (error) => error instanceof MultiplayerStoreError && error.code === "ROOM_FULL",
  );

  const service = new MultiplayerGameService(new SqliteD1Database(sqlite));
  const sent = await service.sendMessage(room.id, accounts[9].id, parseMultiplayerRoomMessage({
    requestId: "ten-max-seat-nine-chat",
    kind: "reaction",
    content: "🔥",
  }));
  assert.equal(sent.message.seat, 9);
  const snapshot = await service.getSnapshot(room.id, accounts[0].id);
  assert.equal(snapshot.room.maxPlayers, 10);
  assert.deepEqual(snapshot.players.map((player) => player.seat), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
});

test("a concurrent retry from the same account increments the room revision only once", async (context) => {
  const { sqlite, store } = await testStore();
  context.after(() => sqlite.close());

  const owner = (await store.registerAccount("siwc-owner", "庄家")).account;
  const guest = (await store.registerAccount("siwc-guest", "来宾")).account;
  const room = await store.createRoom(owner.id, "重试测试桌", 2);
  const originalNow = Date.now;
  Date.now = () => 1_776_558_000_000;

  try {
    const attempts = await Promise.all([
      store.joinRoom(guest.id, room.joinCode),
      store.joinRoom(guest.id, room.joinCode),
    ]);
    assert.equal(attempts.filter((attempt) => attempt.joined).length, 1);
    assert.ok(attempts.every((attempt) => attempt.room.revision === 1));
  } finally {
    Date.now = originalNow;
  }

  const persisted = sqlite.prepare("SELECT revision FROM rooms WHERE id = ?").get(room.id);
  assert.equal(persisted.revision, 1);
});

test("a stale D1 leave never deletes membership after another command wins the revision", async (context) => {
  const { sqlite, store } = await testStore();
  context.after(() => sqlite.close());

  const owner = (await store.registerAccount("race-leave-owner", "并发庄家")).account;
  const guest = (await store.registerAccount("race-leave-guest", "并发来宾")).account;
  const room = await store.createRoom(owner.id, "并发退出桌", 2);
  await store.joinRoom(guest.id, room.joinCode);
  const database = new RacingSqliteD1Database(sqlite);
  const service = new MultiplayerGameService(database);
  let snapshot = await service.getSnapshot(room.id, owner.id);
  snapshot = await service.applyCommand(room.id, owner.id, parseMultiplayerCommand({
    type: "ready",
    ready: true,
    requestId: "race-leave-prime-state",
    expectedRevision: snapshot.room.revision,
  }));

  database.beforeNextBatch = (connection) => {
    const persisted = connection.prepare("SELECT revision, state_json FROM rooms WHERE id = ?").get(room.id);
    const state = JSON.parse(persisted.state_json);
    state.revision = persisted.revision + 1;
    state.seats.find((seat) => seat.accountId === guest.id).ready = true;
    connection.prepare("UPDATE rooms SET revision = ?, state_json = ? WHERE id = ?")
      .run(state.revision, JSON.stringify(state), room.id);
  };

  await assert.rejects(
    service.applyCommand(room.id, owner.id, parseMultiplayerCommand({
      type: "leave",
      requestId: "race-leave-command",
      expectedRevision: snapshot.room.revision,
    })),
    (error) => error instanceof MultiplayerGameError && error.code === "REVISION_CONFLICT",
  );

  assert.equal(sqlite.prepare("SELECT count(*) AS count FROM room_members WHERE room_id = ? AND account_id = ?")
    .get(room.id, owner.id).count, 1);
  const intact = await service.getSnapshot(room.id, owner.id);
  assert.equal(intact.table.seats.find((seat) => seat.seat === 0).pendingLeave, false);
});

test("schema and routes keep identity server-owned and enable the D1 binding", async () => {
  const [hosting, schema, accountRoute, roomsRoute, joinRoute] = await Promise.all([
    readFile(new URL("../.openai/hosting.json", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/account/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/rooms/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/rooms/join/route.ts", import.meta.url), "utf8"),
  ]);

  assert.equal(JSON.parse(hosting).d1, "DB");
  assert.match(schema, /idx_accounts_auth_subject/);
  assert.match(schema, /idx_accounts_handle_key/);
  assert.match(schema, /idx_room_members_room_seat/);
  assert.doesNotMatch(schema, /password/i);
  assert.doesNotMatch(schema, /email/i);

  for (const route of [accountRoute, roomsRoute, joinRoute]) {
    assert.match(route, /getChatGPTUser/);
    assert.doesNotMatch(route, /payload\.userId/);
    assert.doesNotMatch(route, /payload\.email/);
  }
  assert.match(accountRoute, /registerAccount\(user\.userId, payload\.handle\)/);
  assert.match(roomsRoute, /aiAssistLimit: payload\.aiAssistLimit/);
  assert.match(joinRoute, /joinRoom\(account\.id, payload\.joinCode\)/);
});

test("the D1 ten-max migration preserves existing six-max rooms and foreign keys", async (context) => {
  const sqlite = new DatabaseSync(":memory:");
  context.after(() => sqlite.close());
  sqlite.exec("PRAGMA foreign_keys = ON");
  for (const name of ["0000_material_emma_frost.sql", "0001_shallow_sheva_callister.sql"]) {
    const migration = await readFile(new URL(`../drizzle/${name}`, import.meta.url), "utf8");
    sqlite.exec(migration.replaceAll("--> statement-breakpoint", ""));
  }

  const now = 1_777_000_000_000;
  sqlite.prepare(`INSERT INTO accounts
    (id, auth_subject, handle, handle_key, avatar_seed, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run("legacy-owner", "legacy-subject", "旧房主", "旧房主", "legacy-owner", now, now);
  sqlite.prepare(`INSERT INTO rooms
    (id, join_code, owner_account_id, name, status, max_players, revision, state_json,
     current_hand_id, hand_no, created_at, updated_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run("legacy-room", "ABCDEFGH", "legacy-owner", "旧六人桌", "lobby", 6, 0, null, null, 0, now, now, now + 1_000);
  sqlite.prepare(`INSERT INTO room_members (room_id, account_id, seat, ready, joined_at)
    VALUES (?, ?, ?, ?, ?)`)
    .run("legacy-room", "legacy-owner", 5, 0, now);
  sqlite.prepare(`INSERT INTO room_messages
    (room_id, account_id, request_id, author_seat, author_handle, kind, body, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run("legacy-room", "legacy-owner", "legacy-chat-request", 5, "旧房主", "text", "旧消息", now);

  const migration = await readFile(new URL("../drizzle/0002_polite_kylun.sql", import.meta.url), "utf8");
  sqlite.exec(migration.replaceAll("--> statement-breakpoint", ""));
  assert.deepEqual(sqlite.prepare("PRAGMA foreign_key_check").all(), []);
  assert.equal(sqlite.prepare("SELECT max_players FROM rooms WHERE id = ?").get("legacy-room").max_players, 6);
  assert.equal(sqlite.prepare("SELECT seat FROM room_members WHERE room_id = ?").get("legacy-room").seat, 5);
  assert.equal(sqlite.prepare("SELECT author_seat FROM room_messages WHERE room_id = ?").get("legacy-room").author_seat, 5);

  sqlite.prepare("UPDATE rooms SET max_players = 10 WHERE id = ?").run("legacy-room");
  sqlite.prepare("UPDATE room_members SET seat = 9 WHERE room_id = ? AND account_id = ?")
    .run("legacy-room", "legacy-owner");
  sqlite.prepare("UPDATE room_messages SET author_seat = 9 WHERE room_id = ?")
    .run("legacy-room");
  const nextMessage = sqlite.prepare(`INSERT INTO room_messages
    (room_id, account_id, request_id, author_seat, author_handle, kind, body, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`)
    .get("legacy-room", "legacy-owner", "post-migration-chat", 9, "旧房主", "text", "新消息", now + 1);
  assert.equal(sqlite.prepare("SELECT max_players FROM rooms WHERE id = ?").get("legacy-room").max_players, 10);
  assert.equal(sqlite.prepare("SELECT seat FROM room_members WHERE room_id = ?").get("legacy-room").seat, 9);
  assert.equal(sqlite.prepare("SELECT author_seat FROM room_messages WHERE room_id = ?").get("legacy-room").author_seat, 9);
  assert.equal(nextMessage.id, 2, "AUTOINCREMENT continues after copied legacy messages");
});

test("the Supabase service and migration enforce the same ten-max boundary", async () => {
  const [edge, migration] = await Promise.all([
    readFile(new URL("../supabase/functions/poker-api/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260825084930_expand_poker_tables_to_ten_players.sql", import.meta.url), "utf8"),
  ]);
  assert.match(edge, /ONLINE_MAX_PLAYERS/);
  assert.doesNotMatch(edge, /targetSeat[^\n]*>= 6/);
  assert.match(migration, /max_players between 2 and 10/i);
  assert.match(migration, /seat between 0 and 9/i);
  assert.match(migration, /author_seat between 0 and 9/i);
  assert.match(migration, /v_seat > 9/i);
  assert.match(migration, /v_seat < max_players/i);
  assert.match(migration, /security invoker/i);
  assert.match(migration, /revoke execute[\s\S]*from public, anon, authenticated/i);
});

test("D1 chat is server-authored, idempotent, ordered, and independent from poker revision", async (context) => {
  const { sqlite, store } = await testStore();
  context.after(() => sqlite.close());
  const owner = (await store.registerAccount("chat-owner", "聊天房主")).account;
  const guest = (await store.registerAccount("chat-guest", "聊天来宾")).account;
  const room = await store.createRoom(owner.id, "聊天测试桌", 2);
  await store.joinRoom(guest.id, room.joinCode);
  const service = new MultiplayerGameService(new SqliteD1Database(sqlite));
  const revisionBefore = (await service.getSnapshot(room.id, owner.id)).room.revision;
  const payload = parseMultiplayerRoomMessage({
    requestId: "chat-message-owner-1",
    kind: "text",
    content: "你好 <script>alert(1)</script>",
    authorSeat: 5,
    authorHandle: "伪造昵称",
  });

  const sent = await service.sendMessage(room.id, owner.id, payload);
  assert.equal(sent.duplicate, false);
  assert.equal(sent.message.seat, 0);
  assert.equal(sent.message.handle, owner.handle);
  assert.equal(sent.message.content, "你好 <script>alert(1)</script>");
  const duplicate = await service.sendMessage(room.id, owner.id, payload);
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.message.id, sent.message.id);

  await service.sendMessage(room.id, guest.id, parseMultiplayerRoomMessage({
    requestId: "chat-message-guest-1",
    kind: "reaction",
    content: "🔥",
  }));
  const initial = await service.getMessages(room.id, guest.id, null);
  assert.deepEqual(initial.messages.map((message) => message.content), [
    "你好 <script>alert(1)</script>",
    "🔥",
  ]);
  const incremental = await service.getMessages(room.id, owner.id, parseMultiplayerMessageCursor(sent.message.id));
  assert.deepEqual(incremental.messages.map((message) => message.content), ["🔥"]);
  assert.equal((await service.getSnapshot(room.id, owner.id)).room.revision, revisionBefore);

  assert.throws(
    () => parseMultiplayerRoomMessage({ requestId: "chat-invalid-reaction", kind: "reaction", content: "<img>" }),
    (error) => error instanceof MultiplayerGameError && error.code === "INVALID_MESSAGE",
  );
});

test("D1 chat enforces the six-message burst limit at insertion time", async (context) => {
  const { sqlite, store } = await testStore();
  context.after(() => sqlite.close());
  const owner = (await store.registerAccount("chat-rate-owner", "限速房主")).account;
  const room = await store.createRoom(owner.id, "聊天限速测试桌", 2);
  const service = new MultiplayerGameService(new SqliteD1Database(sqlite));
  const originalNow = Date.now;
  Date.now = () => 1_777_777_777_000;

  try {
    for (let index = 0; index < 6; index += 1) {
      await service.sendMessage(room.id, owner.id, parseMultiplayerRoomMessage({
        requestId: `chat-rate-message-${index}`,
        kind: "text",
        content: `消息 ${index + 1}`,
      }));
    }
    await assert.rejects(
      service.sendMessage(room.id, owner.id, parseMultiplayerRoomMessage({
        requestId: "chat-rate-message-blocked",
        kind: "text",
        content: "第七条消息",
      })),
      (error) => error instanceof MultiplayerGameError && error.code === "RATE_LIMITED",
    );
    assert.equal(
      sqlite.prepare("SELECT count(*) AS count FROM room_messages WHERE room_id = ?").get(room.id).count,
      6,
    );
  } finally {
    Date.now = originalNow;
  }
});

test("D1 room state executes commands and never projects another player's hole cards", async () => {
  const { sqlite, store } = await testStore();
  try {
    const owner = (await store.registerAccount("subject-owner", "河牌狐狸")).account;
    const guest = (await store.registerAccount("subject-guest", "转牌鲸鱼")).account;
    const room = await store.createRoom(owner.id, "隐牌测试桌", 2);
    await store.joinRoom(guest.id, room.joinCode);

    const service = new MultiplayerGameService(new SqliteD1Database(sqlite));
    let ownerView = await service.getSnapshot(room.id, owner.id);
    assert.equal(ownerView.table.phase, "lobby");
    assert.equal(ownerView.table.aiAssistLimit, 5);
    assert.ok(ownerView.players.every((player) => player.aiAssistsRemaining === 5));
    assert.equal(ownerView.room.revision, 1);

    ownerView = await service.applyCommand(room.id, owner.id, parseMultiplayerCommand({
      type: "ready",
      ready: true,
      requestId: "ready-owner-0001",
      expectedRevision: ownerView.room.revision,
    }));
    let guestView = await service.applyCommand(room.id, guest.id, parseMultiplayerCommand({
      type: "ready",
      ready: true,
      requestId: "ready-guest-0001",
      expectedRevision: ownerView.room.revision,
    }));
    ownerView = await service.applyCommand(room.id, owner.id, parseMultiplayerCommand({
      type: "start",
      requestId: "start-owner-0001",
      expectedRevision: guestView.room.revision,
    }));
    ownerView = await service.applyCommand(room.id, owner.id, parseMultiplayerCommand({
      type: "use-ai-assist",
      handId: ownerView.table.hand.id,
      requestId: "assist-owner-0001",
      expectedRevision: ownerView.room.revision,
    }));

    assert.equal(ownerView.table.phase, "playing");
    assert.equal(ownerView.table.viewerSeat, 0);
    assert.equal(ownerView.table.seats[0].aiAssistsRemaining, 4);
    assert.equal(ownerView.players[0].aiAssistsRemaining, 4);
    assert.ok(ownerView.table.seats[0].holeCards);
    assert.equal(ownerView.table.seats[1].holeCards, null);
    const ownerPayload = JSON.stringify(ownerView);
    assert.doesNotMatch(ownerPayload, /"deck"/);
    assert.doesNotMatch(ownerPayload, /processedCommands/);

    guestView = await service.getSnapshot(room.id, guest.id);
    assert.equal(guestView.table.seats[0].holeCards, null);
    assert.ok(guestView.table.seats[1].holeCards);
    await assert.rejects(
      service.applyCommand(room.id, guest.id, parseMultiplayerCommand({
        type: "act",
        handId: guestView.table.hand.id,
        action: "call",
        requestId: "wrong-turn-0001",
        expectedRevision: guestView.room.revision,
      })),
      (error) => error instanceof MultiplayerGameError && error.code === "NOT_YOUR_TURN",
    );
  } finally {
    sqlite.close();
  }
});

test("D1 private peek persists for only its authenticated viewer and retries charge once", async () => {
  const { sqlite, store } = await testStore();
  try {
    const owner = (await store.registerAccount("peek-d1-owner", "私窥房主")).account;
    const target = (await store.registerAccount("peek-d1-target", "私窥目标")).account;
    const other = (await store.registerAccount("peek-d1-other", "私窥旁观者")).account;
    const room = await store.createRoom(owner.id, "私密偷看测试桌", 3);
    await store.joinRoom(target.id, room.joinCode);
    await store.joinRoom(other.id, room.joinCode);
    const service = new MultiplayerGameService(new SqliteD1Database(sqlite));

    let view = await service.getSnapshot(room.id, owner.id);
    view = await service.applyCommand(room.id, owner.id, parseMultiplayerCommand({
      type: "ready",
      ready: true,
      requestId: "peek-ready-owner",
      expectedRevision: view.room.revision,
    }));
    view = await service.applyCommand(room.id, target.id, parseMultiplayerCommand({
      type: "ready",
      ready: true,
      requestId: "peek-ready-target",
      expectedRevision: view.room.revision,
    }));
    view = await service.applyCommand(room.id, other.id, parseMultiplayerCommand({
      type: "ready",
      ready: true,
      requestId: "peek-ready-other",
      expectedRevision: view.room.revision,
    }));
    view = await service.applyCommand(room.id, owner.id, parseMultiplayerCommand({
      type: "start",
      requestId: "peek-start-owner",
      expectedRevision: view.room.revision,
    }));
    view = await service.applyCommand(room.id, owner.id, parseMultiplayerCommand({
      type: "act",
      handId: view.game.handId,
      action: "fold",
      requestId: "peek-owner-folds",
      expectedRevision: view.room.revision,
    }));
    view = await service.applyCommand(room.id, target.id, parseMultiplayerCommand({
      type: "act",
      handId: view.game.handId,
      action: "fold",
      requestId: "peek-target-folds",
      expectedRevision: view.room.revision,
    }));
    assert.equal(view.table.phase, "between_hands");

    const storedBefore = JSON.parse(sqlite.prepare("SELECT state_json FROM rooms WHERE id = ?").get(room.id).state_json);
    const targetHole = storedBefore.hand.players.find((player) => player.seat === 1).hole;
    const peekCommand = parseMultiplayerCommand({
      type: "peek",
      handId: view.game.handId,
      targetSeat: 1,
      requestId: "peek-owner-target-once",
      expectedRevision: view.room.revision,
    });
    const revisionBeforePeek = view.room.revision;
    const ownerView = await service.applyCommand(room.id, owner.id, peekCommand);
    assert.equal(ownerView.room.revision, revisionBeforePeek + 1);
    assert.deepEqual(ownerView.table.seats.find((seat) => seat.seat === 1).holeCards, targetHole);
    assert.equal(ownerView.table.seats.find((seat) => seat.seat === 1).privatelyPeeked, true);
    assert.equal(ownerView.players.find((player) => player.seat === 1).privatelyPeeked, true);
    assert.deepEqual(
      ownerView.game.privatePeekTargets.find((entry) => entry.seat === 1).holeCards,
      ownerView.players.find((player) => player.seat === 1).holeCards,
    );
    assert.equal(ownerView.table.hand.privatePeekRemaining, 4);
    assert.deepEqual(ownerView.table.hand.privatePeekedSeats, [1]);

    const otherView = await service.getSnapshot(room.id, other.id);
    assert.equal(otherView.table.seats.find((seat) => seat.seat === 1).holeCards, null);
    assert.equal(otherView.table.seats.find((seat) => seat.seat === 1).privatelyPeeked, false);
    assert.equal(otherView.players.find((player) => player.seat === 1).holeCards, undefined);
    assert.equal(otherView.players.find((player) => player.seat === 1).privatelyPeeked, false);
    assert.equal(otherView.game.privatePeekTargets.find((entry) => entry.seat === 1).holeCards, undefined);
    assert.equal(otherView.table.hand.privatePeekRemaining, 5);
    assert.deepEqual(otherView.table.hand.privatePeekedSeats, []);
    assert.doesNotMatch(JSON.stringify(otherView), /privatePeekedSeatsByAccountId|peek-d1-owner/);

    const retryView = await service.applyCommand(room.id, owner.id, peekCommand);
    assert.equal(retryView.room.revision, ownerView.room.revision);
    assert.equal(retryView.table.hand.privatePeekRemaining, 4);
    assert.deepEqual(retryView.table.hand.privatePeekedSeats, [1]);
    assert.deepEqual(retryView.table.seats.find((seat) => seat.seat === 1).holeCards, targetHole);
    const storedAfter = JSON.parse(sqlite.prepare("SELECT state_json FROM rooms WHERE id = ?").get(room.id).state_json);
    assert.deepEqual(storedAfter.hand.privatePeekedSeatsByAccountId, { [owner.id]: [1] });
    assert.equal(storedAfter.revision, ownerView.room.revision);
  } finally {
    sqlite.close();
  }
});

test("D1 winner snapshots expose authoritative best five only for publicly shown winners", async () => {
  const { sqlite, store } = await testStore();
  try {
    const owner = (await store.registerAccount("five-owner", "五张房主")).account;
    const guest = (await store.registerAccount("five-guest", "五张来宾")).account;
    const room = await store.createRoom(owner.id, "最佳五张测试桌", 2);
    await store.joinRoom(guest.id, room.joinCode);
    const service = new MultiplayerGameService(new SqliteD1Database(sqlite));

    let view = await service.getSnapshot(room.id, owner.id);
    view = await service.applyCommand(room.id, owner.id, parseMultiplayerCommand({
      type: "ready",
      ready: true,
      requestId: "five-ready-owner",
      expectedRevision: view.room.revision,
    }));
    view = await service.applyCommand(room.id, guest.id, parseMultiplayerCommand({
      type: "ready",
      ready: true,
      requestId: "five-ready-guest",
      expectedRevision: view.room.revision,
    }));
    view = await service.applyCommand(room.id, owner.id, parseMultiplayerCommand({
      type: "start",
      requestId: "five-start-owner",
      expectedRevision: view.room.revision,
    }));
    view = await service.applyCommand(room.id, owner.id, parseMultiplayerCommand({
      type: "act",
      handId: view.game.handId,
      action: "raise",
      raiseTo: 1000,
      requestId: "five-owner-all-in",
      expectedRevision: view.room.revision,
    }));
    assert.deepEqual(
      (({ amount, toAmount, raiseTo, potAfter, stackAfter }) => ({
        amount,
        toAmount,
        raiseTo,
        potAfter,
        stackAfter,
      }))(view.game.recentActions.at(-1)),
      { amount: 995, toAmount: 1000, raiseTo: 1000, potAfter: 1010, stackAfter: 0 },
    );
    view = await service.applyCommand(room.id, guest.id, parseMultiplayerCommand({
      type: "act",
      handId: view.game.handId,
      action: "call",
      requestId: "five-guest-calls",
      expectedRevision: view.room.revision,
    }));

    assert.equal(view.table.phase, "between_hands");
    assert.ok(view.game.result.winningHands.length >= 1);
    assert.equal(view.game.result.winningHands.length, view.game.result.winners.length);
    assert.ok(view.game.result.winningHands.every((entry) => entry.cards.length === 5));

    const stored = sqlite.prepare("SELECT state_json FROM rooms WHERE id = ?").get(room.id);
    const privateState = JSON.parse(stored.state_json);
    const winnerSeats = new Set(privateState.hand.result.winnerSeats);
    privateState.hand.players.forEach((player) => {
      if (winnerSeats.has(player.seat)) player.shown = false;
    });
    sqlite.prepare("UPDATE rooms SET state_json = ? WHERE id = ?").run(JSON.stringify(privateState), room.id);

    const firstWinnerSeat = privateState.hand.result.winnerSeats[0];
    const winnerAccountId = firstWinnerSeat === 0 ? owner.id : guest.id;
    const privateWinnerView = await service.getSnapshot(room.id, winnerAccountId);
    assert.ok(
      privateWinnerView.game.players.find((player) => player.seat === firstWinnerSeat)?.holeCards,
      "a viewer still sees their own hole cards",
    );
    assert.deepEqual(
      privateWinnerView.game.result.winningHands,
      [],
      "own-card visibility must not bypass a mucked winner's public projection",
    );
  } finally {
    sqlite.close();
  }
});

test("D1 persists one shared finished report and keeps the same room restartable", async () => {
  const { sqlite, store } = await testStore();
  try {
    const owner = (await store.registerAccount("finish-owner", "结算房主")).account;
    const guest = (await store.registerAccount("finish-guest", "结算来宾")).account;
    const outsider = (await store.registerAccount("finish-outsider", "候补玩家")).account;
    const room = await store.createRoom(owner.id, "整局结算桌", 3);
    await store.joinRoom(guest.id, room.joinCode);
    const service = new MultiplayerGameService(new SqliteD1Database(sqlite));

    let ownerView = await service.getSnapshot(room.id, owner.id);
    ownerView = await service.applyCommand(room.id, owner.id, parseMultiplayerCommand({
      type: "ready",
      ready: true,
      requestId: "finish-ready-owner",
      expectedRevision: ownerView.room.revision,
    }));
    let guestView = await service.applyCommand(room.id, guest.id, parseMultiplayerCommand({
      type: "ready",
      ready: true,
      requestId: "finish-ready-guest",
      expectedRevision: ownerView.room.revision,
    }));
    ownerView = await service.applyCommand(room.id, owner.id, parseMultiplayerCommand({
      type: "start",
      requestId: "finish-start-owner",
      expectedRevision: guestView.room.revision,
    }));
    ownerView = await service.applyCommand(room.id, owner.id, parseMultiplayerCommand({
      type: "finish",
      requestId: "finish-request-owner",
      expectedRevision: ownerView.room.revision,
    }));
    assert.equal(ownerView.table.finishRequested, true);
    ownerView = await service.applyCommand(room.id, owner.id, parseMultiplayerCommand({
      type: "act",
      handId: ownerView.game.handId,
      action: "fold",
      requestId: "finish-owner-folds",
      expectedRevision: ownerView.room.revision,
    }));
    assert.equal(ownerView.table.phase, "between_hands");

    guestView = await service.getSnapshot(room.id, guest.id);
    guestView = await service.applyCommand(room.id, guest.id, parseMultiplayerCommand({
      type: "show",
      handId: guestView.game.handId,
      show: false,
      requestId: "finish-guest-mucks",
      expectedRevision: guestView.room.revision,
    }));
    assert.equal(guestView.table.phase, "between_hands", "mucking does not add or skip a second wait");
    const waitingStateRow = sqlite.prepare("SELECT state_json FROM rooms WHERE id = ?").get(room.id);
    const waitingState = JSON.parse(waitingStateRow.state_json);
    waitingState.hand.nextHandAt = 0;
    sqlite.prepare("UPDATE rooms SET state_json = ? WHERE id = ?").run(JSON.stringify(waitingState), room.id);
    guestView = await service.applyCommand(room.id, guest.id, parseMultiplayerCommand({
      type: "timeout",
      handId: guestView.game.handId,
      requestId: "finish-shared-wait-expires",
      expectedRevision: guestView.room.revision,
    }));
    assert.equal(guestView.table.phase, "finished");
    assert.equal(guestView.room.status, "finished");
    assert.equal(guestView.table.sessionReport.handsCompleted, 1);

    ownerView = await service.getSnapshot(room.id, owner.id);
    assert.deepEqual(ownerView.table.sessionReport, guestView.table.sessionReport);
    assert.equal((await store.listRooms(owner.id))[0].status, "finished");
    const persisted = sqlite.prepare("SELECT status, state_json FROM rooms WHERE id = ?").get(room.id);
    assert.equal(persisted.status, "playing", "finished stays readable without expanding the deployed status constraint");
    assert.equal(JSON.parse(persisted.state_json).phase, "finished");
    await assert.rejects(
      store.joinRoom(outsider.id, room.joinCode),
      (error) => error instanceof MultiplayerStoreError && error.code === "ROOM_NOT_FOUND",
    );

    ownerView = await service.applyCommand(room.id, owner.id, parseMultiplayerCommand({
      type: "restart",
      requestId: "finish-restart-owner",
      expectedRevision: ownerView.room.revision,
    }));
    assert.equal(ownerView.table.phase, "lobby");
    assert.equal(ownerView.table.sessionReport, null);
    assert.equal((await store.listRooms(owner.id))[0].status, "lobby");
  } finally {
    sqlite.close();
  }
});

test("D1 permanently leaves during a hand, frees membership, and makes a one-player table joinable", async () => {
  const { sqlite, store } = await testStore();
  try {
    const owner = (await store.registerAccount("leave-owner", "离桌庄家")).account;
    const guest = (await store.registerAccount("leave-guest", "留桌玩家")).account;
    const room = await store.createRoom(owner.id, "退出回归桌", 2);
    await store.joinRoom(guest.id, room.joinCode);
    const service = new MultiplayerGameService(new SqliteD1Database(sqlite));

    let ownerView = await service.getSnapshot(room.id, owner.id);
    ownerView = await service.applyCommand(room.id, owner.id, parseMultiplayerCommand({
      type: "ready",
      ready: true,
      requestId: "leave-ready-owner",
      expectedRevision: ownerView.room.revision,
    }));
    let guestView = await service.applyCommand(room.id, guest.id, parseMultiplayerCommand({
      type: "ready",
      ready: true,
      requestId: "leave-ready-guest",
      expectedRevision: ownerView.room.revision,
    }));
    ownerView = await service.applyCommand(room.id, owner.id, parseMultiplayerCommand({
      type: "start",
      requestId: "leave-start-owner",
      expectedRevision: guestView.room.revision,
    }));
    assert.equal(ownerView.table.phase, "playing");

    const departedView = await service.applyCommand(room.id, owner.id, parseMultiplayerCommand({
      type: "leave",
      requestId: "leave-during-hand",
      expectedRevision: ownerView.room.revision,
    }));
    assert.equal(departedView.table.phase, "between_hands");
    assert.equal(departedView.room.memberCount, 1);
    assert.equal(sqlite.prepare("SELECT count(*) AS count FROM room_members WHERE room_id = ? AND account_id = ?")
      .get(room.id, owner.id).count, 0);
    assert.deepEqual(await store.listRooms(owner.id), []);

    guestView = await service.getSnapshot(room.id, guest.id);
    assert.equal(guestView.table.seats.some((seat) => seat.seat === 0), false, "the departed seat is released immediately");
    guestView = await service.applyCommand(room.id, guest.id, parseMultiplayerCommand({
      type: "show",
      handId: guestView.game.handId,
      show: false,
      requestId: "leave-winner-muck",
      expectedRevision: guestView.room.revision,
    }));
    assert.equal(guestView.table.phase, "between_hands");
    const waitingStateRow = sqlite.prepare("SELECT state_json FROM rooms WHERE id = ?").get(room.id);
    const waitingState = JSON.parse(waitingStateRow.state_json);
    waitingState.hand.nextHandAt = 0;
    sqlite.prepare("UPDATE rooms SET state_json = ? WHERE id = ?").run(JSON.stringify(waitingState), room.id);
    guestView = await service.applyCommand(room.id, guest.id, parseMultiplayerCommand({
      type: "timeout",
      handId: guestView.game.handId,
      requestId: "leave-shared-wait-expires",
      expectedRevision: guestView.room.revision,
    }));
    assert.equal(guestView.table.phase, "lobby");
    assert.equal(guestView.game.pot, 10, "completed snapshots keep the settled pot instead of displaying zero");
    assert.equal(guestView.room.ownerAccountId, guestView.selfAccountId);
    assert.equal(guestView.room.memberCount, 1);

    const rejoined = await store.joinRoom(owner.id, room.joinCode);
    assert.equal(rejoined.joined, true);
    assert.equal(rejoined.room.memberCount, 2);
    const restored = await service.getSnapshot(room.id, owner.id);
    assert.equal(restored.table.phase, "lobby");
    assert.equal(restored.table.viewerSeat, 0);
  } finally {
    sqlite.close();
  }
});
