"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import styles from "./multiplayer.module.css";

type Account = {
  id: string;
  handle: string;
  avatarSeed: string;
};

type RoomSummary = {
  id: string;
  name: string;
  joinCode: string;
  ownerAccountId: string;
  status: "lobby" | "playing" | "finished" | "closed";
  maxPlayers: number;
  memberCount: number;
  revision: number;
};

type Card = {
  rank: string;
  suit: "♠" | "♥" | "♦" | "♣";
};

type PublicPlayer = {
  accountId: string;
  handle: string;
  seat: number;
  stack: number;
  committed: number;
  streetCommitted: number;
  status: "waiting" | "active" | "folded" | "all-in" | "out";
  ready: boolean;
  isOwner: boolean;
  isDealer: boolean;
  holeCards?: Card[];
  holeCardCount: number;
};

type LegalActions = {
  fold: boolean;
  check: boolean;
  callAmount: number | null;
  minRaiseTo: number | null;
  maxRaiseTo: number | null;
};

type PublicGame = {
  handId: string;
  handNo: number;
  street: "preflop" | "flop" | "turn" | "river" | "showdown" | "complete";
  pot: number;
  board: Card[];
  dealerSeat: number;
  actorAccountId: string | null;
  currentBet: number;
  players: PublicPlayer[];
  legalActions: LegalActions | null;
  result: { summary: string; winners: string[] } | null;
};

type RoomSnapshot = {
  room: RoomSummary;
  selfAccountId: string;
  players: PublicPlayer[];
  game: PublicGame | null;
  table: {
    phase: "lobby" | "playing" | "showdown" | "between_hands" | "closed";
    viewerSeat: number | null;
    hand: { pendingShowSeat: number | null } | null;
  };
};

type ApiErrorBody = {
  error?: string;
  message?: string;
};

const ERROR_MESSAGES: Record<string, string> = {
  UNAUTHENTICATED: "登录已失效，请重新登录。",
  ACCOUNT_REQUIRED: "请先设置牌桌昵称。",
  HANDLE_TAKEN: "这个昵称已经有人使用，换一个试试。",
  INVALID_HANDLE: "昵称需要 2–16 个可见字符。",
  INVALID_ROOM: "房间设置不符合要求。",
  ROOM_NOT_FOUND: "没有找到这个房间，请检查邀请码。",
  ROOM_FULL: "这个房间已经坐满了。",
  ROOM_STARTED: "牌局已经开始，暂时不能加入。",
  REVISION_CONFLICT: "牌桌刚刚发生了变化，已为你刷新。",
  STALE_REVISION: "牌桌刚刚发生了变化，已为你刷新。",
  NOT_YOUR_TURN: "现在还没有轮到你行动。",
  PLAYERS_NOT_READY: "所有玩家都准备后才能开局。",
  NOT_ROOM_OWNER: "只有房主可以开始第一手牌。",
  WRONG_PHASE: "当前阶段不能执行这个操作。",
  WRONG_HAND: "这条行动属于上一手牌，已为你刷新。",
  CALL_REQUIRED: "面对下注时不能过牌。",
  CHECK_REQUIRED: "当前无需跟注，可以选择过牌。",
  RAISE_NOT_ALLOWED: "这次不足额全下没有重新开放加注权。",
  SHOW_NOT_ALLOWED: "现在不能执行秀牌操作。",
  ILLEGAL_ACTION: "这个行动在当前局面不合法。",
  INVALID_RAISE: "加注额超出当前允许范围。",
};

function apiErrorMessage(body: ApiErrorBody, fallback: string) {
  if (body.error && ERROR_MESSAGES[body.error]) return ERROR_MESSAGES[body.error];
  return body.message || fallback;
}

async function readJson<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => ({}))) as T & ApiErrorBody;
  if (!response.ok) {
    throw new Error(apiErrorMessage(body, `请求失败（${response.status}）`));
  }
  return body;
}

function requestId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}

export type MultiplayerOperation =
  | "getAccount"
  | "register"
  | "listRooms"
  | "createRoom"
  | "joinRoom"
  | "getRoom"
  | "command";

