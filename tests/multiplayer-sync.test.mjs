import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  MULTIPLAYER_FAST_POLL_DELAY_MS,
  MULTIPLAYER_HIDDEN_POLL_DELAY_MS,
  MULTIPLAYER_IDLE_POLL_DELAY_MS,
  MULTIPLAYER_REALTIME_FALLBACK_POLL_DELAY_MS,
  MULTIPLAYER_ROOM_REQUEST_TIMEOUT_MS,
  multiplayerRoomPollDelay,
  multiplayerRoomPollWait,
  withMultiplayerRoomRequestTimeout,
} from "../lib/multiplayer-sync.ts";

test("uses a fast bounded cycle during a live hand and slows down when idle or hidden", () => {
  assert.equal(multiplayerRoomPollDelay({
    visible: true,
    realtimeConnected: false,
    handActive: true,
  }), MULTIPLAYER_FAST_POLL_DELAY_MS);
  assert.equal(multiplayerRoomPollDelay({
    visible: true,
    realtimeConnected: false,
    handActive: false,
  }), MULTIPLAYER_IDLE_POLL_DELAY_MS);
  assert.equal(multiplayerRoomPollDelay({
    visible: true,
    realtimeConnected: true,
    handActive: true,
  }), MULTIPLAYER_REALTIME_FALLBACK_POLL_DELAY_MS);
  assert.equal(multiplayerRoomPollDelay({
    visible: false,
    realtimeConnected: false,
    handActive: true,
  }), MULTIPLAYER_HIDDEN_POLL_DELAY_MS);
  assert.ok(MULTIPLAYER_FAST_POLL_DELAY_MS >= 400);
});

test("keeps polling start-to-start instead of adding a fixed delay after slow requests", () => {
  assert.equal(multiplayerRoomPollWait({
    visible: true,
    realtimeConnected: false,
    handActive: true,
    requestElapsedMs: 75,
  }), MULTIPLAYER_FAST_POLL_DELAY_MS - 75);
  assert.equal(multiplayerRoomPollWait({
    visible: true,
    realtimeConnected: false,
    handActive: true,
    requestElapsedMs: 900,
  }), 0);
});

test("aborts a stalled room-state request so the polling loop can recover", async () => {
  let signalSeen = false;
  await assert.rejects(
    withMultiplayerRoomRequestTimeout((signal) => new Promise((_resolve, reject) => {
      signalSeen = true;
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    }), 5),
    (error) => error?.name === "AbortError",
  );
  assert.equal(signalSeen, true);
  assert.equal(MULTIPLAYER_ROOM_REQUEST_TIMEOUT_MS, 8_000);
});

test("hosted transports use conditional snapshots and run Supabase beside its database", async () => {
  const [client, adapter, edge, migration, pollMigration] = await Promise.all([
    readFile(new URL("../app/multiplayer/MultiplayerClient.tsx", import.meta.url), "utf8"),
    readFile(new URL("../github-pages/MultiplayerApp.tsx", import.meta.url), "utf8"),
    readFile(new URL("../supabase/functions/poker-api/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260825155910_optimize_member_room_reads.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260825161009_optimize_room_state_poll.sql", import.meta.url), "utf8"),
  ]);

  assert.match(client, /afterRevision: latestRevision\.current/);
  assert.match(client, /\?after=/);
  assert.match(client, /response\.status === 204/);
  assert.match(client, /document\.addEventListener\("visibilitychange", handleVisibility\)/);
  assert.match(client, /performance\.now\(\) - startedAt/);
  assert.match(client, /withMultiplayerRoomRequestTimeout/);
  assert.doesNotMatch(client, /void poll\(\), 1200/);

  assert.match(adapter, /forceFunctionRegion=ap-southeast-2/);
  assert.match(adapter, /response\.status === 204/);
  assert.match(adapter, /withMultiplayerRoomRequestTimeout/);

  assert.match(edge, /database\.rpc\("poker_read_member_room"/);
  assert.match(edge, /database\.rpc\("poker_poll_member_room"/);
  assert.match(edge, /p_after_revision: afterRevision/);
  assert.match(edge, /return emptyResponse\(request\)/);
  assert.match(migration, /join public\.poker_room_members/i);
  assert.match(migration, /poker_consume_rate_limit/i);
  assert.match(migration, /revoke execute[\s\S]*from public, anon, authenticated/i);
  assert.match(migration, /grant execute[\s\S]*to service_role/i);
  assert.match(pollMigration, /case[\s\S]*rooms\.revision = p_after_revision[\s\S]*then null[\s\S]*else to_jsonb\(rooms\)/i);
  assert.match(pollMigration, /revoke execute[\s\S]*from public, anon, authenticated/i);
  assert.match(pollMigration, /grant execute[\s\S]*to service_role/i);
});
