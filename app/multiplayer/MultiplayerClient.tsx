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
  timeBankMs: number;
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
  actionStartedAt: number | null;
  actionDeadlineAt: number | null;
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
    tableMode: "cash" | "tournament";
    startingStack: number;
    smallBlind: number;
    bigBlind: number;
    actionTimeMs: number;
    initialTimeBankMs: number;
    timeBankUnitMs: number;
    hand: { pendingShowSeat: number | null; actionDeadlineAt: number | null } | null;
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
  TIME_BANK_EMPTY: "你本局的额外思考时间已经用完。",
  TIME_NOT_EXPIRED: "当前玩家仍有思考时间。",
  TIME_EXPIRED: "本次行动已经超时。",
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

const PLAYER_STATUS_LABELS: Record<PublicPlayer["status"], string> = {
  waiting: "等待入局",
  active: "牌局中",
  folded: "已弃牌",
  "all-in": "全下",
  out: "已离桌",
};

const STREET_LABELS: Record<PublicGame["street"], string> = {
  preflop: "翻牌前",
  flop: "翻牌",
  turn: "转牌",
  river: "河牌",
  showdown: "摊牌",
  complete: "本手结束",
};

function PlayerSeat({
  player,
  selfAccountId,
  actorAccountId,
  visualSeat,
  actionSecondsLeft,
}: {
  player: PublicPlayer;
  selfAccountId: string;
  actorAccountId: string | null;
  visualSeat: number;
  actionSecondsLeft: number | null;
}) {
  const cards = player.holeCards ?? [];
  const hiddenCount = cards.length ? 0 : player.holeCardCount;
  const className = [
    styles.seat,
    styles[`seat${Math.max(0, Math.min(5, visualSeat))}`],
    player.accountId === actorAccountId ? styles.seatActive : "",
    player.accountId === selfAccountId ? styles.seatSelf : "",
    player.status === "folded" || player.status === "out" ? styles.seatFolded : "",
  ].filter(Boolean).join(" ");

  return (
    <div className={className}>
      <div className={styles.seatCards} aria-label={`${player.handle} 的手牌`}>
        {cards.map((card, index) => <CardView key={`${card.rank}-${card.suit}-${index}`} card={card} mini />)}
        {Array.from({ length: hiddenCount }, (_, index) => <span className={styles.miniBack} key={`hidden-${index}`} />)}
      </div>
      <div className={styles.playerPanel}>
        <span className={styles.avatar}>{Array.from(player.handle)[0]?.toUpperCase() ?? "P"}</span>
        <div className={styles.seatIdentity}>
          <div>
            <strong>{player.handle}</strong>
            {player.isDealer && <span className={styles.roleChip}>D</span>}
            {player.isOwner && <span className={styles.ownerChip}>房主</span>}
          </div>
          <span>{player.accountId === selfAccountId ? "你 · 在线" : PLAYER_STATUS_LABELS[player.status]}</span>
        </div>
        <div className={styles.seatStack}><i />{player.stack}</div>
      </div>
      {player.committed > 0 && <div className={styles.tableBet}><i />{player.committed}</div>}
      <div className={`${styles.seatClock} ${player.accountId === actorAccountId ? styles.seatClockActive : ""}`}>
        {player.accountId === actorAccountId && <strong>{actionSecondsLeft ?? "—"}s</strong>}
        <span>时间库 {Math.ceil(player.timeBankMs / 1_000)}s</span>
      </div>
      {(player.status === "folded" || player.status === "out") && <div className={styles.foldLabel}>{PLAYER_STATUS_LABELS[player.status]}</div>}
    </div>
  );
}