export type MultiplayerRequest = <T>(
  operation: MultiplayerOperation,
  payload?: Record<string, unknown>,
) => Promise<T>;

const legacyRequest: MultiplayerRequest = async <T,>(
  operation: MultiplayerOperation,
  payload: Record<string, unknown> = {},
): Promise<T> => {
  let url = "/api/account";
  let method = "GET";
  let body: Record<string, unknown> | undefined;
  if (operation === "register") {
    method = "POST";
    body = payload;
  } else if (operation === "listRooms") {
    url = "/api/rooms";
  } else if (operation === "createRoom") {
    url = "/api/rooms";
    method = "POST";
    body = payload;
  } else if (operation === "joinRoom") {
    url = "/api/rooms/join";
    method = "POST";
    body = payload;
  } else if (operation === "getRoom") {
    url = `/api/rooms/${encodeURIComponent(String(payload.roomId ?? ""))}/state`;
  } else if (operation === "command") {
    url = `/api/rooms/${encodeURIComponent(String(payload.roomId ?? ""))}/commands`;
    method = "POST";
    body = payload.command as Record<string, unknown>;
  }
  return readJson<T>(await fetch(url, {
    method,
    cache: "no-store",
    headers: {
      accept: "application/json",
      ...(body ? { "content-type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }));
};

function CardView({ card, mini = false }: { card: Card; mini?: boolean }) {
  const red = card.suit === "♥" || card.suit === "♦";
  if (mini) {
    return (
      <span className={`${styles.miniCard} ${red ? styles.redCard : ""}`}>
        {card.rank}
        <span>{card.suit}</span>
      </span>
    );
  }
  return (
    <span className={`${styles.card} ${red ? styles.redCard : ""}`}>
      {card.rank}
      <span className={styles.cardSuit}>{card.suit}</span>
    </span>
  );
}

function PlayerSeat({
  player,
  selfAccountId,
  actorAccountId,
}: {
  player: PublicPlayer;
  selfAccountId: string;
  actorAccountId: string | null;
}) {
  const cards = player.holeCards ?? [];
  const hiddenCount = cards.length ? 0 : player.holeCardCount;
  const className = [
    styles.seat,
    styles[`seat${Math.max(0, Math.min(5, player.seat))}`],
    player.accountId === actorAccountId ? styles.seatActive : "",
    player.accountId === selfAccountId ? styles.seatSelf : "",
    player.status === "folded" || player.status === "out" ? styles.seatFolded : "",
  ].filter(Boolean).join(" ");

  return (
    <div className={className}>
      <div className={styles.seatHeader}>
        <strong>{player.handle}</strong>
        <span>{player.isDealer ? "D " : ""}{player.status === "all-in" ? "ALL-IN" : player.status}</span>
      </div>
      <div className={styles.seatStack}>
        <span>{player.committed > 0 ? `本手 ${player.committed}` : ""}</span>
        <strong>{player.stack}</strong>
      </div>
      <div className={styles.seatCards} aria-label={`${player.handle} 的手牌`}>
        {cards.map((card, index) => <CardView key={`${card.rank}-${card.suit}-${index}`} card={card} mini />)}
        {Array.from({ length: hiddenCount }, (_, index) => <span className={styles.miniBack} key={`hidden-${index}`} />)}
      </div>
    </div>
  );
}

function WinningHands({ game }: { game: PublicGame }) {
  if (!game.result) return null;
  const winners = game.result.winners
    .map((accountId) => game.players.find((player) => player.accountId === accountId))
    .filter((player): player is PublicPlayer => Boolean(player));

  if (winners.length === 0) return null;

  return (
    <section className={styles.winningHands} aria-label="本手赢家手牌">
      <div className={styles.winningHandsHeading}>
        <span>WINNING HAND</span>
        <strong>赢家手牌</strong>
      </div>
      <div className={styles.winningHandList}>
        {winners.map((player) => {
          const cards = player.holeCards ?? [];
          return (
            <article className={styles.winningHand} key={player.accountId}>
              <div className={styles.winningHandPlayer}>
                <strong>{player.handle}</strong>
                <span>{cards.length ? "获胜底牌" : "手牌未公开"}</span>
              </div>
              {cards.length ? (
                <div className={styles.winningHandCards} aria-label={`${player.handle} 的赢家手牌`}>
                  {cards.map((card, index) => <CardView key={`${card.rank}-${card.suit}-${index}`} card={card} />)}
                </div>
              ) : (
                <div className={styles.winningHandHidden} aria-label={`${player.handle} 选择盖牌`}>
                  <span /><span /><b>已盖牌</b>
                </div>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}

export default function MultiplayerClient({
  displayName,
  signOutHref,
  homeHref = "/",
  request = legacyRequest,
  onSignOut,
}: {
  displayName: string;
  signOutHref: string;
  homeHref?: string;
  request?: MultiplayerRequest;
  onSignOut?: () => void;
}) {
  const [account, setAccount] = useState<Account | null | undefined>(undefined);
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(null);
  const [handle, setHandle] = useState("");
  const [roomName, setRoomName] = useState("朋友练习桌");
  const [maxPlayers, setMaxPlayers] = useState(6);
  const [joinCode, setJoinCode] = useState("");
  const [raiseTo, setRaiseTo] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const latestRevision = useRef(-1);

  const loadRooms = useCallback(async () => {
    const body = await request<{ rooms: RoomSummary[] }>("listRooms");
    setRooms(body.rooms);
  }, [request]);

  const loadAccount = useCallback(async () => {
    try {
      const body = await request<{ account: Account | null }>("getAccount");
      setAccount(body.account);
      if (body.account) await loadRooms();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法读取账户。请稍后重试。");
      setAccount(null);
    }
  }, [loadRooms, request]);

  const loadRoom = useCallback(async (roomId: string, quiet = false) => {
    try {
      const next = await request<RoomSnapshot>("getRoom", { roomId });
      latestRevision.current = next.room.revision;
      setSnapshot(next);
      if (next.game?.legalActions?.minRaiseTo != null) {
        setRaiseTo(next.game.legalActions.minRaiseTo);
      }
      if (!quiet) setError(null);
    } catch (reason) {
      if (!quiet) setError(reason instanceof Error ? reason.message : "无法读取牌桌。请稍后重试。");
    }
  }, [request]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadAccount(), 0);
    return () => window.clearTimeout(timer);
  }, [loadAccount]);

  useEffect(() => {
    if (!snapshot?.room.id) return;
    const roomId = snapshot.room.id;
    const timer = window.setInterval(() => void loadRoom(roomId, true), 1200);
    return () => window.clearInterval(timer);
  }, [loadRoom, snapshot?.room.id]);

  const submitAccount = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = await request<{ account: Account }>("register", { handle });
      setAccount(body.account);
      setNotice(`欢迎，${body.account.handle}。你的牌桌身份已经创建。`);
      await loadRooms();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "昵称保存失败。请稍后重试。");
    } finally {
      setBusy(false);
    }
  };

  const createRoom = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = await request<{ room: RoomSummary }>("createRoom", { name: roomName, maxPlayers });
      await loadRoom(body.room.id);
      await loadRooms();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "创建房间失败。请稍后重试。");
    } finally {
      setBusy(false);
    }
  };

  const joinRoom = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = await request<{ room: RoomSummary }>("joinRoom", { joinCode: joinCode.trim().toUpperCase() });
      setJoinCode("");
      await loadRoom(body.room.id);
      await loadRooms();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "加入房间失败。请检查邀请码。");
    } finally {
      setBusy(false);
    }
  };

  const sendCommand = async (command: Record<string, unknown>) => {
    if (!snapshot) return false;
    setBusy(true);
    setError(null);
    try {
      const next = await request<RoomSnapshot>("command", {
        roomId: snapshot.room.id,
        command: {
          ...command,
          requestId: requestId(),
          expectedRevision: latestRevision.current,
        },
      });
      latestRevision.current = next.room.revision;
      setSnapshot(next);
      await loadRooms();
      return true;
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "牌桌行动失败。请稍后重试。";
      setError(message);
      await loadRoom(snapshot.room.id, true);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const leaveRoom = async () => {
    if (!snapshot) return;
    const left = await sendCommand({ type: "leave" });
    if (!left) return;
    setSnapshot(null);
    latestRevision.current = -1;
    await loadRooms();
  };

  const copyCode = async () => {
    if (!snapshot) return;
    await navigator.clipboard?.writeText(snapshot.room.joinCode).catch(() => undefined);
    setNotice(`邀请码 ${snapshot.room.joinCode} 已复制。`);
  };

  const selfPlayer = useMemo(() => snapshot?.players.find((player) => player.accountId === snapshot.selfAccountId) ?? null, [snapshot]);
  const game = snapshot?.game ?? null;
  const legal = game?.legalActions ?? null;
  const isOwner = snapshot?.room.ownerAccountId === snapshot?.selfAccountId;
  const isMyTurn = Boolean(game && game.actorAccountId === snapshot?.selfAccountId && legal);
  const phase = snapshot?.table.phase ?? null;
  const canLeave = phase === "lobby" || phase === "between_hands";
  const mustChooseShow = Boolean(
    snapshot
      && phase === "showdown"
      && snapshot.table.viewerSeat !== null
      && snapshot.table.hand?.pendingShowSeat === snapshot.table.viewerSeat,
  );

  return (
    <div className={styles.multiplayerPage}>
      <nav className={styles.lobbyNav}>
        <a className={styles.brand} href={homeHref}>
          <span className={styles.brandMark}>R</span>
          <span>RANGECRAFT</span>
        </a>
        <div className={styles.navRight}>
          <span>牌桌身份</span>
          <strong>{account?.handle ?? displayName}</strong>
          <a className={styles.signOut} href={signOutHref} onClick={onSignOut}>退出</a>
        </div>
      </nav>

      <main className={styles.main}>
        {error && <p className={styles.errorBox} role="alert">{error}</p>}
        {notice && <p className={styles.noticeBox}>{notice}</p>}

        {account === undefined && (
          <section className={styles.loadingPanel}>
            <span className={styles.pulse} />
            正在连接多人牌桌…
          </section>
        )}

        {account === null && (
          <section className={styles.setupCard}>
            <p className={styles.eyebrow}>FIRST SEAT · CREATE PROFILE</p>
            <h1>给牌桌上的自己取个名字</h1>
            <p className={styles.setupLead}>
              这是其他玩家唯一能看到的信息。不需要邮箱、密码或注册账户。
            </p>
            <form className={styles.setupForm} onSubmit={submitAccount}>
              <div className={styles.field}>
                <label htmlFor="handle">公开昵称</label>
                <input
                  id="handle"
                  value={handle}
                  onChange={(event) => setHandle(event.target.value)}
                  autoComplete="nickname"
                  minLength={2}
                  maxLength={16}
                  placeholder="例如：RiverFox"
                  required
                />
              </div>
              <p className={styles.formHint}>2–16 个字符；之后可以增加改名功能，现在请选一个容易辨认的昵称。</p>
              <button className={styles.primaryButton} type="submit" disabled={busy}>创建我的牌手身份</button>
            </form>
          </section>
        )}

        {account && !snapshot && (
          <>
            <header className={styles.lobbyHeader}>
              <div>
                <p className={styles.eyebrow}>MULTIPLAYER LOBBY</p>
                <h1>私人牌桌</h1>
              </div>
              <p>创建房间，把邀请码发给朋友。第一版支持 2–6 人、100BB 无限注德州。</p>
            </header>

            <div className={styles.lobbyGrid}>
              <section className={styles.panel}>
                <p className={styles.panelKicker}>NEW TABLE</p>
                <h2 className={styles.panelTitle}>创建一个练习房</h2>
                <form className={styles.createForm} onSubmit={createRoom}>
                  <div className={styles.field}>
                    <label htmlFor="room-name">房间名称</label>
                    <input id="room-name" maxLength={24} value={roomName} onChange={(event) => setRoomName(event.target.value)} required />
                  </div>
                  <div className={styles.field}>
                    <label htmlFor="max-players">人数</label>
                    <select id="max-players" value={maxPlayers} onChange={(event) => setMaxPlayers(Number(event.target.value))}>
                      {[2, 3, 4, 5, 6].map((value) => <option key={value} value={value}>{value} 人</option>)}
                    </select>
                  </div>
                  <button className={styles.primaryButton} type="submit" disabled={busy}>创建</button>
                </form>
              </section>

              <section className={styles.panel}>
                <p className={styles.panelKicker}>INVITATION</p>
                <h2 className={styles.panelTitle}>凭邀请码入桌</h2>
                <form className={styles.joinForm} onSubmit={joinRoom}>
                  <div className={styles.field}>
                    <label htmlFor="join-code">8 位邀请码</label>
                    <input id="join-code" value={joinCode} onChange={(event) => setJoinCode(event.target.value.toUpperCase())} maxLength={8} autoCapitalize="characters" placeholder="AB12CDEF" required />
                  </div>
                  <button className={styles.secondaryButton} type="submit" disabled={busy}>加入</button>
                </form>
              </section>
            </div>

            <section className={styles.panel} style={{ marginTop: 16 }}>
              <p className={styles.panelKicker}>YOUR TABLES</p>
              <h2 className={styles.panelTitle}>我加入的房间</h2>
              {rooms.length === 0 ? (
                <div className={styles.emptyState}>还没有房间。<br />创建一桌，邀请第一位对手吧。</div>
              ) : (
                <ul className={styles.roomList}>
                  {rooms.map((room) => (
                    <li className={styles.roomRow} key={room.id}>
                      <div>
                        <strong>{room.name}</strong>
                        <small>{room.memberCount}/{room.maxPlayers} 人 · {room.status === "lobby" ? "等待开局" : "牌局进行中"} · {room.joinCode}</small>
                      </div>
                      <button className={styles.secondaryButton} type="button" onClick={() => void loadRoom(room.id)}>进入</button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}

        {account && snapshot && (
          <section className={styles.tableShell}>
            <header className={styles.tableTopbar}>
              <div>
                <button className={styles.textButton} type="button" onClick={() => setSnapshot(null)}>← 返回大厅</button>
                <h1>{snapshot.room.name}</h1>
              </div>
              <div className={styles.roomMeta}>
                <button className={styles.codePill} type="button" onClick={copyCode}>邀请码 {snapshot.room.joinCode}</button>
                <span className={styles.statusPill}>{snapshot.players.length}/{snapshot.room.maxPlayers} 人</span>
                <button className={styles.dangerButton} type="button" onClick={() => void leaveRoom()} disabled={busy || !canLeave} title={canLeave ? "离开房间" : "本手结束后才能离开"}>离开</button>
              </div>
            </header>

            {!game && (
              <div className={styles.tableControls}>
                <div>
                  <p className={styles.panelKicker}>WAITING ROOM</p>
                  <h2 className={styles.panelTitle}>人齐后确认准备</h2>
                </div>
                <div className={styles.lobbyPlayers}>
                  {snapshot.players.map((player) => (
                    <div className={styles.lobbyPlayer} key={player.accountId}>
                      <div>
                        <strong>{player.handle}{player.isOwner ? " · 房主" : ""}</strong>
                        <span>{player.ready ? "已准备" : "等待准备"}</span>
                      </div>
                      <span className={`${styles.readyDot} ${player.ready ? styles.readyDotOn : ""}`} />
                    </div>
                  ))}
                </div>
                <div className={styles.actionRow}>
                  <button className={styles.secondaryButton} type="button" disabled={busy} onClick={() => void sendCommand({ type: "ready", ready: !selfPlayer?.ready })}>
                    {selfPlayer?.ready ? "取消准备" : "我已准备"}
                  </button>
                  {isOwner && (
                    <button className={styles.primaryButton} type="button" disabled={busy || snapshot.players.length < 2} onClick={() => void sendCommand({ type: "start" })}>
                      开始牌局
                    </button>
                  )}
                </div>
              </div>
            )}

            {game && (
              <>
                <div className={styles.pokerTable}>
                  <div className={styles.boardArea}>
                    <span className={styles.potLabel}>底池 {game.pot}</span>
                    <div className={styles.cards} aria-label="公共牌">
                      {game.board.map((card, index) => <CardView key={`${card.rank}-${card.suit}-${index}`} card={card} />)}
                      {Array.from({ length: 5 - game.board.length }, (_, index) => <span className={styles.cardSlot} key={`slot-${index}`} />)}
                    </div>
                  </div>
                  {game.players.map((player) => (
                    <PlayerSeat key={player.accountId} player={player} selfAccountId={snapshot.selfAccountId} actorAccountId={game.actorAccountId} />
                  ))}
                </div>

                <div className={styles.tableControls}>
                  {game.result && <div className={styles.resultBanner}>{game.result.summary}</div>}
                  <WinningHands game={game} />
                  <div className={styles.controlSummary}>
                    <span>第 {game.handNo} 手 · <strong>{game.street.toUpperCase()}</strong> · 当前下注 {game.currentBet}</span>
                    <span>
                      {isMyTurn
                        ? "轮到你决定"
                        : mustChooseShow
                          ? "请选择亮出或盖掉赢家手牌"
                          : phase === "showdown"
                            ? "等待赢家决定是否亮牌"
                            : phase === "between_hands"
                              ? "准备后自动开始下一手"
                              : game.actorAccountId
                                ? "等待对手行动"
                                : "本手已结束"}
                    </span>
                  </div>
                  <div className={styles.actionRow}>
                    {isMyTurn && legal?.fold && <button className={styles.dangerButton} type="button" disabled={busy} onClick={() => void sendCommand({ type: "act", handId: game.handId, action: "fold" })}>弃牌</button>}
                    {isMyTurn && legal?.check && <button className={styles.secondaryButton} type="button" disabled={busy} onClick={() => void sendCommand({ type: "act", handId: game.handId, action: "check" })}>过牌</button>}
                    {isMyTurn && legal?.callAmount != null && <button className={styles.secondaryButton} type="button" disabled={busy} onClick={() => void sendCommand({ type: "act", handId: game.handId, action: "call" })}>跟注 {legal.callAmount}</button>}
                    {isMyTurn && legal?.minRaiseTo != null && legal.maxRaiseTo != null && (
                      <div className={styles.raiseGroup}>
                        <input
                          className={styles.raiseInput}
                          type="number"
                          min={legal.minRaiseTo}
                          max={legal.maxRaiseTo}
                          value={raiseTo}
                          onChange={(event) => setRaiseTo(Number(event.target.value))}
                          aria-label="加注到"
                        />
                        <button className={styles.primaryButton} type="button" disabled={busy || raiseTo < legal.minRaiseTo || raiseTo > legal.maxRaiseTo} onClick={() => void sendCommand({ type: "act", handId: game.handId, action: "raise", raiseTo })}>
                          加注到 {raiseTo}
                        </button>
                      </div>
                    )}
                    {mustChooseShow && (
                      <>
                        <button className={styles.secondaryButton} type="button" disabled={busy} onClick={() => void sendCommand({ type: "show", handId: game.handId, show: false })}>盖牌</button>
                        <button className={styles.primaryButton} type="button" disabled={busy} onClick={() => void sendCommand({ type: "show", handId: game.handId, show: true })}>亮出赢家手牌</button>
                      </>
                    )}
                    {phase === "between_hands" && (
                      <button className={styles.primaryButton} type="button" disabled={busy} onClick={() => void sendCommand({ type: "ready", ready: !selfPlayer?.ready })}>
                        {selfPlayer?.ready ? "取消下一手准备" : "准备下一手"}
                      </button>
                    )}
                  </div>
                </div>
              </>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
