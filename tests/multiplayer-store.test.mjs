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
  assert.throws(
    () => normalizeMaxPlayers(7),
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
  }), {
    tableMode: "cash",
    startingStack: 2_000,
    actionTimeMs: 10_000,
    initialTimeBankMs: 100_000,
  });
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
  assert.match(joinRoute, /joinRoom\(account\.id, payload\.joinCode\)/);
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

    assert.equal(ownerView.table.phase, "playing");
    assert.equal(ownerView.table.viewerSeat, 0);
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
