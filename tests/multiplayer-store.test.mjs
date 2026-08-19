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
