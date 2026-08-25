import type { MultiplayerChatReactionTone } from "./multiplayer-chat.ts";

type MultiplayerReactionVoiceStyle = Readonly<{
  pitch: number;
  rate: number;
  volume: number;
}>;

/**
 * Original, intentionally short table-talk lines. Keeping the copy local and
 * deterministic means a server-confirmed reaction sounds the same after every
 * render and never sends arbitrary chat text to the browser speech engine.
 */
export const MULTIPLAYER_REACTION_VOICE_LINES = Object.freeze({
  praise: Object.freeze(["漂亮！", "可以呀！", "好牌！"]),
  lucky: Object.freeze(["运气真好！", "又中了！", "好险呀！"]),
  frustrated: Object.freeze(["牌太差啦！", "又来？", "真不来牌！"]),
  taunt: Object.freeze(["来抓我呀！", "敢跟吗？", "就这呀？"]),
  surprised: Object.freeze(["真的假的？", "这也行？", "太离谱啦！"]),
  thinking: Object.freeze(["让我想想。", "等一下哦。", "别催嘛。"]),
} satisfies Record<MultiplayerChatReactionTone, readonly string[]>);

/** Bright, quick delivery keeps reactions playful even when no named female voice exists. */
export const MULTIPLAYER_REACTION_VOICE_STYLES = Object.freeze({
  praise: Object.freeze({ pitch: 1.18, rate: 1.28, volume: 0.58 }),
  lucky: Object.freeze({ pitch: 1.24, rate: 1.32, volume: 0.6 }),
  frustrated: Object.freeze({ pitch: 1.12, rate: 1.25, volume: 0.56 }),
  taunt: Object.freeze({ pitch: 1.2, rate: 1.3, volume: 0.58 }),
  surprised: Object.freeze({ pitch: 1.28, rate: 1.34, volume: 0.6 }),
  thinking: Object.freeze({ pitch: 1.1, rate: 1.2, volume: 0.54 }),
} satisfies Record<MultiplayerChatReactionTone, MultiplayerReactionVoiceStyle>);

/** FNV-1a keeps even decimal ids beyond Number.MAX_SAFE_INTEGER stable. */
export function multiplayerReactionVoiceIndex(
  tone: MultiplayerChatReactionTone,
  messageId: string,
): number {
  let hash = 0x811c9dc5;
  const source = `${tone}:${messageId}`;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % MULTIPLAYER_REACTION_VOICE_LINES[tone].length;
}

export function multiplayerReactionVoiceLine(
  tone: MultiplayerChatReactionTone,
  messageId: string,
): string {
  return MULTIPLAYER_REACTION_VOICE_LINES[tone][multiplayerReactionVoiceIndex(tone, messageId)];
}
