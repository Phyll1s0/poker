export const MULTIPLAYER_CHAT_MESSAGE_LIMIT = 50;
export const MULTIPLAYER_CHAT_MAX_LENGTH = 120;
export const MULTIPLAYER_CHAT_REACTIONS = ["👍", "😂", "😮", "😅", "🔥", "🤔"] as const;

export type MultiplayerChatReaction = (typeof MULTIPLAYER_CHAT_REACTIONS)[number];
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
