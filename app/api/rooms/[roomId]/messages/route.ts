import { getChatGPTUser } from "../../../../chatgpt-auth";
import {
  apiError,
  multiplayerErrorResponse,
  privateJson,
  readSameOriginJson,
} from "../../../../../lib/multiplayer-http";
import {
  getMultiplayerGameService,
  MultiplayerGameError,
  parseMultiplayerMessageCursor,
  parseMultiplayerRoomMessage,
} from "../../../../../lib/multiplayer-game";
import { getMultiplayerStore } from "../../../../../lib/multiplayer-store";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ roomId: string }> };

async function currentAccountId() {
  const user = await getChatGPTUser();
  if (!user) return { error: apiError(401, "UNAUTHENTICATED", "请先使用 ChatGPT 登录。") } as const;
  const account = await (await getMultiplayerStore()).getAccountBySubject(user.userId);
  if (!account) return { error: apiError(409, "ACCOUNT_REQUIRED", "请先设置牌桌昵称。") } as const;
  return { accountId: account.id } as const;
}

export async function GET(request: Request, context: RouteContext) {
  try {
    const identity = await currentAccountId();
    if ("error" in identity) return identity.error;
    const { roomId } = await context.params;
    const cursor = parseMultiplayerMessageCursor(new URL(request.url).searchParams.get("after"));
    const messages = await (await getMultiplayerGameService()).getMessages(roomId, identity.accountId, cursor);
    return privateJson(messages);
  } catch (error) {
    if (error instanceof MultiplayerGameError) return apiError(error.status, error.code, error.message);
    return multiplayerErrorResponse(error);
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const identity = await currentAccountId();
    if ("error" in identity) return identity.error;
    const payload = await readSameOriginJson(request);
    const message = parseMultiplayerRoomMessage(payload);
    const { roomId } = await context.params;
    const result = await (await getMultiplayerGameService()).sendMessage(roomId, identity.accountId, message);
    return privateJson(result, { status: result.duplicate ? 200 : 201 });
  } catch (error) {
    if (error instanceof MultiplayerGameError) return apiError(error.status, error.code, error.message);
    return multiplayerErrorResponse(error);
  }
}
