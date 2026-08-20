"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  clampMultiplayerRaiseTarget,
  multiplayerRaisePresets,
} from "../../lib/multiplayer-betting";
import {
  multiplayerBoardDealTransition,
  type MultiplayerBoardDeal,
  type MultiplayerBoardFrame,
} from "../../lib/multiplayer-board-animation";
import {
  multiplayerAudioTransition,
  type MultiplayerAudioFrame,
} from "../../lib/multiplayer-audio-events";
import {
  isPokerAudioEnabled,
  playPokerSound,
  setPokerAudioEnabled,
  unlockPokerAudio,
} from "../../lib/poker-audio";
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
  raiseAllInOnly: boolean;
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
  actionSeq?: number;
  recentActions?: {
    seq: number;
    accountId: string;
    seat: number;
    street: "preflop" | "flop" | "turn" | "river";
    action: "fold" | "check" | "call" | "raise";
    timedOut: boolean;
    occurredAt: number;
  }[];
  players: PublicPlayer[];
  legalActions: LegalActions | null;
  result: { summary: string; winners: string[] } | null;
};

type SessionReportPlayer = {
  rank: number;
  seat: number;
  displayName: string;
  finalStack: number;
  buyInTotal: number;
  rebuyCount: number;
  left: boolean;
  handsDealt: number;
  handsWon: number;
  netChips: number;
  netBigBlinds: number;
  bbPer100: number;
  vpipPercent: number;
  pfrPercent: number;
  sawFlopPercent: number;
  aggressionFrequencyPercent: number;
  aggressionFactor: number | null;
  wentToShowdownPercent: number;
  wonAtShowdownPercent: number | null;
  allInHands: number;
  timeoutPercent: number;
  voluntaryShows: number;
  biggestWin: number;
  biggestLoss: number;
  decisions: number;
  foldActions: number;
  checkActions: number;
  callActions: number;
  raiseActions: number;
  sampleSize: "insufficient" | "developing" | "meaningful";
  styleTags: string[];
  insights: string[];
};

type SessionReport = {
  startedAt: number | null;
  finishedAt: number;
  durationMs: number;
  handsCompleted: number;
  totalPotAwarded: number;
  bigBlind: number;
  players: SessionReportPlayer[];
};