function TableSurface({
  players,
  selfAccountId,
  game,
  actionSecondsLeft,
}: {
  players: PublicPlayer[];
  selfAccountId: string;
  game: PublicGame | null;
  actionSecondsLeft: number | null;
}) {
  const selfSeat = players.find((player) => player.accountId === selfAccountId)?.seat ?? 0;

  return (
    <div className={`${styles.pokerTable} ${game ? "" : styles.waitingPokerTable}`}>
      <div className={styles.tableRail} />
      <div className={styles.tableFelt}>
        <div className={styles.feltGrain} />
        <div className={styles.boardArea}>
          <div className={styles.potLabel}>
            <span>{game ? "底池" : "私人牌桌"}</span>
            <strong>{game ? <><i />{game.pot}</> : "WAITING"}</strong>
          </div>
          <div className={styles.cards} aria-label="公共牌">
            {(game?.board ?? []).map((card, index) => <CardView key={`${card.rank}-${card.suit}-${index}`} card={card} />)}
            {Array.from({ length: 5 - (game?.board.length ?? 0) }, (_, index) => <span className={styles.cardSlot} key={`slot-${index}`} />)}
          </div>
        </div>
        <div className={styles.tableSignature}>RANGECRAFT <span>◆</span> FRIENDS CLUB</div>
      </div>
      {players.map((player) => (
        <PlayerSeat
          key={player.accountId}
          player={player}
          selfAccountId={selfAccountId}
          actorAccountId={game?.actorAccountId ?? null}
          visualSeat={(player.seat - selfSeat + 6) % 6}
          actionSecondsLeft={actionSecondsLeft}
        />
      ))}
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
  const [tableMode, setTableMode] = useState<"cash" | "tournament">("cash");
  const [startingStack, setStartingStack] = useState(1_000);
  const [actionSeconds, setActionSeconds] = useState(10);
  const [timeBankSeconds, setTimeBankSeconds] = useState(100);
  const [joinCode, setJoinCode] = useState("");
  const [raiseTo, setRaiseTo] = useState(0);
  const [nextHandCountdown, setNextHandCountdown] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [clockNow, setClockNow] = useState(() => Date.now());
  const latestRevision = useRef(-1);
  const timeoutSentFor = useRef<string | null>(null);

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
      const body = await request<{ room: RoomSummary }>("createRoom", {
        name: roomName,
        maxPlayers,
        tableMode,
        startingStack,
        actionSeconds,
        timeBankSeconds,
      });
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

  const activeRoomId = snapshot?.room.id ?? null;

  const sendCommand = useCallback(async (
    command: Record<string, unknown>,
    options: { quiet?: boolean } = {},
  ) => {
    if (!activeRoomId) return false;
    setBusy(true);
    if (!options.quiet) setError(null);
    try {
      const next = await request<RoomSnapshot>("command", {
        roomId: activeRoomId,
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
      if (!options.quiet) setError(message);
      await loadRoom(activeRoomId, true);
      return false;
    } finally {
      setBusy(false);
    }
  }, [activeRoomId, loadRoom, loadRooms, request]);

  const leaveRoom = async () => {
    if (!snapshot) return;
    const left = await sendCommand({ type: "leave" });
    if (!left) return;
    setSnapshot(null);
    latestRevision.current = -1;
    await loadRooms();
  };

  const copyJoinCode = async (code: string) => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(code);
      setError(null);
      setNotice(`邀请码 ${code} 已复制。`);
    } catch {
      setError(`无法自动复制，请手动复制邀请码：${code}`);
    }
  };

  const pasteJoinCode = async () => {
    try {
      if (!navigator.clipboard?.readText) throw new Error("Clipboard unavailable");
      const code = (await navigator.clipboard.readText())
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "")
        .slice(0, 8);
      setJoinCode(code);
      setError(null);
      setNotice(code ? "邀请码已粘贴。" : "剪贴板里没有邀请码。");
    } catch {
      setError("浏览器没有允许读取剪贴板，请点输入框后直接粘贴邀请码。");
    }
  };

  const selfPlayer = useMemo(() => snapshot?.players.find((player) => player.accountId === snapshot.selfAccountId) ?? null, [snapshot]);
  const game = snapshot?.game ?? null;
  const legal = game?.legalActions ?? null;
  const isOwner = snapshot?.room.ownerAccountId === snapshot?.selfAccountId;
  const isMyTurn = Boolean(game && game.actorAccountId === snapshot?.selfAccountId && legal);
  const phase = snapshot?.table.phase ?? null;
  const canLeave = phase === "lobby" || phase === "between_hands";
  const canRejoinNextHand = Boolean(
    selfPlayer
    && (selfPlayer.stack > 0 || snapshot?.table.tableMode === "cash"),
  );
  const actionMillisecondsLeft = game?.actionDeadlineAt == null
    ? null
    : Math.max(0, game.actionDeadlineAt - clockNow);
  const actionSecondsLeft = actionMillisecondsLeft == null
    ? null
    : Math.ceil(actionMillisecondsLeft / 1_000);

  useEffect(() => {
    if (phase !== "playing" || game?.actionDeadlineAt == null || !game.actorAccountId) return;
    setClockNow(Date.now());
    const timer = window.setInterval(() => setClockNow(Date.now()), 200);
    return () => window.clearInterval(timer);
  }, [game?.actionDeadlineAt, game?.actorAccountId, phase]);

  useEffect(() => {
    if (
      phase !== "playing"
      || !game
      || !game.actorAccountId
      || game.actionDeadlineAt == null
      || actionMillisecondsLeft === null
      || actionMillisecondsLeft > 0
    ) return;
    const timeoutKey = `${game.handId}:${game.actorAccountId}:${game.actionDeadlineAt}`;
    if (timeoutSentFor.current === timeoutKey) return;
    timeoutSentFor.current = timeoutKey;
    void sendCommand({ type: "timeout", handId: game.handId }, { quiet: true }).then((succeeded) => {
      if (!succeeded && timeoutSentFor.current === timeoutKey) {
        timeoutSentFor.current = null;
        setClockNow(Date.now());
      }
    });
  }, [actionMillisecondsLeft, game, phase, sendCommand]);

  useEffect(() => {
    if (phase !== "between_hands" || !selfPlayer || selfPlayer.ready || !canRejoinNextHand) {
      setNextHandCountdown(null);
      return;
    }

    const delayMs = 3_000 + Math.floor(Math.random() * 2_001);
    const deadline = Date.now() + delayMs;
    let cancelled = false;
    let retryTimer: number | null = null;
    let retriesRemaining = 2;

    const updateCountdown = () => {
      setNextHandCountdown(Math.max(1, Math.ceil((deadline - Date.now()) / 1_000)));
    };
    const markReady = async () => {
      const succeeded = await sendCommand({ type: "ready", ready: true });
      if (!succeeded && !cancelled && retriesRemaining > 0) {
        retriesRemaining -= 1;
        retryTimer = window.setTimeout(() => void markReady(), 800);
      }
    };

    updateCountdown();
    const countdownTimer = window.setInterval(updateCountdown, 200);
    const readyTimer = window.setTimeout(() => {
      window.clearInterval(countdownTimer);
      setNextHandCountdown(0);
      void markReady();
    }, delayMs);

    return () => {
      cancelled = true;
      window.clearInterval(countdownTimer);
      window.clearTimeout(readyTimer);
      if (retryTimer !== null) window.clearTimeout(retryTimer);
    };
  }, [canRejoinNextHand, game?.handId, phase, selfPlayer?.accountId, selfPlayer?.ready, sendCommand]);

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
          <span className={styles.brandMark}>P</span>
          <span className={styles.brandCopy}><strong>RANGECRAFT</strong><small>朋友牌桌</small></span>
        </a>
        {snapshot && (
          <div className={styles.sessionMeta}>
            <span className={styles.onlineDot} />
            <span>在线朋友局</span>
            <i />
            <span>{snapshot.table.tableMode === "cash" ? "现金练习" : "单桌赛"} · {snapshot.table.startingStack} 筹码</span>
            <i />
            <span>{snapshot.table.actionTimeMs / 1_000}/{snapshot.table.initialTimeBankMs / 1_000}s · {snapshot.players.length}/{snapshot.room.maxPlayers} 人 · {game ? `第 ${game.handNo} 手` : "等待开局"}</span>
          </div>
        )}
        <div className={styles.navRight}>
          <span>牌桌身份</span>
          <strong>{account?.handle ?? displayName}</strong>
          <a className={styles.signOut} href={signOutHref} onClick={onSignOut}>退出</a>
        </div>
      </nav>

      <main className={`${styles.main} ${snapshot ? styles.tableMain : ""}`}>
        {error && <p className={styles.errorBox} role="alert">{error}</p>}
        {notice && <p className={styles.noticeBox} role="status">{notice}</p>}

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
                  <div className={`${styles.field} ${styles.createPrimaryField}`}>
                    <label htmlFor="room-name">房间名称</label>
                    <input id="room-name" maxLength={24} value={roomName} onChange={(event) => setRoomName(event.target.value)} required />
                  </div>
                  <div className={styles.field}>
                    <label htmlFor="max-players">人数</label>
                    <select id="max-players" value={maxPlayers} onChange={(event) => setMaxPlayers(Number(event.target.value))}>
                      {[2, 3, 4, 5, 6].map((value) => <option key={value} value={value}>{value} 人</option>)}
                    </select>
                  </div>
                  <div className={styles.field}>
                    <label htmlFor="table-mode">模式</label>
                    <select id="table-mode" value={tableMode} onChange={(event) => setTableMode(event.target.value as "cash" | "tournament")}>
                      <option value="cash">现金练习 · 出局自动补码</option>
                      <option value="tournament">单桌淘汰赛</option>
                    </select>
                  </div>
                  <div className={styles.field}>
                    <label htmlFor="starting-stack">每人起始筹码</label>
                    <input id="starting-stack" type="number" min={200} max={10_000} step={10} value={startingStack} onChange={(event) => setStartingStack(Number(event.target.value))} required />
                  </div>
                  <div className={styles.field}>
                    <label htmlFor="action-seconds">每次行动</label>
                    <select id="action-seconds" value={actionSeconds} onChange={(event) => setActionSeconds(Number(event.target.value))}>
                      {[5, 10, 15, 20, 30, 45, 60].map((value) => <option key={value} value={value}>{value} 秒</option>)}
                    </select>
                  </div>
                  <div className={styles.field}>
                    <label htmlFor="time-bank-seconds">整局时间库</label>
                    <input id="time-bank-seconds" type="number" min={0} max={600} step={10} value={timeBankSeconds} onChange={(event) => setTimeBankSeconds(Number(event.target.value))} required />
                  </div>
                  <div className={styles.roomRulePreview}>
                    <strong>{actionSeconds}/{timeBankSeconds}</strong>
                    <span>每次 {actionSeconds}s；每人全局额外 {timeBankSeconds}s，每张时间牌增加最多 {actionSeconds}s。</span>
                  </div>
                  <button className={`${styles.primaryButton} ${styles.createRoomButton}`} type="submit" disabled={busy}>创建牌桌</button>
                </form>
              </section>

              <section className={styles.panel}>
                <p className={styles.panelKicker}>INVITATION</p>
                <h2 className={styles.panelTitle}>凭邀请码入桌</h2>
                <form className={styles.joinForm} onSubmit={joinRoom}>
                  <div className={styles.field}>
                    <label htmlFor="join-code">8 位邀请码</label>
                    <input id="join-code" value={joinCode} onChange={(event) => setJoinCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8))} maxLength={8} autoCapitalize="characters" placeholder="AB12CDEF" required />
                  </div>
                  <div className={styles.joinActions}>
                    <button className={styles.secondaryButton} type="button" onClick={() => void pasteJoinCode()} disabled={busy}>粘贴邀请码</button>
                    <button className={styles.secondaryButton} type="submit" disabled={busy}>加入</button>
                  </div>
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
                      <div className={styles.roomActions}>
                        <button className={styles.secondaryButton} type="button" onClick={() => void copyJoinCode(room.joinCode)}>复制邀请码</button>
                        <button className={styles.secondaryButton} type="button" onClick={() => void loadRoom(room.id)}>进入</button>
                      </div>
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
                <button className={styles.codePill} type="button" onClick={() => void copyJoinCode(snapshot.room.joinCode)} aria-label={`复制邀请码 ${snapshot.room.joinCode}`}>复制邀请码 · {snapshot.room.joinCode}</button>
                <span className={styles.statusPill}>{snapshot.table.tableMode === "cash" ? "现金练习" : "单桌赛"} · {snapshot.table.startingStack}</span>
                <span className={styles.statusPill}>读秒 {snapshot.table.actionTimeMs / 1_000}/{snapshot.table.initialTimeBankMs / 1_000}s</span>
                <span className={styles.statusPill}>{snapshot.players.length}/{snapshot.room.maxPlayers} 人</span>
                <button className={styles.dangerButton} type="button" onClick={() => void leaveRoom()} disabled={busy || !canLeave} title={canLeave ? "离开房间" : "本手结束后才能离开"}>离开</button>
              </div>
            </header>

            <div className={styles.tableStage}>
              <div className={`${styles.tableAmbient} ${styles.tableAmbientOne}`} />
              <div className={`${styles.tableAmbient} ${styles.tableAmbientTwo}`} />
              <TableSurface
                players={game?.players ?? snapshot.players}
                selfAccountId={snapshot.selfAccountId}
                game={game}
                actionSecondsLeft={actionSecondsLeft}
              />

            {!game && (
              <div className={`${styles.tableControls} ${styles.waitingControls}`}>
                <div>
                  <p className={styles.panelKicker}>WAITING ROOM</p>
                  <h2 className={styles.panelTitle}>人齐后确认准备</h2>
                  <p className={styles.tableRuleLine}>{snapshot.table.tableMode === "cash" ? "现金练习" : "单桌淘汰赛"} · 起始 {snapshot.table.startingStack} · 行动/时间库 {snapshot.table.actionTimeMs / 1_000}/{snapshot.table.initialTimeBankMs / 1_000}s</p>
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
                <div className={styles.tableControls}>
                  {game.result && <div className={styles.resultBanner}>{game.result.summary}</div>}
                  <WinningHands game={game} />
                  <div className={styles.controlSummary}>
                    <span className={styles.turnLabel}>{isMyTurn ? "轮到你行动" : phase === "showdown" ? "正在摊牌" : "牌桌进行中"}</span>
                    <strong>{STREET_LABELS[game.street]}</strong>
                    {phase === "playing" && game.actorAccountId && (
                      <div className={`${styles.actionClockSummary} ${(actionSecondsLeft ?? 99) <= 3 ? styles.actionClockUrgent : ""}`}>
                        <b>{actionSecondsLeft ?? "—"}s</b>
                        <small>基础 {snapshot.table.actionTimeMs / 1_000}s</small>
                      </div>
                    )}
                    <span>
                      {isMyTurn
                        ? "轮到你决定"
                        : mustChooseShow
                          ? "请选择亮出或盖掉赢家手牌"
                          : phase === "showdown"
                            ? "等待赢家决定是否亮牌"
                            : phase === "between_hands"
                              ? "倒计时结束后自动开始下一手"
                              : game.actorAccountId
                                ? "等待对手行动"
                                : "本手已结束"}
                    </span>
                  </div>
                  <div className={styles.actionRow}>
                    {isMyTurn && selfPlayer && selfPlayer.timeBankMs > 0 && (
                      <button
                        className={styles.timeBankButton}
                        type="button"
                        disabled={busy || actionMillisecondsLeft === 0}
                        onClick={() => void sendCommand({ type: "use-time-bank", handId: game.handId })}
                      >
                        <strong>时间牌 +{Math.ceil(Math.min(snapshot.table.timeBankUnitMs, selfPlayer.timeBankMs) / 1_000)}s</strong>
                        <small>剩余 {Math.ceil(selfPlayer.timeBankMs / 1_000)}s</small>
                      </button>
                    )}
                    {isMyTurn && legal?.fold && <button className={`${styles.actionButton} ${styles.foldAction}`} type="button" disabled={busy} onClick={() => void sendCommand({ type: "act", handId: game.handId, action: "fold" })}>弃牌</button>}
                    {isMyTurn && legal?.check && <button className={styles.actionButton} type="button" disabled={busy} onClick={() => void sendCommand({ type: "act", handId: game.handId, action: "check" })}>过牌</button>}
                    {isMyTurn && legal?.callAmount != null && <button className={styles.actionButton} type="button" disabled={busy} onClick={() => void sendCommand({ type: "act", handId: game.handId, action: "call" })}>跟注 {legal.callAmount}</button>}
                    {isMyTurn && legal?.minRaiseTo != null && legal.maxRaiseTo != null && (
                      <div className={styles.raiseGroup}>
                        <input
                          className={styles.raiseInput}
                          type="range"
                          min={legal.minRaiseTo}
                          max={legal.maxRaiseTo}
                          step={1}
                          value={raiseTo}
                          onChange={(event) => setRaiseTo(Number(event.target.value))}
                          aria-label="加注到"
                        />
                        <button className={`${styles.actionButton} ${styles.raiseAction}`} type="button" disabled={busy || raiseTo < legal.minRaiseTo || raiseTo > legal.maxRaiseTo} onClick={() => void sendCommand({ type: "act", handId: game.handId, action: "raise", raiseTo })}>
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
                      <>
                        <div className={styles.autoNextHand} role="status" aria-live="polite">
                          <span className={styles.autoNextPulse} />
                          <span>
                            <strong>
                              {selfPlayer?.stack === 0 && snapshot.table.tableMode === "tournament"
                                ? "等待其余玩家进入下一手"
                                : selfPlayer?.stack === 0
                                  ? `将自动补至 ${snapshot.table.startingStack} 筹码`
                                : selfPlayer?.ready
                                  ? "已准备，等待其他玩家"
                                  : nextHandCountdown === 0
                                    ? "正在进入下一手…"
                                    : `${nextHandCountdown ?? "—"} 秒后进入下一手`}
                            </strong>
                            <small>全桌倒计时完成后自动发牌</small>
                          </span>
                        </div>
                        {!selfPlayer?.ready && canRejoinNextHand && (
                          <button className={styles.primaryButton} type="button" disabled={busy} onClick={() => void sendCommand({ type: "ready", ready: true })}>
                            立即准备
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </>
            )}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
