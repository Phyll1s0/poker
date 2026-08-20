import MultiplayerClient, {
  type MultiplayerOperation,
  type MultiplayerRequest,
} from "../app/multiplayer/MultiplayerClient";

const API_URL = "https://mnzkqcccrdfathidprfm.supabase.co/functions/v1/poker-api";
const TOKEN_KEY = "rangecraft.multiplayer.guest-token.v1";

type ApiErrorBody = {
  error?: string;
  message?: string;
};

function storedToken(): string | null {
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function saveToken(token: string): void {
  try {
    window.localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // The current tab can still use the identity until it reloads.
  }
}

function clearToken(): void {
  try {
    window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Nothing else is required when storage is unavailable.
  }
}

function edgeAction(
  operation: MultiplayerOperation,
  payload: Record<string, unknown>,
): Record<string, unknown> {
  if (operation === "getAccount") return { action: "account" };
  if (operation === "register") return { action: "register", ...payload };
  if (operation === "listRooms") return { action: "rooms" };
  if (operation === "createRoom") return { action: "create-room", ...payload };
  if (operation === "joinRoom") return { action: "join-room", ...payload };
  if (operation === "getRoom") return { action: "room-state", ...payload };

  const command = (payload.command ?? {}) as Record<string, unknown>;
  const { action: pokerAction, ...commandPayload } = command;
  return {
    action: "command",
    roomId: payload.roomId,
    ...commandPayload,
    ...(pokerAction === undefined ? {} : { pokerAction }),
  };
}

const request: MultiplayerRequest = async <T,>(
  operation: MultiplayerOperation,
  payload: Record<string, unknown> = {},
): Promise<T> => {
  const token = storedToken();
  if (operation === "getAccount" && !token) return { account: null } as T;
  if (operation !== "register" && !token) throw new Error("请先输入牌桌昵称。");

  let response: Response;
  try {
    response = await fetch(API_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(edgeAction(operation, payload)),
    });
  } catch {
    throw new Error("无法连接在线牌桌服务。若已开启代理，请将 *.supabase.co 设为直连后重试。");
  }
  const body = (await response.json().catch(() => ({}))) as T & ApiErrorBody & { token?: string };
  if (!response.ok) {
    if (response.status === 401) clearToken();
    if (operation === "getAccount" && response.status === 401) return { account: null } as T;
    throw new Error(body.message || `牌桌请求失败（${response.status}）`);
  }
  if (operation === "register" && body.token) saveToken(body.token);
  return body;
};

export default function MultiplayerApp() {
  return (
    <MultiplayerClient
      displayName="访客"
      signOutHref="#/"
      signOutLabel="返回首页"
      homeHref="#/"
      request={request}
    />
  );
}
