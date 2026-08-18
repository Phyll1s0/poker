import assert from "node:assert/strict";
import test from "node:test";

import {
  MultiplayerHttpError,
  multiplayerErrorResponse,
  privateJson,
  readSameOriginJson,
} from "../lib/multiplayer-http.ts";
import { MultiplayerStoreError } from "../lib/multiplayer-store.ts";

function jsonRequest(body, headers = {}) {
  return new Request("https://poker.example/api/account", {
    method: "POST",
    headers: {
      "content-type": "application/json; charset=utf-8",
      origin: "https://poker.example",
      ...headers,
    },
    body,
  });
}

test("same-origin JSON reader accepts a small object", async () => {
  const payload = await readSameOriginJson(jsonRequest(JSON.stringify({ handle: "河牌玩家" })));
  assert.deepEqual(payload, { handle: "河牌玩家" });
});

test("same-origin JSON reader rejects cross-origin and non-JSON mutations", async () => {
  await assert.rejects(
    readSameOriginJson(jsonRequest("{}", { origin: "https://evil.example" })),
    (error) => error instanceof MultiplayerHttpError && error.code === "CROSS_ORIGIN_REQUEST",
  );
  await assert.rejects(
    readSameOriginJson(jsonRequest("{}", { "content-type": "text/plain" })),
    (error) => error instanceof MultiplayerHttpError && error.code === "JSON_REQUIRED",
  );
});

test("same-origin JSON reader enforces object shape and payload limits", async () => {
  await assert.rejects(
    readSameOriginJson(jsonRequest("[]")),
    (error) => error instanceof MultiplayerHttpError && error.code === "INVALID_JSON",
  );
  await assert.rejects(
    readSameOriginJson(jsonRequest("not-json")),
    (error) => error instanceof MultiplayerHttpError && error.code === "INVALID_JSON",
  );
  await assert.rejects(
    readSameOriginJson(jsonRequest(JSON.stringify({ value: "x".repeat(5000) }))),
    (error) => error instanceof MultiplayerHttpError && error.code === "PAYLOAD_TOO_LARGE",
  );
});

test("API responses are private, non-cacheable, and use stable errors", async () => {
  const success = privateJson({ ok: true }, { status: 201 });
  assert.equal(success.status, 201);
  assert.equal(success.headers.get("cache-control"), "private, no-store, max-age=0");
  assert.equal(success.headers.get("pragma"), "no-cache");
  assert.deepEqual(await success.json(), { ok: true });

  const missing = multiplayerErrorResponse(
    new MultiplayerStoreError("ROOM_NOT_FOUND", "没有找到这个房间。"),
  );
  assert.equal(missing.status, 404);
  assert.deepEqual(await missing.json(), {
    error: "ROOM_NOT_FOUND",
    message: "没有找到这个房间。",
  });

  const collision = multiplayerErrorResponse(
    new MultiplayerStoreError("HANDLE_TAKEN", "这个昵称已经有人使用。"),
  );
  assert.equal(collision.status, 409);
});
