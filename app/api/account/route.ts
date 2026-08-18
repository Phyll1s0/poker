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
    return privateJson({ registered: Boolean(account), account });
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
    const result = await store.registerAccount(user.userId, payload.handle);
    return privateJson(
      { registered: true, account: result.account },
      { status: result.created ? 201 : 200 },
    );
  } catch (error) {
    return multiplayerErrorResponse(error);
  }
}
