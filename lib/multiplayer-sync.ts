export const MULTIPLAYER_FAST_POLL_DELAY_MS = 450;
export const MULTIPLAYER_IDLE_POLL_DELAY_MS = 800;
export const MULTIPLAYER_REALTIME_FALLBACK_POLL_DELAY_MS = 3_000;
export const MULTIPLAYER_HIDDEN_POLL_DELAY_MS = 8_000;
export const MULTIPLAYER_ROOM_REQUEST_TIMEOUT_MS = 8_000;

export function multiplayerRoomPollDelay({
  visible,
  realtimeConnected,
  handActive,
}: {
  visible: boolean;
  realtimeConnected: boolean;
  handActive: boolean;
}): number {
  if (!visible) return MULTIPLAYER_HIDDEN_POLL_DELAY_MS;
  if (realtimeConnected) return MULTIPLAYER_REALTIME_FALLBACK_POLL_DELAY_MS;
  return handActive ? MULTIPLAYER_FAST_POLL_DELAY_MS : MULTIPLAYER_IDLE_POLL_DELAY_MS;
}

export function multiplayerRoomPollWait(
  options: Parameters<typeof multiplayerRoomPollDelay>[0] & { requestElapsedMs: number },
): number {
  const { requestElapsedMs, ...pollOptions } = options;
  const targetCycle = multiplayerRoomPollDelay(pollOptions);
  const elapsed = Number.isFinite(requestElapsedMs) ? Math.max(0, requestElapsedMs) : 0;
  return Math.max(0, targetCycle - elapsed);
}

export async function withMultiplayerRoomRequestTimeout<T>(
  request: (signal: AbortSignal) => Promise<T>,
  timeoutMs = MULTIPLAYER_ROOM_REQUEST_TIMEOUT_MS,
): Promise<T> {
  const controller = new AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await request(controller.signal);
  } finally {
    globalThis.clearTimeout(timer);
  }
}
