import {
  compareMultiplayerChatMessageIds,
  getMultiplayerChatReaction,
  type MultiplayerChatMessage,
  type MultiplayerChatReactionTone,
} from "./multiplayer-chat.ts";

export const MULTIPLAYER_REACTION_AUDIO_MAX_AGE_MS = 5_000;
export const MULTIPLAYER_REACTION_AUDIO_FUTURE_TOLERANCE_MS = 2_000;
export const MULTIPLAYER_REACTION_AUDIO_GAP_SECONDS = 0.18;
export const MULTIPLAYER_REACTION_AUDIO_BATCH_LIMIT = 3;

export type MultiplayerReactionAudioCue = Readonly<{
  messageId: string;
  tone: MultiplayerChatReactionTone;
  delaySeconds: number;
  expiresAt: number;
}>;

/**
 * Converts newly observed, server-confirmed reactions into a restrained sound
 * sequence. A null cursor represents initial hydration, so existing table
 * history never plays on join or reconnect.
 */
export function multiplayerReactionAudioCues(
  previousCursor: string | null,
  incoming: readonly MultiplayerChatMessage[],
  now = Date.now(),
): MultiplayerReactionAudioCue[] {
  if (previousCursor === null) return [];

  const freshById = new Map<string, MultiplayerChatMessage>();
  for (const message of incoming) {
    if (compareMultiplayerChatMessageIds(message.id, previousCursor) <= 0) continue;
    if (message.kind !== "reaction" || !Number.isFinite(message.createdAt)) continue;
    const age = now - message.createdAt;
    if (
      age > MULTIPLAYER_REACTION_AUDIO_MAX_AGE_MS
      || age < -MULTIPLAYER_REACTION_AUDIO_FUTURE_TOLERANCE_MS
    ) continue;
    if (!getMultiplayerChatReaction(message.content)) continue;
    freshById.set(message.id, message);
  }

  const newest = [...freshById.values()]
    .sort((left, right) => compareMultiplayerChatMessageIds(left.id, right.id))
    .slice(-MULTIPLAYER_REACTION_AUDIO_BATCH_LIMIT);

  return newest.map((message, index) => ({
    messageId: message.id,
    tone: getMultiplayerChatReaction(message.content)!.tone,
    delaySeconds: index * MULTIPLAYER_REACTION_AUDIO_GAP_SECONDS,
    expiresAt: message.createdAt + MULTIPLAYER_REACTION_AUDIO_MAX_AGE_MS,
  }));
}
