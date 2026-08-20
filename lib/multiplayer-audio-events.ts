import type { PokerSound } from "./poker-audio";

export const MULTIPLAYER_AUDIO_EVENT_MAX_AGE_MS = 5_000;
export const MULTIPLAYER_AUDIO_ACTION_GAP_SECONDS = 0.12;
export const MULTIPLAYER_AUDIO_DEAL_GAP_SECONDS = 0.3;
export const MULTIPLAYER_AUDIO_ACTION_TO_DEAL_GAP_SECONDS = 0.28;

export type MultiplayerAudioActionEvent = {
  seq: number;
  action: "fold" | "check" | "call" | "raise";
  occurredAt: number;
};

export type MultiplayerAudioFrame = {
  roomId: string;
  handId: string;
  actionSeq: number;
  recentActions: readonly MultiplayerAudioActionEvent[];
  boardCount: number;
  hasResult: boolean;
};

export type MultiplayerAudioCue = {
  sound: PokerSound;
  delaySeconds: number;
};

/**
 * Converts two accepted public snapshots into sounds. The caller always moves
 * its cursor to `next`, even while muted, so an old action is never replayed.
 */
export function multiplayerAudioTransition(
  previous: MultiplayerAudioFrame | null,
  next: MultiplayerAudioFrame | null,
  now = Date.now(),
): MultiplayerAudioCue[] {
  if (!previous || !next) return [];
  if (previous.roomId !== next.roomId || previous.handId !== next.handId) return [];

  const freshActions = next.recentActions
    .filter((event) => (
      event.seq > previous.actionSeq
      && event.seq <= next.actionSeq
      && now - event.occurredAt <= MULTIPLAYER_AUDIO_EVENT_MAX_AGE_MS
    ))
    .sort((left, right) => left.seq - right.seq);
  const firstOccurredAt = freshActions[0]?.occurredAt ?? now;
  let lastActionDelay = 0;
  const cues: MultiplayerAudioCue[] = freshActions.map((event, index) => {
    const elapsedDelay = Math.min(1.2, Math.max(0, (event.occurredAt - firstOccurredAt) / 1_000));
    const delaySeconds = index === 0
      ? 0
      : Math.max(elapsedDelay, lastActionDelay + MULTIPLAYER_AUDIO_ACTION_GAP_SECONDS);
    lastActionDelay = delaySeconds;
    return { sound: event.action, delaySeconds };
  });

  const boardDelta = Math.max(0, next.boardCount - previous.boardCount);
  const dealStart = freshActions.length
    ? lastActionDelay + MULTIPLAYER_AUDIO_ACTION_TO_DEAL_GAP_SECONDS
    : 0;
  for (let index = 0; index < boardDelta; index += 1) {
    cues.push({
      sound: "deal",
      delaySeconds: dealStart + index * MULTIPLAYER_AUDIO_DEAL_GAP_SECONDS,
    });
  }

  if (!previous.hasResult && next.hasResult) {
    const actionTail = freshActions.length ? lastActionDelay + 0.32 : 0;
    const dealTail = boardDelta > 0
      ? dealStart + 0.52 + (boardDelta - 1) * MULTIPLAYER_AUDIO_DEAL_GAP_SECONDS
      : 0;
    cues.push({ sound: "win", delaySeconds: Math.max(actionTail, dealTail) });
  }

  return cues;
}
