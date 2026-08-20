import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  MULTIPLAYER_CHAT_MAX_LENGTH,
  MULTIPLAYER_CHAT_MESSAGE_LIMIT,
  compareMultiplayerChatMessageIds,
  mergeMultiplayerChatMessages,
  normalizeMultiplayerChatMessage,
} from "../lib/multiplayer-chat.ts";

function message(id, content = `message-${id}`) {
  return {
    id: String(id),
    seat: Number(id) % 6,
    handle: `玩家${id}`,
    kind: "text",
    content,
    createdAt: 1_700_000_000_000 + Number(id),
  };
}

test("chat normalization removes invisible characters and collapses whitespace", () => {
  assert.deepEqual(normalizeMultiplayerChatMessage("text", "  Ｈｉ\u0000\n\t牌桌  "), {
    kind: "text",
    content: "Hi牌桌",
  });
  assert.deepEqual(normalizeMultiplayerChatMessage("reaction", "  🔥  "), {
    kind: "reaction",
    content: "🔥",
  });
});

test("chat rejects empty, oversized, and arbitrary reaction payloads", () => {
  assert.throws(() => normalizeMultiplayerChatMessage("text", "\u200b\n"), /不能为空/);
  assert.throws(
    () => normalizeMultiplayerChatMessage("text", "牌".repeat(MULTIPLAYER_CHAT_MAX_LENGTH + 1)),
    /不能超过/,
  );
  assert.throws(() => normalizeMultiplayerChatMessage("reaction", "<img src=x>"), /不可用/);
  assert.throws(() => normalizeMultiplayerChatMessage("html", "hello"), /类型不合法/);
});

test("message merging is decimal-id ordered, idempotent, and bounded", () => {
  assert.ok(compareMultiplayerChatMessageIds("10", "9") > 0);
  assert.ok(compareMultiplayerChatMessageIds("0009", "10") < 0);
  const incoming = Array.from({ length: MULTIPLAYER_CHAT_MESSAGE_LIMIT + 5 }, (_, index) => message(index + 1));
  const merged = mergeMultiplayerChatMessages([message(5, "old")], [...incoming].reverse());
  assert.equal(merged.length, MULTIPLAYER_CHAT_MESSAGE_LIMIT);
  assert.equal(merged[0].id, "6");
  assert.equal(merged.at(-1).id, "55");
  assert.equal(new Set(merged.map((entry) => entry.id)).size, merged.length);
});

test("hosted chat is isolated from poker revision and protects server-owned identity", async () => {
  const [edge, migration, client, adapter] = await Promise.all([
    readFile(new URL("../supabase/functions/poker-api/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260821090000_create_poker_room_messages.sql", import.meta.url), "utf8"),
    readFile(new URL("../app/multiplayer/MultiplayerClient.tsx", import.meta.url), "utf8"),
    readFile(new URL("../github-pages/MultiplayerApp.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(edge, /action === "room-messages"/);
  assert.match(edge, /action === "send-message"/);
  assert.match(edge, /chat-burst:/);
  assert.match(edge, /chat-user:/);
  assert.match(edge, /chat-room:/);
  assert.match(edge, /select\("id, author_seat, author_handle, kind, body, created_at"\)/);
  const sendMessageSource = edge.slice(
    edge.indexOf("async function sendRoomMessage"),
    edge.indexOf("async function listRooms"),
  );
  assert.doesNotMatch(sendMessageSource, /expectedRevision|applyOnlinePokerCommand/);
  assert.match(migration, /unique \(room_id, guest_id, request_id\)/i);
  assert.match(migration, /for key share of members/i);
  assert.match(migration, /as restrictive[\s\S]*?using \(false\)/i);
  assert.match(migration, /revoke all on sequence public\.poker_room_messages_id_seq/i);
  assert.match(migration, /order by stale\.id desc[\s\S]*?offset 200/i);
  assert.match(client, /role="log"/);
  assert.match(client, /MULTIPLAYER_CHAT_REACTIONS\.map/);
  assert.match(client, /document\.visibilityState === "hidden"/);
  assert.match(client, /chatSendingRef/);
  assert.match(adapter, /action: "room-messages"/);
  assert.match(adapter, /action: "send-message"/);
});
