import { getChatGPTUser } from "../../../chatgpt-auth";
import {
  apiError,
  multiplayerErrorResponse,
  privateJson,
  readSameOriginJson,
} from "../../../../lib/multiplayer-http";
import { getMultiplayerStore } from "../../../../lib/multiplayer-store";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return apiError(401, "UNAUTHENTICATED", "请先使用 ChatGPT 登录。");

  try {
    const payload = await readSameOriginJson(request);
    const store = await getMultiplayerStore();
    const account = await store.getAccountBySubject(user.userId);
    if (!account) return apiError(409, "ACCOUNT_REQUIRED", "请先设置牌桌昵称。");

    const result = await store.joinRoom(account.id, payload.joinCode);
    return privateJson(
      { room: result.room },
      { status: result.joined ? 201 : 200 },
    );
  } catch (error) {
    return multiplayerErrorResponse(error);
  }
}
