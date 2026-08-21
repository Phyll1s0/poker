export const MULTIPLAYER_CHAT_MESSAGE_LIMIT = 50;
export const MULTIPLAYER_CHAT_MAX_LENGTH = 120;

export type MultiplayerChatReactionTone =
  | "praise"
  | "lucky"
  | "frustrated"
  | "taunt"
  | "surprised"
  | "thinking";

export type MultiplayerChatReactionOption = {
  readonly id: string;
  readonly emoji: string;
  readonly label: string;
  readonly tone: MultiplayerChatReactionTone;
};

/**
 * Keep the wire value as the original emoji. Supabase stores reactions in a
 * strict emoji allow-list, so labels remain presentation metadata and older
 * clients can continue to send and display the same payloads.
 */
export const MULTIPLAYER_CHAT_REACTION_CATALOG = Object.freeze([
  Object.freeze({ id: "nice-hand", emoji: "👍", label: "打得漂亮", tone: "praise" }),
  Object.freeze({ id: "lucky-me", emoji: "😂", label: "我真幸运", tone: "lucky" }),
  Object.freeze({ id: "bad-cards", emoji: "😅", label: "牌太差了", tone: "frustrated" }),
  Object.freeze({ id: "come-on", emoji: "🔥", label: "敢跟吗？", tone: "taunt" }),
  Object.freeze({ id: "no-way", emoji: "😮", label: "这也能中？", tone: "surprised" }),
  Object.freeze({ id: "thinking", emoji: "🤔", label: "让我想想", tone: "thinking" }),
] as const satisfies readonly MultiplayerChatReactionOption[]);

export type MultiplayerChatReaction = (typeof MULTIPLAYER_CHAT_REACTION_CATALOG)[number]["emoji"];

/** @deprecated Prefer MULTIPLAYER_CHAT_REACTION_CATALOG for new UI. */
export const MULTIPLAYER_CHAT_REACTIONS = Object.freeze(
  MULTIPLAYER_CHAT_REACTION_CATALOG.map((reaction) => reaction.emoji),
) as readonly MultiplayerChatReaction[];
export type MultiplayerChatKind = "text" | "reaction";

export type MultiplayerChatMessage = {
  id: string;
  seat: number;
  handle: string;
  kind: MultiplayerChatKind;
  content: string;
  createdAt: number;
};

export type MultiplayerChatSnapshot = {
  messages: MultiplayerChatMessage[];
};

export class MultiplayerChatValidationError extends Error {
  readonly code = "INVALID_MESSAGE";

  constructor(message: string) {
    super(message);
    this.name = "MultiplayerChatValidationError";
  }
}

const INVISIBLE_CHARACTERS = /[\p{Cc}\p{Cf}]/gu;
const WHITESPACE = /\s+/gu;
const REACTION_SET = new Set<string>(MULTIPLAYER_CHAT_REACTIONS);
const REACTION_BY_EMOJI = new Map<string, (typeof MULTIPLAYER_CHAT_REACTION_CATALOG)[number]>(
  MULTIPLAYER_CHAT_REACTION_CATALOG.map((reaction) => [reaction.emoji, reaction]),
);

export function getMultiplayerChatReaction(
  content: string,
): (typeof MULTIPLAYER_CHAT_REACTION_CATALOG)[number] | undefined {
  return REACTION_BY_EMOJI.get(content);
}

export function normalizeMultiplayerChatMessage(
  kind: unknown,
  rawContent: unknown,
): { kind: MultiplayerChatKind; content: string } {
  if (kind !== "text" && kind !== "reaction") {
    throw new MultiplayerChatValidationError("消息类型不合法。");
  }
  if (typeof rawContent !== "string") {
    throw new MultiplayerChatValidationError("消息内容不合法。");
  }

  const content = rawContent
    .normalize("NFKC")
    .replace(INVISIBLE_CHARACTERS, "")
    .replace(WHITESPACE, " ")
    .trim();

  if (!content) {
    throw new MultiplayerChatValidationError("消息不能为空。");
  }
  if (Array.from(content).length > MULTIPLAYER_CHAT_MAX_LENGTH) {
    throw new MultiplayerChatValidationError(`消息不能超过 ${MULTIPLAYER_CHAT_MAX_LENGTH} 个字符。`);
  }
  if (kind === "reaction" && !REACTION_SET.has(content)) {
    throw new MultiplayerChatValidationError("这个快捷表情不可用。");
  }

  return { kind, content };
}

export function compareMultiplayerChatMessageIds(left: string, right: string): number {
  const normalizedLeft = left.replace(/^0+(?=\d)/, "");
  const normalizedRight = right.replace(/^0+(?=\d)/, "");
  if (normalizedLeft.length !== normalizedRight.length) {
    return normalizedLeft.length - normalizedRight.length;
  }
  return normalizedLeft.localeCompare(normalizedRight);
}

export function mergeMultiplayerChatMessages(
  current: readonly MultiplayerChatMessage[],
  incoming: readonly MultiplayerChatMessage[],
): MultiplayerChatMessage[] {
  const byId = new Map(current.map((message) => [message.id, message]));
  incoming.forEach((message) => byId.set(message.id, message));
  return [...byId.values()]
    .sort((left, right) => compareMultiplayerChatMessageIds(left.id, right.id))
    .slice(-MULTIPLAYER_CHAT_MESSAGE_LIMIT);
}