type RoomSnapshot = {
  room: RoomSummary;
  selfAccountId: string;
  players: PublicPlayer[];
  game: PublicGame | null;
  table: {
    phase: "lobby" | "playing" | "showdown" | "between_hands" | "finished" | "closed";
    viewerSeat: number | null;
    tableMode: "cash" | "tournament";
    startingStack: number;
    smallBlind: number;
    bigBlind: number;
    actionTimeMs: number;
    initialTimeBankMs: number;
    timeBankUnitMs: number;
    finishRequested: boolean;
    sessionReport: SessionReport | null;
    hand: {
      pendingShowSeat: number | null;
      actionDeadlineAt: number | null;
      showDecisionDeadlineAt: number | null;
      nextHandAt: number | null;
    } | null;
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
  NOT_ENOUGH_PLAYERS: "至少需要两名可参赛玩家才能开始下一手。",
  NOT_ROOM_OWNER: "只有房主可以执行这个操作。",
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

function CardView({
  card,
  mini = false,
  dealDelayMs,
}: {
  card: Card;
  mini?: boolean;
  dealDelayMs?: number;
}) {
  const red = card.suit === "♥" || card.suit === "♦";
  const toneClass = red ? styles.redCard : styles.blackCard;
  // Keep the ink explicit on the rendered card as well as in CSS. Some hosted
  // browser color transforms were flattening the module class back to the
  // default black card ink, which made hearts and diamonds indistinguishable.
  const toneStyle = {
    color: red ? "#c92f35" : "#171b19",
    WebkitTextFillColor: red ? "#c92f35" : "#171b19",
  };
  if (mini) {
    return (
      <span className={`${styles.miniCard} ${toneClass}`} data-suit-tone={red ? "red" : "black"} style={toneStyle}>
        {card.rank}
        <span>{card.suit}</span>
      </span>
    );
  }
  const dealClass = dealDelayMs === undefined ? "" : styles.boardDealtCard;
  const cardStyle = dealDelayMs === undefined
    ? toneStyle
    : { ...toneStyle, animationDelay: `${dealDelayMs}ms` };
  return (
    <span className={`${styles.card} ${toneClass} ${dealClass}`} data-suit-tone={red ? "red" : "black"} style={cardStyle}>
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

const ONLINE_BIG_BLIND = 10;
const BOARD_DEAL_STAGGER_MS = 300;

const TABLE_MODE_OPTIONS = [
  {
    key: "cash" as const,
    label: "现金练习",
    description: "出局后下一手自动补码，适合持续练习",
  },
  {
    key: "tournament" as const,
    label: "单桌淘汰",
    description: "筹码归零后观战，直到决出最后赢家",
  },
];

const STACK_DEPTH_OPTIONS = [
  { key: "short", label: "浅筹", bigBlinds: 40, stack: 400 },
  { key: "standard", label: "标准", bigBlinds: 100, stack: 1_000 },
  { key: "deep", label: "深筹", bigBlinds: 200, stack: 2_000 },
] as const;

const VISUAL_SEATS_BY_PLAYER_COUNT: Record<number, number[]> = {
  1: [0],
  2: [0, 3],
  3: [0, 2, 4],
  4: [0, 1, 3, 5],
  5: [0, 1, 2, 4, 5],
  6: [0, 1, 2, 3, 4, 5],
};

function tableModeLabel(mode: RoomSnapshot["table"]["tableMode"]) {
  return mode === "cash" ? "现金练习" : "单桌淘汰";
}

function stackInBigBlinds(stack: number, bigBlind = ONLINE_BIG_BLIND) {
  return Math.round(stack / Math.max(1, bigBlind));
}

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
      {player.streetCommitted > 0 && <div className={styles.tableBet}><i />{player.streetCommitted}</div>}
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
  boardDeal,
}: {
  players: PublicPlayer[];
  selfAccountId: string;
  game: PublicGame | null;
  actionSecondsLeft: number | null;
  boardDeal: MultiplayerBoardDeal | null;
}) {
  const selfSeat = players.find((player) => player.accountId === selfAccountId)?.seat ?? 0;
  const orderedPlayers = useMemo(() => [...players].sort((left, right) => {
    const leftOffset = (left.seat - selfSeat + 6) % 6;
    const rightOffset = (right.seat - selfSeat + 6) % 6;
    return leftOffset - rightOffset;
  }), [players, selfSeat]);
  const visualSeats = VISUAL_SEATS_BY_PLAYER_COUNT[Math.min(6, Math.max(1, orderedPlayers.length))] ?? VISUAL_SEATS_BY_PLAYER_COUNT[6];

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
            {(game?.board ?? []).map((card, index) => {
              const isNewCard = Boolean(
                boardDeal
                && game
                && boardDeal.handId === game.handId
                && index >= boardDeal.dealFrom
                && index < boardDeal.dealFrom + boardDeal.dealCount,
              );
              return (
                <CardView
                  key={`${card.rank}-${card.suit}-${index}`}
                  card={card}
                  dealDelayMs={isNewCard && boardDeal ? (index - boardDeal.dealFrom) * BOARD_DEAL_STAGGER_MS : undefined}
                />
              );
            })}
            {Array.from({ length: 5 - (game?.board.length ?? 0) }, (_, index) => <span className={styles.cardSlot} key={`slot-${index}`} />)}
          </div>
        </div>
        <div className={styles.tableSignature}>RANGECRAFT <span>◆</span> FRIENDS CLUB</div>
      </div>
      {orderedPlayers.map((player, index) => (
        <PlayerSeat
          key={player.accountId}
          player={player}
          selfAccountId={selfAccountId}
          actorAccountId={game?.actorAccountId ?? null}
          visualSeat={visualSeats[index] ?? index}
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

function formatSessionPercent(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "—";
  return `${value.toFixed(value >= 10 ? 0 : 1)}%`;
}

function formatSigned(value: number, suffix = "") {
  const rounded = Math.abs(value) >= 100 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${value > 0 ? "+" : ""}${rounded}${suffix}`;
}

function formatSessionDuration(durationMs: number) {
  const minutes = Math.max(0, Math.round(durationMs / 60_000));
  if (minutes < 1) return "不到 1 分钟";
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  return remaining ? `${hours} 小时 ${remaining} 分钟` : `${hours} 小时`;
}

function SessionSummary({
  report,
  game,
  viewerSeat,
  isOwner,
  busy,
  onRestart,
  onLeave,
}: {
  report: SessionReport;
  game: PublicGame | null;
  viewerSeat: number | null;
  isOwner: boolean;
  busy: boolean;
  onRestart: () => void;
  onLeave: () => void;
}) {
  const hero = report.players.find((player) => player.seat === viewerSeat) ?? null;
  const sampleLabel = report.handsCompleted < 20
    ? "样本很少，只展示本局事实数据"
    : report.handsCompleted < 100
      ? "初步样本，结果仍容易受发牌波动影响"
      : "已有一定样本，仍不等同于长期水平或 GTO 评分";

  return (
    <section className={styles.sessionSummary} aria-labelledby="session-summary-title">
      <header className={styles.summaryHeader}>
        <div>
          <p className={styles.panelKicker}>SESSION SETTLEMENT · 全桌统一结算</p>
          <h2 id="session-summary-title">牌局已结束</h2>
          <p>共完成 {report.handsCompleted} 手 · {formatSessionDuration(report.durationMs)} · 累计争夺 {report.totalPotAwarded} 筹码</p>
        </div>
        <div className={styles.summaryHeroResult} data-sign={hero && hero.netChips < 0 ? "negative" : "positive"}>
          <span>{hero ? "你的本局净结果" : "最终结算"}</span>
          <strong>{hero ? formatSigned(hero.netChips) : `${report.players.length} 位牌手`}</strong>
          {hero && <small>{formatSigned(hero.netBigBlinds, " BB")} · {formatSigned(hero.bbPer100, " bb/100")}</small>}
        </div>
      </header>

      {game?.result && (
        <div className={styles.summaryLastHand}>
          <span>FINAL HAND · 最后一手</span>
          <strong>{game.result.summary}</strong>
          <WinningHands game={game} />
        </div>
      )}

      <div className={styles.summaryNotice} role="note">
        <strong>{sampleLabel}</strong>
        <span>以下点评来自服务端记录的真实行动与结算；它描述这局的打法倾向，不虚构求解器 EV 损失或“GTO 准确率”。</span>
      </div>

      <div className={styles.summaryGrid}>
        <section className={styles.summaryStandings} aria-label="最终排名">
          <div className={styles.summarySectionHeading}>
            <span>STANDINGS</span>
            <strong>最终排名</strong>
          </div>
          <div className={styles.summaryStandingList}>
            {report.players.map((player) => (
              <article className={styles.summaryStandingRow} data-self={player.seat === viewerSeat || undefined} key={`${player.rank}-${player.seat}-${player.displayName}`}>
                <b>{player.rank}</b>
                <span className={styles.summaryAvatar}>{Array.from(player.displayName)[0]?.toUpperCase() ?? "P"}</span>
                <div>
                  <strong>{player.displayName}{player.seat === viewerSeat ? " · 你" : ""}</strong>
                  <small>{player.handsDealt} 手 · 赢下 {player.handsWon} 手{player.left ? " · 已离桌" : ""}</small>
                </div>
                <div className={styles.summaryStandingStack}>
                  <span>{player.finalStack} 筹码</span>
                  <strong data-sign={player.netChips < 0 ? "negative" : player.netChips > 0 ? "positive" : "neutral"}>{formatSigned(player.netChips)}</strong>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className={styles.summaryAnalysis} aria-label="所有玩家本局分析">
          <div className={styles.summarySectionHeading}>
            <span>TABLE REVIEW</span>
            <strong>所有人的本局分析</strong>
          </div>
          <div className={styles.summaryPlayerReports}>
            {report.players.map((player) => (
              <article className={styles.summaryPlayerReport} data-self={player.seat === viewerSeat || undefined} key={`report-${player.rank}-${player.seat}-${player.displayName}`}>
                <header>
                  <div>
                    <strong>{player.displayName}{player.seat === viewerSeat ? " · 你" : ""}</strong>
                    <span>{player.handsDealt} 手样本 · {formatSigned(player.netBigBlinds, " BB")}</span>
                  </div>
                  <div className={styles.summaryTags}>
                    {(player.styleTags.length ? player.styleTags : ["样本观察"]).map((tag) => <span key={tag}>{tag}</span>)}
                  </div>
                </header>
                <div className={styles.summaryMetrics}>
                  <div><span>VPIP</span><strong>{formatSessionPercent(player.vpipPercent)}</strong></div>
                  <div><span>PFR</span><strong>{formatSessionPercent(player.pfrPercent)}</strong></div>
                  <div><span>翻后主动</span><strong>{formatSessionPercent(player.aggressionFrequencyPercent)}</strong></div>
                  <div><span>侵略系数</span><strong>{player.aggressionFactor === null ? "—" : player.aggressionFactor.toFixed(2)}</strong></div>
                  <div><span>WTSD</span><strong>{formatSessionPercent(player.wentToShowdownPercent)}</strong></div>
                  <div><span>W$SD</span><strong>{formatSessionPercent(player.wonAtShowdownPercent)}</strong></div>
                </div>
                <ul className={styles.summaryInsights}>
                  {player.insights.map((insight) => <li key={insight}>{insight}</li>)}
                </ul>
                <footer>
                  <span>决策 {player.decisions} · 弃 {player.foldActions} / 过 {player.checkActions} / 跟 {player.callActions} / 加 {player.raiseActions}</span>
                  <span>全下 {player.allInHands} 手 · 超时 {formatSessionPercent(player.timeoutPercent)} · 主动亮牌 {player.voluntaryShows} 次</span>
                </footer>
              </article>
            ))}
          </div>
        </section>
      </div>

      <div className={styles.summaryActions}>
        <div>
          <strong>{isOwner ? "你可以保留邀请码再开一局" : "等待房主决定是否再开一局"}</strong>
          <span>再开一局会重置筹码、时间库和本局统计，所有人需要重新准备。</span>
        </div>
        {isOwner && <button className={styles.primaryButton} type="button" disabled={busy} onClick={onRestart}>再开一局</button>}
        <button className={styles.secondaryButton} type="button" disabled={busy} onClick={onLeave}>离开房间</button>
      </div>
    </section>
  );
}

export default function MultiplayerClient({
  displayName,
  signOutHref,
  signOutLabel = "退出登录",
  homeHref = "/",
  request = legacyRequest,
  onSignOut,
}: {
  displayName: string;
  signOutHref: string;
  signOutLabel?: string;
  homeHref?: string;
  request?: MultiplayerRequest;
  onSignOut?: () => void;
}) {
  const [account, setAccount] = useState<Account | null | undefined>(undefined);
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(null);
  const [boardDeal, setBoardDeal] = useState<MultiplayerBoardDeal | null>(null);
  const [soundOn, setSoundOn] = useState(() => isPokerAudioEnabled());
  const [handle, setHandle] = useState("");
  const [roomName, setRoomName] = useState("朋友练习桌");
  const [maxPlayers, setMaxPlayers] = useState(6);
  const [tableMode, setTableMode] = useState<"cash" | "tournament">("cash");
  const [startingStack, setStartingStack] = useState(1_000);
  const [actionSeconds, setActionSeconds] = useState(10);
  const [timeBankSeconds, setTimeBankSeconds] = useState(100);
  const [joinCode, setJoinCode] = useState("");
  const [raiseDraft, setRaiseDraft] = useState<{ turnKey: string; value: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [clockNow, setClockNow] = useState(() => Date.now());
  const latestRevision = useRef(-1);
  const timeoutSentFor = useRef<string | null>(null);
  const leavingRef = useRef(false);
  const roomViewGeneration = useRef(0);
  const viewedRoomId = useRef<string | null>(null);
  const lastBoardFrame = useRef<MultiplayerBoardFrame | null>(null);
  const lastAudioFrame = useRef<MultiplayerAudioFrame | null>(null);
  const soundOnRef = useRef(isPokerAudioEnabled());

  const acceptSnapshot = useCallback((next: RoomSnapshot) => {
    const nextFrame: MultiplayerBoardFrame | null = next.game
      ? {
          roomId: next.room.id,
          handId: next.game.handId,
          boardCount: next.game.board.length,
        }
      : null;
    const previousFrame = lastBoardFrame.current;
    const nextDeal = multiplayerBoardDealTransition(previousFrame, nextFrame);
    lastBoardFrame.current = nextFrame;

    const nextAudioFrame: MultiplayerAudioFrame | null = next.game
      ? {
          roomId: next.room.id,
          handId: next.game.handId,
          actionSeq: typeof next.game.actionSeq === "number" && Number.isInteger(next.game.actionSeq)
            ? next.game.actionSeq
            : 0,
          recentActions: next.game.recentActions ?? [],
          boardCount: next.game.board.length,
          hasResult: next.game.result !== null,
        }
      : null;
    const audioCues = multiplayerAudioTransition(lastAudioFrame.current, nextAudioFrame);
    lastAudioFrame.current = nextAudioFrame;
    if (soundOnRef.current && audioCues.length) {
      const soundRoomId = nextAudioFrame?.roomId;
      const soundHandId = nextAudioFrame?.handId;
      void unlockPokerAudio().then(() => {
        if (
          !soundOnRef.current
          || lastAudioFrame.current?.roomId !== soundRoomId
          || lastAudioFrame.current?.handId !== soundHandId
        ) return;
        audioCues.forEach((cue) => playPokerSound(cue.sound, cue.delaySeconds));
      }).catch(() => undefined);
    }

    if (nextDeal) {
      setBoardDeal(nextDeal);
    } else if (
      !previousFrame
      || !nextFrame
      || previousFrame.roomId !== nextFrame.roomId
      || previousFrame.handId !== nextFrame.handId
      || nextFrame.boardCount < previousFrame.boardCount
    ) {
      setBoardDeal(null);
    }
    setSnapshot(next);
  }, []);

  const clearActiveRoomSnapshot = useCallback(() => {
    lastBoardFrame.current = null;
    lastAudioFrame.current = null;
    setBoardDeal(null);
    setSnapshot(null);
  }, []);

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
    if (!quiet) {
      roomViewGeneration.current += 1;
      viewedRoomId.current = roomId;
      leavingRef.current = false;
      setLeaving(false);
    } else if (viewedRoomId.current !== roomId) {
      return;
    }
    const generation = roomViewGeneration.current;
    try {
      const next = await request<RoomSnapshot>("getRoom", { roomId });
      if (
        generation !== roomViewGeneration.current
        || viewedRoomId.current !== roomId
        || (quiet && (leavingRef.current || next.room.revision < latestRevision.current))
      ) return;
      latestRevision.current = next.room.revision;
      acceptSnapshot(next);
      if (!quiet) setError(null);
    } catch (reason) {
      if (!quiet) setError(reason instanceof Error ? reason.message : "无法读取牌桌。请稍后重试。");
    }
  }, [acceptSnapshot, request]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadAccount(), 0);
    return () => window.clearTimeout(timer);
  }, [loadAccount]);

  useEffect(() => {
    if (!soundOn) return;
    const unlock = () => { void unlockPokerAudio(); };
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, [soundOn]);

  useEffect(() => {
    if (!snapshot?.room.id) return;
    const roomId = snapshot.room.id;
    let cancelled = false;
    let timer: number | null = null;
    const poll = async () => {
      await loadRoom(roomId, true);
      if (!cancelled) timer = window.setTimeout(() => void poll(), 1200);
    };
    timer = window.setTimeout(() => void poll(), 1200);
    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
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
    if (!activeRoomId || leavingRef.current) return false;
    const roomId = activeRoomId;
    const generation = roomViewGeneration.current;
    const viewIsCurrent = () => (
      generation === roomViewGeneration.current
      && viewedRoomId.current === roomId
      && !leavingRef.current
    );
    if (soundOnRef.current) void unlockPokerAudio();
    setBusy(true);
    if (!options.quiet) setError(null);
    try {
      const next = await request<RoomSnapshot>("command", {
        roomId,
        command: {
          ...command,
          requestId: requestId(),
          expectedRevision: latestRevision.current,
        },
      });
      if (viewIsCurrent() && next.room.revision >= latestRevision.current) {
        latestRevision.current = next.room.revision;
        acceptSnapshot(next);
      }
      // The command is already committed. Refresh the lobby list in the
      // background so a slow unrelated request cannot hold the betting UI.
      void loadRooms().catch(() => undefined);
      return true;
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "牌桌行动失败。请稍后重试。";
      if (viewIsCurrent()) {
        if (!options.quiet) setError(message);
        await loadRoom(roomId, true);
      }
      return false;
    } finally {
      setBusy(false);
    }
  }, [acceptSnapshot, activeRoomId, loadRoom, loadRooms, request]);

  const leaveRoom = async () => {
    if (!snapshot || leavingRef.current) return;
    leavingRef.current = true;

    const roomId = snapshot.room.id;
    const roomLabel = snapshot.room.name;
    const activeHand = phase === "playing" || phase === "showdown";
    const confirmed = window.confirm(activeHand
      ? "确定永久离开这个房间吗？未全下的手牌会自动弃牌；已经全下的手牌会继续结算，结算后离桌。"
      : "确定永久离开这个房间吗？离开后如需回来，必须重新输入邀请码。"
    );
    if (!confirmed) {
      leavingRef.current = false;
      return;
    }

    roomViewGeneration.current += 1;
    viewedRoomId.current = null;

    setLeaving(true);
    setBusy(true);
    setError(null);
    const finishLeaving = (nextRooms?: RoomSummary[]) => {
      clearActiveRoomSnapshot();
      setRooms((currentRooms) => (nextRooms ?? currentRooms).filter((room) => room.id !== roomId));
      latestRevision.current = -1;
      timeoutSentFor.current = null;
      setNotice(`已永久离开「${roomLabel}」，你的牌手昵称仍然保留。`);
    };
    try {
      await request<RoomSnapshot>("command", {
        roomId,
        command: {
          type: "leave",
          requestId: requestId(),
          expectedRevision: latestRevision.current,
        },
      });
      finishLeaving();
      try {
        const body = await request<{ rooms: RoomSummary[] }>("listRooms");
        setRooms(body.rooms.filter((room) => room.id !== roomId));
      } catch {
        // The membership has already been removed; the optimistic list is authoritative for this view.
      }
    } catch (reason) {
      try {
        const body = await request<{ rooms: RoomSummary[] }>("listRooms");
        if (!body.rooms.some((room) => room.id === roomId)) {
          finishLeaving(body.rooms);
          return;
        }
      } catch {
        // Keep the original error when membership state cannot be verified.
      }
      leavingRef.current = false;
      const message = reason instanceof Error ? reason.message : "离开房间失败，请稍后重试。";
      await loadRoom(roomId);
      setError(message);
    } finally {
      setLeaving(false);
      setBusy(false);
    }
  };

  const finishSession = async () => {
    if (!snapshot || !isOwner || snapshot.table.finishRequested || phase === "finished") return;
    const waitsForCurrentHand = phase === "playing"
      || phase === "showdown"
      || (phase === "between_hands" && snapshot.table.hand?.nextHandAt != null);
    const confirmed = window.confirm(waitsForCurrentHand
      ? "确定结束整局吗？当前手牌会正常结算；赢家可在同一个手后倒计时内亮牌或盖牌，倒计时结束后向全桌展示整局总结。"
      : "确定现在结束整局并生成全员结算吗？"
    );
    if (!confirmed) return;
    const succeeded = await sendCommand({ type: "finish" });
    if (succeeded && waitsForCurrentHand) {
      setNotice("房主已设置：本手统一等待倒计时结束后生成整局结算。");
    }
  };

  const restartSession = async () => {
    if (!snapshot || !isOwner || phase !== "finished") return;
    if (!window.confirm("确定使用同一邀请码再开一局吗？筹码、时间库和本局统计都会重置。")) return;
    const succeeded = await sendCommand({ type: "restart" });
    if (succeeded) setNotice("新一局已经建立，请所有玩家重新准备。");
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

  const toggleSound = useCallback(() => {
    const next = !soundOn;
    setSoundOn(next);
    soundOnRef.current = next;
    void setPokerAudioEnabled(next).then(() => {
      if (next) playPokerSound("call");
    });
  }, [soundOn]);

  const selfPlayer = useMemo(() => snapshot?.players.find((player) => player.accountId === snapshot.selfAccountId) ?? null, [snapshot]);
  const game = snapshot?.game ?? null;
  const legal = game?.legalActions ?? null;
  const isOwner = snapshot?.room.ownerAccountId === snapshot?.selfAccountId;
  const isMyTurn = Boolean(game && game.actorAccountId === snapshot?.selfAccountId && legal);
  const phase = snapshot?.table.phase ?? null;
  const raiseTurnKey = game && legal?.minRaiseTo != null && legal.maxRaiseTo != null
    ? `${game.handId}:${game.street}:${game.actorAccountId ?? "none"}:${legal.minRaiseTo}:${legal.maxRaiseTo}`
    : null;
  const raiseTo = raiseTurnKey && legal?.minRaiseTo != null
    ? (raiseDraft?.turnKey === raiseTurnKey ? raiseDraft.value : legal.minRaiseTo)
    : 0;
  const raisePresets = useMemo(() => {
    if (!game || !legal || legal.minRaiseTo == null || legal.maxRaiseTo == null) return [];
    return multiplayerRaisePresets({
      pot: game.pot,
      currentBet: game.currentBet,
      callAmount: legal.callAmount,
      minRaiseTo: legal.minRaiseTo,
      maxRaiseTo: legal.maxRaiseTo,
      allInOnly: legal.raiseAllInOnly,
      street: game.street,
      bigBlind: snapshot?.table.bigBlind,
    });
  }, [game, legal, snapshot?.table.bigBlind]);
  const raiseIsValid = Boolean(
    legal?.minRaiseTo != null
    && legal.maxRaiseTo != null
    && Number.isInteger(raiseTo)
    && raiseTo >= legal.minRaiseTo
    && raiseTo <= legal.maxRaiseTo,
  );
  const raiseAdditional = selfPlayer ? Math.max(0, raiseTo - selfPlayer.streetCommitted) : 0;
  const raiseIsAllIn = Boolean(selfPlayer && raiseAdditional === selfPlayer.stack);
  const raiseVerb = game?.currentBet === 0 ? "下注" : "加注";
  const canRaise = Boolean(legal?.minRaiseTo != null && legal.maxRaiseTo != null);
  const passiveAction = legal?.check ? "check" : legal?.callAmount != null ? "call" : null;
  const passiveActionLabel = legal?.check ? "过牌" : legal?.callAmount != null ? `跟注 ${legal.callAmount}` : "过牌 / 跟注";
  const actingPlayer = game?.players.find((player) => player.accountId === game.actorAccountId) ?? null;
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
  const showDecisionDeadlineAt = snapshot?.table.hand?.showDecisionDeadlineAt ?? null;
  const nextHandAt = snapshot?.table.hand?.nextHandAt ?? null;
  // The table now has one shared between-hands clock. The show deadline is
  // retained only as a compatibility fallback for rooms created by an older
  // server version; choosing show/muck never starts a second wait.
  const handTransitionDeadlineAt = nextHandAt ?? showDecisionDeadlineAt;
  const nextHandMillisecondsLeft = handTransitionDeadlineAt === null
    ? null
    : Math.max(0, handTransitionDeadlineAt - clockNow);
  const nextHandCountdown = nextHandMillisecondsLeft === null
    ? null
    : Math.ceil(nextHandMillisecondsLeft / 1_000);
  const selectedDepthBb = stackInBigBlinds(startingStack);
  const tableDepthBb = snapshot
    ? stackInBigBlinds(snapshot.table.startingStack, snapshot.table.bigBlind)
    : selectedDepthBb;
  const tournamentWinner = snapshot?.table.tableMode === "tournament"
    && phase === "between_hands"
    && snapshot.players.filter((player) => player.stack > 0 && player.status !== "out").length === 1
    ? snapshot.players.find((player) => player.stack > 0 && player.status !== "out") ?? null
    : null;

  useEffect(() => {
    const hasRunningClock = phase === "playing"
      ? game?.actionDeadlineAt != null && Boolean(game.actorAccountId)
      : (phase === "showdown" || phase === "between_hands")
        && handTransitionDeadlineAt !== null;
    if (!hasRunningClock) return;
    const initialTimer = window.setTimeout(() => setClockNow(Date.now()), 0);
    const timer = window.setInterval(() => setClockNow(Date.now()), 200);
    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(timer);
    };
  }, [game?.actionDeadlineAt, game?.actorAccountId, handTransitionDeadlineAt, phase]);

  useEffect(() => {
    if (
      leaving
      || leavingRef.current
      || phase !== "playing"
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
      if (!succeeded && !leavingRef.current && timeoutSentFor.current === timeoutKey) {
        timeoutSentFor.current = null;
        setClockNow(Date.now());
      }
    });
  }, [actionMillisecondsLeft, game, leaving, phase, sendCommand]);

  useEffect(() => {
    if (leaving || leavingRef.current || !game) return;
    const expiredNextHandWait = (phase === "showdown" || phase === "between_hands")
      && handTransitionDeadlineAt !== null
      && nextHandMillisecondsLeft === 0;
    if (!expiredNextHandWait) return;
    const timeoutKey = `next:${game.handId}:${handTransitionDeadlineAt}`;
    if (timeoutSentFor.current === timeoutKey) return;
    timeoutSentFor.current = timeoutKey;
    void sendCommand({ type: "timeout", handId: game.handId }, { quiet: true }).then((succeeded) => {
      if (!succeeded && !leavingRef.current && timeoutSentFor.current === timeoutKey) {
        timeoutSentFor.current = null;
        window.setTimeout(() => setClockNow(Date.now()), 350);
      }
    });
  }, [
    game,
    handTransitionDeadlineAt,
    leaving,
    nextHandMillisecondsLeft,
    phase,
    sendCommand,
  ]);

  useEffect(() => {
    if (!isMyTurn || !game || busy) return;
    const handleTableShortcut = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.repeat || target?.closest("input, select, textarea, button, [contenteditable='true']")) return;
      const key = event.key.toLowerCase();
      if (key === "f" && legal?.fold) {
        event.preventDefault();
        void sendCommand({ type: "act", handId: game.handId, action: "fold" });
      } else if (key === "c" && passiveAction) {
        event.preventDefault();
        void sendCommand({ type: "act", handId: game.handId, action: passiveAction });
      } else if (key === "r" && canRaise && raiseIsValid) {
        event.preventDefault();
        void sendCommand({ type: "act", handId: game.handId, action: "raise", raiseTo });
      }
    };
    window.addEventListener("keydown", handleTableShortcut);
    return () => window.removeEventListener("keydown", handleTableShortcut);
  }, [busy, canRaise, game, isMyTurn, legal?.fold, passiveAction, raiseIsValid, raiseTo, sendCommand]);

  const pendingShowSeat = snapshot?.table.hand?.pendingShowSeat ?? null;
  const pendingShowPlayer = pendingShowSeat === null
    ? null
    : game?.players.find((player) => player.seat === pendingShowSeat) ?? null;
  const mustChooseShow = Boolean(
    snapshot
      && (phase === "showdown" || phase === "between_hands")
      && snapshot.table.viewerSeat !== null
      && pendingShowSeat === snapshot.table.viewerSeat,
  );

  const temporarilyLeaveTable = () => {
    roomViewGeneration.current += 1;
    viewedRoomId.current = null;
    latestRevision.current = -1;
    timeoutSentFor.current = null;
    clearActiveRoomSnapshot();
  };

  return (
    <div className={styles.multiplayerPage}>
      <nav className={styles.lobbyNav}>
        <div className={styles.tableBrandGroup}>
          {snapshot && (
            <button className={styles.tableHomeButton} type="button" onClick={temporarilyLeaveTable} aria-label="暂离牌桌并返回房间列表" title="暂离牌桌（保留座位）">←</button>
          )}
          <a className={styles.brand} href={homeHref}>
            <span className={styles.brandMark}>P</span>
            <span className={styles.brandCopy}><strong>RANGECRAFT</strong><small>朋友牌桌</small></span>
          </a>
        </div>
        {snapshot && (
          <div className={styles.sessionMeta}>
            <span className={styles.onlineDot} />
            <span>在线朋友局</span>
            <i />
            <span>{tableModeLabel(snapshot.table.tableMode)} · {tableDepthBb}BB · 盲注 {snapshot.table.smallBlind}/{snapshot.table.bigBlind}</span>
            <i />
            <span>{snapshot.table.actionTimeMs / 1_000}/{snapshot.table.initialTimeBankMs / 1_000}s · {snapshot.players.length}/{snapshot.room.maxPlayers} 人 · {phase === "finished" ? "整局已结算" : game ? `第 ${game.handNo} 手` : "等待开局"}</span>
          </div>
        )}
        <div className={styles.navRight}>
          {snapshot && (
            <button className={styles.navCodeButton} type="button" onClick={() => void copyJoinCode(snapshot.room.joinCode)} aria-label={`复制邀请码 ${snapshot.room.joinCode}`}>
              {snapshot.room.joinCode}<small>复制</small>
            </button>
          )}
          <button
            className={`${styles.navSoundToggle} ${soundOn ? styles.navSoundToggleOn : ""}`}
            type="button"
            onClick={toggleSound}
            aria-pressed={soundOn}
            aria-label={soundOn ? "关闭牌桌音效" : "开启牌桌音效"}
          >
            <span>{soundOn ? "♪" : "—"}</span><b>音效</b><small>{soundOn ? "ON" : "OFF"}</small>
          </button>
          <span>牌桌身份</span>
          <strong>{account?.handle ?? displayName}</strong>
          <a className={styles.signOut} href={signOutHref} onClick={onSignOut}>{signOutLabel}</a>
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
              <p>创建房间，把邀请码发给朋友。支持 2–6 人、40/100/200BB 与自定义深度的无限注德州。</p>
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
                  <div className={`${styles.field} ${styles.createWideField}`}>
                    <span className={styles.fieldLabel}>牌局类型</span>
                    <div className={styles.modeOptions} role="radiogroup" aria-label="牌局类型">
                      {TABLE_MODE_OPTIONS.map((option) => (
                        <button
                          className={tableMode === option.key ? styles.modeOptionActive : ""}
                          type="button"
                          role="radio"
                          aria-checked={tableMode === option.key}
                          key={option.key}
                          onClick={() => setTableMode(option.key)}
                        >
                          <strong>{option.label}</strong>
                          <span>{option.description}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className={`${styles.field} ${styles.createWideField}`}>
                    <span className={styles.fieldLabel}>筹码深度</span>
                    <div className={styles.depthOptions} role="radiogroup" aria-label="筹码深度">
                      {STACK_DEPTH_OPTIONS.map((option) => (
                        <button
                          className={startingStack === option.stack ? styles.depthOptionActive : ""}
                          type="button"
                          role="radio"
                          aria-checked={startingStack === option.stack}
                          key={option.key}
                          onClick={() => setStartingStack(option.stack)}
                        >
                          <span>{option.label}</span>
                          <strong>{option.bigBlinds} BB</strong>
                          <small>{option.stack} 筹码</small>
                        </button>
                      ))}
                    </div>
                    <label className={styles.customStackField} htmlFor="starting-stack">
                      <span>自定义筹码</span>
                      <input id="starting-stack" type="number" min={200} max={10_000} step={10} value={startingStack} onChange={(event) => setStartingStack(Number(event.target.value))} required />
                      <small>盲注固定 5/10 · 当前约 {selectedDepthBb} BB</small>
                    </label>
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
                    <strong>{tableMode === "cash" ? "现金练习" : "单桌淘汰"} · {selectedDepthBb}BB · {actionSeconds}/{timeBankSeconds}</strong>
                    <span>盲注 5/10；每次 {actionSeconds}s；每人整局额外 {timeBankSeconds}s，主动使用时间牌继续思考。</span>
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
                        <small>{room.memberCount}/{room.maxPlayers} 人 · {room.status === "lobby" ? "等待开局" : room.status === "finished" ? "整局已结算" : "牌局进行中"} · {room.joinCode}</small>
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
            <div className={`${styles.tableStage} ${phase === "finished" ? styles.tableStageEnded : ""}`}>
              <header className={styles.tableToolbar}>
                <div className={styles.tableToolbarCopy}>
                  <span>FRIENDS TABLE · {phase === "finished" ? "SESSION COMPLETE" : game ? `HAND ${game.handNo}` : "LOBBY"}</span>
                  <strong>{snapshot.room.name}</strong>
                </div>
                <div className={styles.roomMeta}>
                  <span className={styles.statusPill}>{tableModeLabel(snapshot.table.tableMode)} · {tableDepthBb} BB</span>
                  <span className={styles.statusPill}>盲注 {snapshot.table.smallBlind}/{snapshot.table.bigBlind}</span>
                  <span className={styles.statusPill}>读秒 {snapshot.table.actionTimeMs / 1_000}/{snapshot.table.initialTimeBankMs / 1_000}s</span>
                  <span className={styles.statusPill}>{snapshot.players.length}/{snapshot.room.maxPlayers} 人</span>
                  {snapshot.table.finishRequested && phase !== "finished" && <span className={`${styles.statusPill} ${styles.finishRequestedPill}`}>本手后结算</span>}
                  {isOwner && phase !== "lobby" && phase !== "finished" && phase !== "closed" && (
                    <button className={styles.dangerButton} type="button" onClick={() => void finishSession()} disabled={busy || snapshot.table.finishRequested}>
                      {snapshot.table.finishRequested ? "等待本手结束" : "结束游戏"}
                    </button>
                  )}
                  <button className={styles.dangerButton} type="button" onClick={() => void leaveRoom()} disabled={busy || leaving} title="永久离开房间；牌局中未全下的手牌将自动弃牌">{leaving ? "正在离开…" : "永久离开"}</button>
                </div>
              </header>
              <div className={`${styles.tableAmbient} ${styles.tableAmbientOne}`} />
              <div className={`${styles.tableAmbient} ${styles.tableAmbientTwo}`} />
              {phase !== "finished" && (
                <TableSurface
                  players={game?.players ?? snapshot.players}
                  selfAccountId={snapshot.selfAccountId}
                  game={game}
                  actionSecondsLeft={actionSecondsLeft}
                  boardDeal={boardDeal?.roomId === snapshot.room.id ? boardDeal : null}
                />
              )}

            {phase === "finished" && snapshot.table.sessionReport && (
              <SessionSummary
                report={snapshot.table.sessionReport}
                game={game}
                viewerSeat={snapshot.table.viewerSeat}
                isOwner={isOwner}
                busy={busy || leaving}
                onRestart={() => void restartSession()}
                onLeave={() => void leaveRoom()}
              />
            )}
            {phase === "finished" && !snapshot.table.sessionReport && (
              <section className={styles.sessionSummary} role="status">
                <p className={styles.panelKicker}>SESSION SETTLEMENT</p>
                <h2>正在同步最终结算…</h2>
              </section>
            )}

            {phase !== "finished" && !game && (
              <div className={`${styles.tableControls} ${styles.waitingControls}`}>
                <div>
                  <p className={styles.panelKicker}>WAITING ROOM</p>
                  <h2 className={styles.panelTitle}>人齐后确认准备</h2>
                  <p className={styles.tableRuleLine}>{tableModeLabel(snapshot.table.tableMode)} · {tableDepthBb}BB · 盲注 {snapshot.table.smallBlind}/{snapshot.table.bigBlind} · 行动/时间库 {snapshot.table.actionTimeMs / 1_000}/{snapshot.table.initialTimeBankMs / 1_000}s</p>
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

            {phase !== "finished" && game && (
              <div className={`${styles.tableControls} ${canRaise ? styles.tableControlsWithRaise : ""} ${phase === "showdown" || phase === "between_hands" ? styles.tableControlsTransition : ""}`}>
                {game.result && <div className={styles.resultBanner}>{game.result.summary}</div>}
                <WinningHands game={game} />
                {phase !== "showdown" && phase !== "between_hands" && (
                  <>
                    <div className={styles.controlSummary}>
                  <span className={styles.turnLabel}>{isMyTurn ? "轮到你行动" : "牌桌进行中"}</span>
                  <strong>{STREET_LABELS[game.street]}</strong>
                  {phase === "playing" && game.actorAccountId && (
                    <div className={`${styles.actionClockSummary} ${(actionSecondsLeft ?? 99) <= 3 ? styles.actionClockUrgent : ""}`}>
                      <b>{actionSecondsLeft ?? "—"}s</b>
                      <small>{actingPlayer?.handle ?? "当前玩家"} · 基础 {snapshot.table.actionTimeMs / 1_000}s</small>
                    </div>
                  )}
                  <span>
                    {isMyTurn
                      ? "选择路线与准确下注尺寸"
                      : game.actorAccountId
                        ? `等待 ${actingPlayer?.handle ?? "对手"} 行动`
                        : "本手已结束"}
                  </span>
                  {isMyTurn && selfPlayer && selfPlayer.timeBankMs > 0 && (
                    <button
                      className={styles.timeBankButton}
                      type="button"
                      disabled={busy || actionMillisecondsLeft === 0}
                      onClick={() => void sendCommand({ type: "use-time-bank", handId: game.handId })}
                    >
                      <strong>使用时间牌 +{Math.ceil(Math.min(snapshot.table.timeBankUnitMs, selfPlayer.timeBankMs) / 1_000)}s</strong>
                      <small>剩余 {Math.ceil(selfPlayer.timeBankMs / 1_000)}s</small>
                    </button>
                  )}
                    </div>

                    <div className={styles.primaryActions} aria-label="牌桌行动">
                  <button
                    className={`${styles.actionButton} ${styles.foldAction}`}
                    type="button"
                    disabled={busy || !isMyTurn || !legal?.fold}
                    onClick={() => void sendCommand({ type: "act", handId: game.handId, action: "fold" })}
                  >
                    <span>弃牌</span><kbd>F</kbd>
                  </button>
                  <button
                    className={styles.actionButton}
                    type="button"
                    disabled={busy || !isMyTurn || passiveAction === null}
                    onClick={() => passiveAction && void sendCommand({ type: "act", handId: game.handId, action: passiveAction })}
                  >
                    <span>{passiveActionLabel}</span><kbd>C</kbd>
                  </button>
                  <button
                    className={`${styles.actionButton} ${styles.raiseAction}`}
                    type="button"
                    disabled={busy || !isMyTurn || !canRaise || !raiseIsValid}
                    onClick={() => void sendCommand({ type: "act", handId: game.handId, action: "raise", raiseTo })}
                  >
                    <span>{canRaise ? (raiseIsAllIn ? `全下 ${raiseTo}` : `${raiseVerb}到 ${raiseTo}`) : "下注 / 加注"}</span><kbd>R</kbd>
                  </button>
                    </div>

                    {isMyTurn && legal?.minRaiseTo != null && legal.maxRaiseTo != null ? (
                      <div className={styles.raiseControl}>
                    <div className={styles.raiseHeading}>
                      <span>{legal.raiseAllInOnly ? "仅可不足额全下" : `${raiseVerb}范围 ${legal.minRaiseTo}–${legal.maxRaiseTo}`}</span>
                      <strong>{raiseIsAllIn ? `全下到 ${raiseTo}` : `${raiseVerb}到 ${raiseTo}`}</strong>
                    </div>
                    <div className={styles.raiseInputs}>
                      <input
                        className={styles.raiseInput}
                        type="range"
                        min={legal.minRaiseTo}
                        max={legal.maxRaiseTo}
                        step={1}
                        value={clampMultiplayerRaiseTarget(raiseTo, legal.minRaiseTo, legal.maxRaiseTo)}
                        onChange={(event) => setRaiseDraft({ turnKey: raiseTurnKey!, value: Number(event.target.value) })}
                        aria-label={`${raiseVerb}金额滑杆`}
                      />
                      <label className={styles.raiseNumberField}>
                        <span>到</span>
                        <input
                          type="number"
                          min={legal.minRaiseTo}
                          max={legal.maxRaiseTo}
                          step={1}
                          inputMode="numeric"
                          value={raiseTo}
                          onChange={(event) => {
                            const value = event.target.valueAsNumber;
                            if (Number.isFinite(value)) setRaiseDraft({ turnKey: raiseTurnKey!, value });
                          }}
                          aria-label={`${raiseVerb}到的筹码总额`}
                        />
                      </label>
                    </div>
                    <div className={styles.raisePresets} aria-label="快捷下注尺寸">
                      {raisePresets.map((preset) => (
                        <button
                          className={preset.target === raiseTo ? styles.raisePresetActive : ""}
                          type="button"
                          key={`${preset.key}-${preset.target}`}
                          onClick={() => setRaiseDraft({ turnKey: raiseTurnKey!, value: preset.target })}
                        >
                          {preset.label}<small>{preset.target}</small>
                        </button>
                      ))}
                    </div>
                    <small className={styles.raiseExplanation}>
                      本次投入 {raiseAdditional}{selfPlayer ? ` · 操作后剩余 ${Math.max(0, selfPlayer.stack - raiseAdditional)}` : ""}
                    </small>
                      </div>
                    ) : (
                      <div className={styles.actionIdle}>
                        <span>桌上行动进行中</span>
                        <strong>{isMyTurn ? "当前没有可用的加注路线" : `等待 ${actingPlayer?.handle ?? "牌桌"}`}</strong>
                      </div>
                    )}
                  </>
                )}

                {(phase === "showdown" || phase === "between_hands") && (
                  <div className={styles.handTransition}>
                    <div className={styles.nextHandWaitingPanel} role="status" aria-live="polite">
                      {pendingShowSeat !== null && (
                        <div className={styles.showDecisionInline}>
                          <div className={styles.showDecisionCopy}>
                            <span>SHOW OR MUCK · 本手赢家</span>
                            <strong>
                              {mustChooseShow
                                ? `你可以在 ${nextHandCountdown ?? "—"} 秒内决定亮牌或盖牌`
                                : `等待 ${pendingShowPlayer?.handle ?? "本手赢家"} 选择亮牌或盖牌 · ${nextHandCountdown ?? "—"}s`}
                            </strong>
                            <small>{mustChooseShow ? "亮牌可以塑造桌上形象；全桌倒计时不会暂停，到点未选择会自动盖牌。" : "亮牌选择与全桌共用同一个下一手倒计时，不会额外等待。"}</small>
                          </div>
                          {mustChooseShow ? (
                            <div className={styles.showDecisionActions}>
                              <button className={styles.secondaryButton} type="button" disabled={busy} onClick={() => void sendCommand({ type: "show", handId: game.handId, show: false })}>盖牌</button>
                              <button className={styles.primaryButton} type="button" disabled={busy} onClick={() => void sendCommand({ type: "show", handId: game.handId, show: true })}>亮出赢家手牌</button>
                            </div>
                          ) : (
                            <span className={styles.showDecisionWaiting}><i />等待决定</span>
                          )}
                        </div>
                      )}

                      <div className={styles.autoNextHand} role="status" aria-live="polite">
                        <span className={styles.autoNextPulse} />
                        <span>
                          <strong>
                            {snapshot.table.finishRequested
                              ? nextHandCountdown === 0
                                ? "正在生成整局结算…"
                                : `${nextHandCountdown ?? "—"} 秒后生成整局结算`
                              : tournamentWinner
                              ? `单桌淘汰赛结束 · ${tournamentWinner.handle} 获胜`
                              : selfPlayer?.stack === 0 && snapshot.table.tableMode === "tournament"
                                ? "等待其余玩家进入下一手"
                                : selfPlayer?.stack === 0
                                  ? `将自动补至 ${snapshot.table.startingStack} 筹码`
                                  : nextHandCountdown === 0
                                    ? "正在进入下一手…"
                                    : `${nextHandCountdown ?? "—"} 秒后进入下一手`}
                          </strong>
                          <small>{snapshot.table.finishRequested
                            ? pendingShowSeat !== null
                              ? "赢家仍可在同一倒计时内亮牌或盖牌；不会增加额外等待"
                              : "本手结果会保留到倒计时结束，随后向全桌展示整局总结"
                            : tournamentWinner
                            ? "牌局已经完成；最终手牌、赢家与筹码结算会保留在桌面上"
                            : pendingShowSeat !== null
                              ? "赢家可在倒计时内亮牌或盖牌；到点自动盖牌并进入下一手"
                              : "这是服务端统一倒计时；任一在线玩家都可在到点后触发发牌"}</small>
                        </span>
                      </div>
                      {phase === "between_hands" && !snapshot.table.finishRequested && !tournamentWinner && !selfPlayer?.ready && canRejoinNextHand && (
                        <button className={styles.primaryButton} type="button" disabled={busy} onClick={() => void sendCommand({ type: "ready", ready: true })}>
                          立即准备
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
