const MAX_JSON_BYTES = 4 * 1024;
const NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
} as const;

export class MultiplayerHttpError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(
    status: number,
    code: string,
    message: string,
  ) {
    super(message);
    this.name = "MultiplayerHttpError";
    this.status = status;
    this.code = code;
  }
}

export function privateJson(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", NO_STORE_HEADERS["Cache-Control"]);
  headers.set("Pragma", NO_STORE_HEADERS.Pragma);
  headers.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(data), { ...init, headers });
}

export function apiError(status: number, code: string, message: string): Response {
  return privateJson({ error: code, message }, { status });
}

export async function readSameOriginJson(request: Request): Promise<Record<string, unknown>> {
  const requestOrigin = new URL(request.url).origin;
  const origin = request.headers.get("origin");
  if (!origin || origin !== requestOrigin) {
    throw new MultiplayerHttpError(403, "CROSS_ORIGIN_REQUEST", "只接受来自本站的请求。");
  }

  const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/json") {
    throw new MultiplayerHttpError(415, "JSON_REQUIRED", "请求需要使用 JSON 格式。");
  }

  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_JSON_BYTES) {
    throw new MultiplayerHttpError(413, "PAYLOAD_TOO_LARGE", "请求内容过大。");
  }

  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > MAX_JSON_BYTES) {
    throw new MultiplayerHttpError(413, "PAYLOAD_TOO_LARGE", "请求内容过大。");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new MultiplayerHttpError(400, "INVALID_JSON", "JSON 内容无法解析。");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new MultiplayerHttpError(400, "INVALID_JSON", "JSON 顶层需要是对象。");
  }
  return parsed as Record<string, unknown>;
}

const STORE_ERROR_CODES = new Set([
  "INVALID_HANDLE",
  "HANDLE_TAKEN",
  "INVALID_ROOM",
  "ROOM_NOT_FOUND",
  "ROOM_FULL",
]);

function isStoreError(error: unknown): error is Error & { code: string } {
  return error instanceof Error
    && error.name === "MultiplayerStoreError"
    && "code" in error
    && typeof error.code === "string"
    && STORE_ERROR_CODES.has(error.code);
}

function storeErrorStatus(code: string): number {
  if (code === "ROOM_NOT_FOUND") return 404;
  if (code === "HANDLE_TAKEN" || code === "ROOM_FULL") return 409;
  return 400;
}

export function multiplayerErrorResponse(error: unknown): Response {
  if (error instanceof MultiplayerHttpError) {
    return apiError(error.status, error.code, error.message);
  }
  if (isStoreError(error)) {
    return apiError(storeErrorStatus(error.code), error.code, error.message);
  }

  console.error("Unexpected multiplayer API error", error);
  return apiError(500, "INTERNAL_ERROR", "服务器暂时无法完成请求。");
}
