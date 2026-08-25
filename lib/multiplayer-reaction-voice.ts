import type { MultiplayerChatReactionTone } from "./multiplayer-chat.ts";

type MultiplayerReactionVoiceStyle = Readonly<{
  pitch: number;
  rate: number;
  volume: number;
  voiceOffset: number;
}>;

/**
 * Original, intentionally short table-talk lines. Keeping the copy local and
 * deterministic means a server-confirmed reaction sounds the same after every
 * render and never sends arbitrary chat text to the browser speech engine.
 */
export const MULTIPLAYER_REACTION_VOICE_LINES = Object.freeze({
  praise: Object.freeze(["可以啊，这手漂亮！", "有点东西啊！", "好牌，好牌。"]),
  lucky: Object.freeze(["哎哟，这都能中！", "嘿嘿，运气也是实力。", "不好意思，又走运了。"]),
  frustrated: Object.freeze(["啧，这牌真不来。", "又来？我真服了。", "这手牌也太会演了。"]),
  taunt: Object.freeze(["来抓我呀！", "就这？再想想。", "嘿嘿，敢不敢跟？"]),
  surprised: Object.freeze(["啊？这也能中！", "真的假的？", "哇哦，有点离谱。"]),
  thinking: Object.freeze(["别催，我在编呢。", "等等，让我算算。", "嗯……这得想想。"]),
} satisfies Record<MultiplayerChatReactionTone, readonly string[]>);

/** Different delivery profiles keep the six reactions from sharing one flat voice. */
export const MULTIPLAYER_REACTION_VOICE_STYLES = Object.freeze({
  praise: Object.freeze({ pitch: 1.08, rate: 1.16, volume: 0.62, voiceOffset: 0 }),
  lucky: Object.freeze({ pitch: 1.28, rate: 1.22, volume: 0.66, voiceOffset: 1 }),
  frustrated: Object.freeze({ pitch: 0.72, rate: 0.92, volume: 0.62, voiceOffset: 2 }),
  taunt: Object.freeze({ pitch: 0.88, rate: 1.04, volume: 0.68, voiceOffset: 3 }),
  surprised: Object.freeze({ pitch: 1.36, rate: 1.24, volume: 0.66, voiceOffset: 4 }),
  thinking: Object.freeze({ pitch: 0.84, rate: 0.88, volume: 0.58, voiceOffset: 5 }),
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
