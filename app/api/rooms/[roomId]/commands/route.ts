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
  parseMultiplayerCommand,
} from "../../../../../lib/multiplayer-game";
import { getMultiplayerStore } from "../../../../../lib/multiplayer-store";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ roomId: string }> };

export async function POST(request: Request, context: RouteContext) {
  const user = await getChatGPTUser();
  if (!user) return apiError(401, "UNAUTHENTICATED", "请先使用 ChatGPT 登录。");

  try {
    const payload = await readSameOriginJson(request);
    const account = await (await getMultiplayerStore()).getAccountBySubject(user.userId);
    if (!account) return apiError(409, "ACCOUNT_REQUIRED", "请先设置牌桌昵称。");

    const command = parseMultiplayerCommand(payload);
    const { roomId } = await context.params;
    const snapshot = await (await getMultiplayerGameService()).applyCommand(roomId, account.id, command);
    return privateJson(snapshot);
  } catch (error) {
    if (error instanceof MultiplayerGameError) {
      return apiError(error.status, error.code, error.message);
    }
    return multiplayerErrorResponse(error);
  }
}
