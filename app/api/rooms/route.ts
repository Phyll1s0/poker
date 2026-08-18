import { getChatGPTUser } from "../../chatgpt-auth";
import {
  apiError,
  multiplayerErrorResponse,
  privateJson,
  readSameOriginJson,
} from "../../../lib/multiplayer-http";
import { getMultiplayerStore } from "../../../lib/multiplayer-store";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return apiError(401, "UNAUTHENTICATED", "请先使用 ChatGPT 登录。");

  try {
    const store = await getMultiplayerStore();
    const account = await store.getAccountBySubject(user.userId);
    if (!account) return apiError(409, "ACCOUNT_REQUIRED", "请先设置牌桌昵称。");

    const rooms = await store.listRooms(account.id);
    return privateJson({ rooms });
  } catch (error) {
    return multiplayerErrorResponse(error);
  }
}

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return apiError(401, "UNAUTHENTICATED", "请先使用 ChatGPT 登录。");

  try {
    const payload = await readSameOriginJson(request);
    const store = await getMultiplayerStore();
    const account = await store.getAccountBySubject(user.userId);
    if (!account) return apiError(409, "ACCOUNT_REQUIRED", "请先设置牌桌昵称。");

    const room = await store.createRoom(account.id, payload.name, payload.maxPlayers);
    return privateJson({ room }, { status: 201 });
  } catch (error) {
    return multiplayerErrorResponse(error);
  }
}
