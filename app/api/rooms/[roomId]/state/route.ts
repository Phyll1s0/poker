import { getChatGPTUser } from "../../../../chatgpt-auth";
import { apiError, multiplayerErrorResponse, privateJson } from "../../../../../lib/multiplayer-http";
import {
  getMultiplayerGameService,
  MultiplayerGameError,
} from "../../../../../lib/multiplayer-game";
import { getMultiplayerStore } from "../../../../../lib/multiplayer-store";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ roomId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const user = await getChatGPTUser();
  if (!user) return apiError(401, "UNAUTHENTICATED", "请先使用 ChatGPT 登录。");

  try {
    const account = await (await getMultiplayerStore()).getAccountBySubject(user.userId);
    if (!account) return apiError(409, "ACCOUNT_REQUIRED", "请先设置牌桌昵称。");

    const { roomId } = await context.params;
    const snapshot = await (await getMultiplayerGameService()).getSnapshot(roomId, account.id);
    const after = new URL(request.url).searchParams.get("after");
    if (after !== null && Number(after) === snapshot.room.revision) {
      return new Response(null, {
        status: 204,
        headers: { "Cache-Control": "private, no-store, max-age=0", Pragma: "no-cache" },
      });
    }
    return privateJson(snapshot);
  } catch (error) {
    if (error instanceof MultiplayerGameError) {
      return apiError(error.status, error.code, error.message);
    }
    return multiplayerErrorResponse(error);
  }
}
