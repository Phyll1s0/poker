"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Suit = "♠" | "♥" | "♦" | "♣";
type Street = "preflop" | "flop" | "turn" | "river";
type ActionKind = "fold" | "check" | "call" | "raise";

type Card = { rank: number; suit: Suit };
type Player = {
  id: number;
  name: string;
  monogram: string;
  style: string;
  styleKey: keyof typeof AI_PROFILES | "human";
  stack: number;
  hole: Card[];
  folded: boolean;
  bet: number;
  contributed: number;
  hasActed: boolean;
  isHuman: boolean;
};

type Game = {
  players: Player[];
  community: Card[];
  deck: Card[];
  pot: number;
  street: Street;
  dealer: number;
  current: number;
  highestBet: number;
  minRaise: number;
  dealFrom: number;
  dealCount: number;
  handNo: number;
  status: "playing" | "showdown";
  result: string;
  log: string[];
};

type Review = {
  id: number;
  hand: number;
  street: string;
  cards: string;
  board: string;
  pot: number;
  toCall: number;
  equity: number;
  potOdds: number;
  action: string;
  recommended: string;
  score: number;
  note: string;
};

const SUITS: Suit[] = ["♠", "♥", "♦", "♣"];
const RANKS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
const SMALL_BLIND = 5;
const BIG_BLIND = 10;
const STARTING_STACK = 1000;

const AI_PROFILES = {
  gto: { aggression: 0.58, looseness: 0.28, bluff: 0.08 },
  lag: { aggression: 0.78, looseness: 0.4, bluff: 0.2 },
  tag: { aggression: 0.64, looseness: 0.22, bluff: 0.05 },
  adaptive: { aggression: 0.54, looseness: 0.31, bluff: 0.11 },
  nit: { aggression: 0.38, looseness: 0.16, bluff: 0.02 },
};

const AI_REVIEW_NOTES: Record<keyof typeof AI_PROFILES, string> = {
  gto: "频率均衡，下注尺度稳定，很少暴露明显漏洞。",
  lag: "入池范围宽、主动施压多，会用更多边缘牌制造困难。",
  tag: "入池谨慎但进攻坚决，持续下注通常代表较强范围。",
  adaptive: "会根据底池、牌面和行动压力动态调整进攻频率。",
  nit: "范围偏强、诈唬较少，大额投入通常需要认真对待。",
};

const PLAYER_TEMPLATES = [
  { name: "你", monogram: "ME", style: "训练席", styleKey: "human" as const, isHuman: true },
  { name: "ORION", monogram: "OR", style: "GTO 平衡", styleKey: "gto" as const, isHuman: false },
  { name: "SHARK", monogram: "SK", style: "松凶压迫", styleKey: "lag" as const, isHuman: false },
  { name: "IVY", monogram: "IV", style: "紧凶价值", styleKey: "tag" as const, isHuman: false },
  { name: "MIRA", monogram: "MI", style: "动态适应", styleKey: "adaptive" as const, isHuman: false },
  { name: "ROCK", monogram: "RK", style: "稳健保守", styleKey: "nit" as const, isHuman: false },
];

const STREET_LABELS: Record<Street, string> = {
  preflop: "翻牌前",
  flop: "翻牌",
  turn: "转牌",
  river: "河牌",
};

function makeDeck(): Card[] {
  return SUITS.flatMap((suit) => RANKS.map((rank) => ({ rank, suit })));
}

function shuffle<T>(source: T[]): T[] {
  const next = [...source];
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [next[i], next[j]] = [next[j], next[i]];
  }
  return next;
}

function rankLabel(rank: number) {
  return rank <= 10 ? String(rank) : ({ 11: "J", 12: "Q", 13: "K", 14: "A" } as Record<number, string>)[rank];
}

function cardText(card: Card) {
  return `${rankLabel(card.rank)}${card.suit}`;
}

function cardKey(card: Card) {
  return `${card.rank}-${card.suit}`;
}

function scoreFive(cards: Card[]): { score: number; name: string } {
  const ranks = cards.map((c) => c.rank).sort((a, b) => b - a);
  const counts = new Map<number, number>();
  ranks.forEach((rank) => counts.set(rank, (counts.get(rank) ?? 0) + 1));
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const unique = [...new Set(ranks)];
  if (unique[0] === 14) unique.push(1);
  let straightHigh = 0;
  for (let i = 0; i <= unique.length - 5; i += 1) {
    if (unique[i] - unique[i + 4] === 4) {
      straightHigh = unique[i];
      break;
    }
  }
  const flush = cards.every((card) => card.suit === cards[0].suit);
  const pack = (category: number, values: number[]) =>
    [category, ...values, 0, 0, 0, 0, 0].slice(0, 6).reduce((total, value) => total * 15 + value, 0);

  if (flush && straightHigh) return { score: pack(8, [straightHigh]), name: "同花顺" };
  if (groups[0][1] === 4) return { score: pack(7, [groups[0][0], groups[1][0]]), name: "四条" };
  if (groups[0][1] === 3 && groups[1]?.[1] === 2)
    return { score: pack(6, [groups[0][0], groups[1][0]]), name: "葫芦" };
  if (flush) return { score: pack(5, ranks), name: "同花" };
  if (straightHigh) return { score: pack(4, [straightHigh]), name: "顺子" };
  if (groups[0][1] === 3) {
    const kickers = groups.filter((g) => g[1] === 1).map((g) => g[0]);
    return { score: pack(3, [groups[0][0], ...kickers]), name: "三条" };
  }
  if (groups[0][1] === 2 && groups[1]?.[1] === 2) {
    const pairs = groups.filter((g) => g[1] === 2).map((g) => g[0]).sort((a, b) => b - a);
    const kicker = groups.find((g) => g[1] === 1)?.[0] ?? 0;
    return { score: pack(2, [pairs[0], pairs[1], kicker]), name: "两对" };
  }
  if (groups[0][1] === 2) {
    const kickers = groups.filter((g) => g[1] === 1).map((g) => g[0]);
    return { score: pack(1, [groups[0][0], ...kickers]), name: "一对" };
  }
  return { score: pack(0, ranks), name: "高牌" };
}

function bestHand(cards: Card[]): { score: number; name: string } {
  let best = { score: -1, name: "" };
  const choose = (start: number, picked: Card[]) => {
    if (picked.length === 5) {
      const result = scoreFive(picked);
      if (result.score > best.score) best = result;
      return;
    }
    for (let i = start; i <= cards.length - (5 - picked.length); i += 1) choose(i + 1, [...picked, cards[i]]);
  };
  choose(0, []);
  return best;
}

function preflopStrength(hole: Card[]): number {
  if (hole.length < 2) return 0;
  const [high, low] = [...hole].sort((a, b) => b.rank - a.rank);
  const pair = high.rank === low.rank;
  const suited = high.suit === low.suit;
  const gap = high.rank - low.rank;
  let value = (high.rank - 2) / 12 * 0.36 + (low.rank - 2) / 12 * 0.18;
  if (pair) value += 0.3 + (high.rank - 2) / 12 * 0.18;
  if (suited) value += 0.08;
  if (gap === 1) value += 0.07;
  else if (gap === 2) value += 0.035;
  if (high.rank === 14) value += 0.08;
  return Math.min(0.98, Math.max(0.08, value));
}

function estimateEquity(hole: Card[], community: Card[], opponents: number, iterations = 90): number {
  if (hole.length !== 2) return 0;
  const known = new Set([...hole, ...community].map(cardKey));
  const available = makeDeck().filter((card) => !known.has(cardKey(card)));
  let share = 0;
  for (let run = 0; run < iterations; run += 1) {
    const sample = shuffle(available).slice(0, 5 - community.length + opponents * 2);
    const board = [...community, ...sample.slice(0, 5 - community.length)];
    let cursor = 5 - community.length;
    const hero = bestHand([...hole, ...board]).score;
    const rivals: number[] = [];
    for (let i = 0; i < opponents; i += 1) {
      rivals.push(bestHand([sample[cursor], sample[cursor + 1], ...board]).score);
      cursor += 2;
    }
    const top = Math.max(hero, ...rivals);
    if (hero === top) share += 1 / (rivals.filter((score) => score === top).length + 1);
  }
  return share / iterations;
}

function currentEquity(game: Game, player: Player, iterations = 80): number {
  const opponents = Math.max(1, game.players.filter((p) => !p.folded && p.id !== player.id).length);
  if (game.street === "preflop") {
    const raw = preflopStrength(player.hole);
    return Math.max(0.08, Math.min(0.86, raw * (1 - (opponents - 1) * 0.055)));
  }
  return estimateEquity(player.hole, game.community, opponents, iterations);
}

function nextEligible(players: Player[], from: number) {
  for (let step = 1; step <= players.length; step += 1) {
    const index = (from + step) % players.length;
    if (!players[index].folded && players[index].stack > 0) return index;
  }
  return -1;
}

function committedPot(game: Game) {
  return game.pot + game.players.reduce((sum, player) => sum + player.bet, 0);
}

function freshGame(previous?: Game): Game {
  const deck = shuffle(makeDeck());
  const dealer = previous ? (previous.dealer + 1) % PLAYER_TEMPLATES.length : 0;
  const stacks = previous?.players.length
    ? previous.players.map((player) => (player.stack < BIG_BLIND ? STARTING_STACK : player.stack))
    : PLAYER_TEMPLATES.map(() => STARTING_STACK);
  const players: Player[] = PLAYER_TEMPLATES.map((template, id) => ({
    ...template,
    id,
    stack: stacks[id],
    hole: [],
    folded: false,
    bet: 0,
    contributed: 0,
    hasActed: false,
  }));
  let cursor = 0;
  for (let round = 0; round < 2; round += 1) {
    for (let offset = 1; offset <= players.length; offset += 1) {
      const seat = (dealer + offset) % players.length;
      players[seat].hole.push(deck[cursor]);
      cursor += 1;
    }
  }
  deck.splice(0, cursor);
  const smallBlind = (dealer + 1) % players.length;
  const bigBlind = (dealer + 2) % players.length;
  players[smallBlind].stack -= SMALL_BLIND;
  players[smallBlind].bet = SMALL_BLIND;
  players[smallBlind].contributed = SMALL_BLIND;
  players[bigBlind].stack -= BIG_BLIND;
  players[bigBlind].bet = BIG_BLIND;
  players[bigBlind].contributed = BIG_BLIND;
  return {
    players,
    community: [],
    deck,
    pot: 0,
    street: "preflop",
    dealer,
    current: nextEligible(players, bigBlind),
    highestBet: BIG_BLIND,
    minRaise: BIG_BLIND,
    dealFrom: 0,
    dealCount: 0,
    handNo: (previous?.handNo ?? 0) + 1,
    status: "playing",
    result: "",
    log: [`第 ${(previous?.handNo ?? 0) + 1} 手开始 · 盲注 ${SMALL_BLIND}/${BIG_BLIND}`],
  };
}

function awardUncontested(game: Game, players: Player[]): Game {
  const winner = players.find((player) => !player.folded)!;
  const total = game.pot + players.reduce((sum, player) => sum + player.bet, 0);
  const finalPlayers = players.map((player) =>
    player.id === winner.id ? { ...player, stack: player.stack + total, bet: 0 } : { ...player, bet: 0 },
  );
  const result = `${winner.name} 收下底池 ${total}`;
  return { ...game, players: finalPlayers, pot: 0, current: -1, status: "showdown", result, log: [result, ...game.log] };
}

function settleShowdown(game: Game): Game {
  const total = game.pot + game.players.reduce((sum, player) => sum + player.bet, 0);
  const payouts = new Map<number, number>();
  const levels = [...new Set(game.players.filter((player) => player.contributed > 0).map((player) => player.contributed))].sort((a, b) => a - b);
  let previousLevel = 0;
  let headlineWinners: { player: Player; score: number; name: string }[] = [];
  for (const level of levels) {
    const contributors = game.players.filter((player) => player.contributed >= level);
    const layerAmount = (level - previousLevel) * contributors.length;
    previousLevel = level;
    const eligible = contributors.filter((player) => !player.folded);
    if (!eligible.length || !layerAmount) continue;
    const ranked = eligible.map((player) => ({ player, ...bestHand([...player.hole, ...game.community]) }));
    const topScore = Math.max(...ranked.map((entry) => entry.score));
    const winners = ranked.filter((entry) => entry.score === topScore);
    if (!headlineWinners.length) headlineWinners = winners;
    const share = Math.floor(layerAmount / winners.length);
    let remainder = layerAmount - share * winners.length;
    winners.forEach((winner) => {
      const amount = share + (remainder > 0 ? 1 : 0);
      remainder = Math.max(0, remainder - 1);
      payouts.set(winner.player.id, (payouts.get(winner.player.id) ?? 0) + amount);
    });
  }
  const paid = [...payouts.values()].reduce((sum, amount) => sum + amount, 0);
  const finalPlayers = game.players.map((player) => ({
    ...player,
    stack: player.stack + (payouts.get(player.id) ?? 0),
    bet: 0,
  }));
  const result = `${headlineWinners.map((entry) => entry.player.name).join(" / ")} · ${headlineWinners[0]?.name ?? "胜出"} · 赢得 ${paid || total}`;
  return { ...game, players: finalPlayers, pot: 0, current: -1, status: "showdown", result, log: [result, ...game.log] };
}

function advanceStreet(game: Game, players: Player[]): Game {
  const collected = players.reduce((sum, player) => sum + player.bet, 0);
  const resetPlayers = players.map((player) => ({ ...player, bet: 0, hasActed: false }));
  const deck = [...game.deck];
  const community = [...game.community];
  const dealFrom = community.length;
  let nextStreet: Street = game.street;

  if (game.street === "preflop") {
    community.push(deck.shift()!, deck.shift()!, deck.shift()!);
    nextStreet = "flop";
  } else if (game.street === "flop") {
    community.push(deck.shift()!);
    nextStreet = "turn";
  } else if (game.street === "turn") {
    community.push(deck.shift()!);
    nextStreet = "river";
  } else {
    return settleShowdown({ ...game, players: resetPlayers, pot: game.pot + collected });
  }

  const activeWithChips = resetPlayers.filter((player) => !player.folded && player.stack > 0);
  if (activeWithChips.length <= 1) {
    while (community.length < 5) community.push(deck.shift()!);
    return settleShowdown({
      ...game,
      players: resetPlayers,
      deck,
      community,
      street: "river",
      pot: game.pot + collected,
      dealFrom,
      dealCount: community.length - dealFrom,
    });
  }

  return {
    ...game,
    players: resetPlayers,
    deck,
    community,
    pot: game.pot + collected,
    street: nextStreet,
    current: nextEligible(resetPlayers, game.dealer),
    highestBet: 0,
    minRaise: BIG_BLIND,
    dealFrom,
    dealCount: community.length - dealFrom,
    log: [`进入${STREET_LABELS[nextStreet]} · 底池 ${game.pot + collected}`, ...game.log],
  };
}

function act(game: Game, playerId: number, kind: ActionKind, raiseTo?: number): Game {
  if (game.status !== "playing" || game.current !== playerId) return game;
  const players = game.players.map((player) => ({ ...player }));
  const player = players[playerId];
  const toCall = Math.max(0, game.highestBet - player.bet);
  let highestBet = game.highestBet;
  let minRaise = game.minRaise;
  let actionText = "";

  if (kind === "fold") {
    player.folded = true;
    player.hasActed = true;
    actionText = `${player.name} 弃牌`;
  } else if (kind === "check" && toCall === 0) {
    player.hasActed = true;
    actionText = `${player.name} 过牌`;
  } else if (kind === "call") {
    const paid = Math.min(toCall, player.stack);
    player.stack -= paid;
    player.bet += paid;
    player.contributed += paid;
    player.hasActed = true;
    actionText = paid < toCall ? `${player.name} 全下 ${paid}` : `${player.name} 跟注 ${paid}`;
  } else if (kind === "raise") {
    const maxTarget = player.bet + player.stack;
    const legalFloor = game.highestBet + game.minRaise;
    const target = Math.max(player.bet, Math.min(maxTarget, Math.max(raiseTo ?? legalFloor, Math.min(legalFloor, maxTarget))));
    const paid = target - player.bet;
    const increase = target - game.highestBet;
    player.stack -= paid;
    player.bet = target;
    player.contributed += paid;
    player.hasActed = true;
    if (target > game.highestBet) {
      highestBet = target;
      if (increase >= game.minRaise) minRaise = increase;
      players.forEach((other) => {
        if (other.id !== player.id && !other.folded && other.stack > 0) other.hasActed = false;
      });
      actionText = `${player.name} ${player.stack === 0 ? "全下至" : "加注至"} ${target}`;
    } else {
      actionText = `${player.name} 跟注 ${paid}`;
    }
  } else {
    return game;
  }

  const withLog = { ...game, players, highestBet, minRaise, log: [actionText, ...game.log] };
  const remaining = players.filter((candidate) => !candidate.folded);
  if (remaining.length === 1) return awardUncontested(withLog, players);
  const actors = remaining.filter((candidate) => candidate.stack > 0);
  const roundComplete = actors.every((candidate) => candidate.hasActed && candidate.bet === highestBet);
  if (roundComplete) return advanceStreet(withLog, players);

  return { ...withLog, current: nextEligible(players, playerId) };
}

function chooseAiAction(game: Game, player: Player): { kind: ActionKind; raiseTo?: number } {
  const profile = AI_PROFILES[player.styleKey as keyof typeof AI_PROFILES];
  const equity = currentEquity(game, player, game.street === "preflop" ? 1 : 52);
  const toCall = Math.max(0, game.highestBet - player.bet);
  const pot = committedPot(game);
  const potOdds = toCall > 0 ? toCall / (pot + toCall) : 0;
  const pressure = toCall / Math.max(1, player.stack + player.bet);
  const bluffing = Math.random() < profile.bluff * (toCall === 0 ? 1.2 : 0.45);
  const strong = equity > 0.6 - profile.aggression * 0.08;
  const raiseSize = Math.max(game.minRaise, Math.round((pot * (0.42 + profile.aggression * 0.45)) / BIG_BLIND) * BIG_BLIND);
  const target = Math.min(player.bet + player.stack, game.highestBet + raiseSize);

  if (toCall > 0) {
    if (!bluffing && equity + profile.looseness * 0.16 < potOdds + pressure * 0.12) return { kind: "fold" };
    if ((strong || bluffing) && target > game.highestBet && Math.random() < profile.aggression) return { kind: "raise", raiseTo: target };
    return { kind: "call" };
  }
  if ((strong || bluffing) && target > game.highestBet && Math.random() < profile.aggression + 0.12)
    return { kind: "raise", raiseTo: target };
  return { kind: "check" };
}

function getAdvice(game: Game, player: Player, equity: number) {
  const toCall = Math.max(0, game.highestBet - player.bet);
  const pot = committedPot(game);
  const potOdds = toCall > 0 ? toCall / (pot + toCall) : 0;
  let action: ActionKind;
  let note: string;
  if (toCall > 0 && equity < potOdds - 0.045) {
    action = "fold";
    note = `胜率约 ${Math.round(equity * 100)}%，低于跟注所需 ${Math.round(potOdds * 100)}%。控制负 EV 跟注。`;
  } else if (equity > (toCall > 0 ? 0.59 : 0.51)) {
    action = "raise";
    note = `胜率约 ${Math.round(equity * 100)}%，具备价值下注或保护范围的空间。`;
  } else {
    action = toCall > 0 ? "call" : "check";
    note = toCall > 0
      ? `底池赔率需要 ${Math.round(potOdds * 100)}%，当前估算胜率 ${Math.round(equity * 100)}%，继续范围合理。`
      : `中等牌力适合控制底池，保留对手的诈唬范围。`;
  }
  return { action, note, potOdds };
}

const ACTION_LABELS: Record<ActionKind, string> = { fold: "弃牌", check: "过牌", call: "跟注", raise: "加注" };

function PlayingCard({ card, ghost = false, dealDelay }: { card?: Card; ghost?: boolean; dealDelay?: number }) {
  if (!card) return <div className={ghost ? "card card-ghost" : "card card-back"}><span>♠</span></div>;
  const red = card.suit === "♥" || card.suit === "♦";
  return (
    <div
      className={`card ${red ? "red" : "black"} ${dealDelay !== undefined ? "dealt-card" : ""}`}
      style={dealDelay !== undefined ? { animationDelay: `${dealDelay}ms` } : undefined}
      aria-label={cardText(card)}
    >
      <span className="card-rank">{rankLabel(card.rank)}</span>
      <span className="card-suit">{card.suit}</span>
    </div>
  );
}

function PlayerSeat({ player, game, index, thinking, revealReady }: { player: Player; game: Game; index: number; thinking: boolean; revealReady: boolean }) {
  const reveal = game.status === "showdown" && revealReady && !player.folded;
  const isCurrent = game.current === index;
  const role = index === game.dealer ? "D" : index === (game.dealer + 1) % 6 ? "SB" : index === (game.dealer + 2) % 6 ? "BB" : "";
  return (
    <div className={`player-seat seat-${index} ${isCurrent ? "is-current" : ""} ${player.folded ? "is-folded" : ""}`}>
      <div className={`seat-cards ${reveal || player.isHuman ? "is-revealed" : ""}`} aria-label={reveal ? `${player.name} 的手牌` : `${player.name} 的手牌未公开`}>
        {player.hole.map((card, cardIndex) => (
          <PlayingCard key={cardKey(card)} card={reveal || player.isHuman ? card : undefined} />
        ))}
      </div>
      <div className="player-panel">
        <div className="avatar">{player.monogram}</div>
        <div className="player-copy">
          <div className="player-title">
            <strong>{player.name}</strong>
            {role && <span className="role-chip">{role}</span>}
          </div>
          <span>{player.isHuman ? player.style : "策略隐藏"}</span>
        </div>
        <div className="stack"><i />{player.stack}</div>
      </div>
      {player.bet > 0 && <div className="table-bet"><i />{player.bet}</div>}
      {thinking && isCurrent && <div className="thinking"><b /><b /><b /></div>}
      {player.folded && <div className="fold-label">已弃牌</div>}
    </div>
  );
}

export default function Home() {
  const [game, setGame] = useState<Game | null>(null);
  const [training, setTraining] = useState(true);
  const [thinking, setThinking] = useState(false);
  const [raiseTo, setRaiseTo] = useState(30);
  const [review, setReview] = useState<Review[]>([]);
  const [feedback, setFeedback] = useState<Review | null>(null);
  const [showLog, setShowLog] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [dealing, setDealing] = useState(false);

  useEffect(() => setGame(freshGame()), []);

  const human = game?.players[0];
  const isHumanTurn = Boolean(game && human && !dealing && game.status === "playing" && game.current === human.id);
  const toCall = game && human ? Math.max(0, game.highestBet - human.bet) : 0;
  const minTarget = game && human ? Math.min(human.bet + human.stack, game.highestBet + game.minRaise) : 0;
  const maxTarget = human ? human.bet + human.stack : 0;
  const raiseDisabled = !game || maxTarget <= game.highestBet || !isHumanTurn;

  useEffect(() => {
    if (!game || game.community.length === 0 || game.dealCount === 0) {
      setDealing(false);
      return;
    }
    setDealing(true);
    const duration = 520 + Math.max(0, game.dealCount - 1) * 300;
    const timer = window.setTimeout(() => setDealing(false), duration);
    return () => window.clearTimeout(timer);
  }, [game?.community.length, game?.handNo]);

  useEffect(() => {
    if (game?.status === "showdown" && !dealing) setShowLog(true);
  }, [game?.status, dealing]);

  useEffect(() => {
    if (isHumanTurn && maxTarget > 0) setRaiseTo(Math.max(minTarget, Math.min(maxTarget, Math.max(30, minTarget))));
  }, [isHumanTurn, minTarget, maxTarget, game?.street]);

  const equity = useMemo(() => {
    if (!game || !human || !isHumanTurn) return 0;
    return currentEquity(game, human, game.street === "preflop" ? 1 : 110);
  }, [game, human, isHumanTurn]);

  const advice = useMemo(() => (game && human && isHumanTurn ? getAdvice(game, human, equity) : null), [game, human, isHumanTurn, equity]);

  useEffect(() => {
    if (!game || dealing || game.status !== "playing" || game.current < 0) return;
    const player = game.players[game.current];
    if (!player || player.isHuman) return;
    setThinking(true);
    const timer = window.setTimeout(() => {
      setGame((current) => {
        if (!current || current.status !== "playing" || current.current !== player.id) return current;
        const decision = chooseAiAction(current, current.players[player.id]);
        return act(current, player.id, decision.kind, decision.raiseTo);
      });
      setThinking(false);
    }, 520 + Math.random() * 620);
    return () => window.clearTimeout(timer);
  }, [game, dealing]);

  const startNextHand = useCallback(() => {
    setFeedback(null);
    setShowLog(false);
    setGame((current) => freshGame(current ?? undefined));
  }, []);

  const handleAction = useCallback((kind: ActionKind) => {
    if (!game || !human || !isHumanTurn || !advice) return;
    const exact = kind === advice.action;
    const compatible =
      (advice.action === "raise" && (kind === "call" || kind === "check")) ||
      ((advice.action === "call" || advice.action === "check") && kind === "raise");
    const score = exact ? 100 : compatible ? 74 : 42;
    const entry: Review = {
      id: Date.now(),
      hand: game.handNo,
      street: STREET_LABELS[game.street],
      cards: human.hole.map(cardText).join(" "),
      board: game.community.length ? game.community.map(cardText).join(" ") : "—",
      pot: committedPot(game),
      toCall,
      equity,
      potOdds: advice.potOdds,
      action: kind === "raise" ? `加注至 ${raiseTo}` : ACTION_LABELS[kind],
      recommended: ACTION_LABELS[advice.action],
      score,
      note: advice.note,
    };
    setReview((items) => [entry, ...items].slice(0, 12));
    setFeedback(entry);
    setGame((current) => (current ? act(current, human.id, kind, kind === "raise" ? raiseTo : undefined) : current));
  }, [game, human, isHumanTurn, advice, raiseTo, toCall, equity]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement)?.tagName === "INPUT") return;
      const key = event.key.toLowerCase();
      if (game?.status === "showdown" && !dealing && key === "n") {
        startNextHand();
        return;
      }
      if (!isHumanTurn) return;
      if (key === "f") handleAction("fold");
      if (key === "c") handleAction(toCall === 0 ? "check" : "call");
      if (key === "r" && !raiseDisabled) handleAction("raise");
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [game?.status, dealing, isHumanTurn, toCall, raiseDisabled, handleAction, startNextHand]);

  if (!game || !human) {
    return (
      <main className="loading-screen">
        <div className="brand-mark">P</div>
        <span>正在洗牌…</span>
      </main>
    );
  }

  const sessionScore = review.length ? Math.round(review.reduce((sum, item) => sum + item.score, 0) / review.length) : "—";
  const handReview = review.filter((item) => item.hand === game.handNo);
  const handScore = handReview.length ? Math.round(handReview.reduce((sum, item) => sum + item.score, 0) / handReview.length) : "—";
  const reviewUnlocked = game.status === "showdown" && !dealing;

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">P</div>
          <div><strong>RANGECRAFT</strong><span>德州扑克训练室</span></div>
        </div>
        <div className="session-meta">
          <span className="status-dot" />
          <span>本地单机</span>
          <i />
          <span>NL10 · 6-MAX</span>
          <i />
          <span>第 {game.handNo} 手</span>
        </div>
        <div className="header-actions">
          <button className={`training-toggle ${training ? "on" : ""}`} onClick={() => setTraining((value) => !value)}>
            <span>训练提示</span><b>{training ? "ON" : "OFF"}</b>
          </button>
          <button className="icon-button" aria-label="查看游戏说明" onClick={() => setInfoOpen(true)}>?</button>
        </div>
      </header>

      <div className="workspace">
        <section className="table-zone">
          <div className="ambient ambient-one" />
          <div className="ambient ambient-two" />
          <div className="poker-table">
            <div className="table-rail" />
            <div className="table-felt">
              <div className="felt-grain" />
              <div className="pot-display">
                <span>底池</span>
                <strong><i />{committedPot(game)}</strong>
              </div>
              <div className="community-cards">
                {[0, 1, 2, 3, 4].map((index) => {
                  const newlyDealt = index >= game.dealFrom && index < game.dealFrom + game.dealCount;
                  return (
                    <PlayingCard
                      key={index}
                      card={game.community[index]}
                      ghost={!game.community[index]}
                      dealDelay={newlyDealt ? (index - game.dealFrom) * 300 : undefined}
                    />
                  );
                })}
              </div>
              <div className="table-signature">RANGECRAFT <span>◆</span> TRAINING CLUB</div>
              {reviewUnlocked && (
                <div className="result-banner">
                  <span>本手结束</span>
                  <strong>{game.result}</strong>
                  <button onClick={startNextHand}>下一手 <kbd>N</kbd></button>
                </div>
              )}
            </div>
            {game.players.map((player, index) => <PlayerSeat key={player.id} player={player} game={game} index={index} thinking={thinking} revealReady={!dealing} />)}
          </div>

          <div className={`action-dock ${isHumanTurn ? "active" : ""} ${dealing ? "is-dealing" : ""}`}>
            <div className="turn-summary">
              <div>
                <span>{dealing ? "正在发牌" : isHumanTurn ? "轮到你行动" : game.status === "showdown" ? "牌局已结束" : "对手思考中"}</span>
                <strong>{STREET_LABELS[game.street]}</strong>
              </div>
              {isHumanTurn && <div className="timer-ring"><span>∞</span></div>}
            </div>
            <div className="primary-actions">
              <button className="action-button fold" onClick={() => handleAction("fold")} disabled={!isHumanTurn}>弃牌 <kbd>F</kbd></button>
              {toCall === 0 ? (
                <button className="action-button neutral" onClick={() => handleAction("check")} disabled={!isHumanTurn}>过牌 <kbd>C</kbd></button>
              ) : (
                <button className="action-button neutral" onClick={() => handleAction("call")} disabled={!isHumanTurn}>跟注 {toCall} <kbd>C</kbd></button>
              )}
              <button className="action-button raise" onClick={() => handleAction("raise")} disabled={raiseDisabled}>加注至 {raiseTo} <kbd>R</kbd></button>
            </div>
            <div className="raise-control">
              <div className="range-row">
                <span>{minTarget}</span>
                <input
                  aria-label="加注金额"
                  type="range"
                  min={Math.max(0, minTarget)}
                  max={Math.max(minTarget, maxTarget)}
                  step={BIG_BLIND}
                  value={Math.min(Math.max(raiseTo, minTarget), Math.max(minTarget, maxTarget))}
                  onChange={(event) => setRaiseTo(Number(event.target.value))}
                  disabled={raiseDisabled}
                />
                <span>{maxTarget}</span>
              </div>
              <div className="quick-bets">
                {[0.33, 0.5, 0.75, 1].map((ratio) => (
                  <button key={ratio} disabled={raiseDisabled} onClick={() => setRaiseTo(Math.min(maxTarget, Math.max(minTarget, Math.round((game.highestBet + committedPot(game) * ratio) / 10) * 10)))}>
                    {ratio === 1 ? "底池" : `${Math.round(ratio * 100)}%`}
                  </button>
                ))}
                <button disabled={raiseDisabled} onClick={() => setRaiseTo(maxTarget)}>全下</button>
              </div>
            </div>
          </div>
        </section>

        <aside className="coach-panel">
          <div className="coach-heading">
            <div><span>AI COACH</span><h2>决策实验室</h2></div>
            <div className="score-badge"><strong>{sessionScore}</strong><span>本局评分</span></div>
          </div>

          <div className="tabs" role="tablist">
            <button className={!showLog ? "active" : ""} onClick={() => setShowLog(false)}>实时教练</button>
            <button className={showLog ? "active" : ""} onClick={() => setShowLog(true)}>本手复盘{reviewUnlocked ? " · 已解锁" : ""}</button>
          </div>

          {!showLog ? (
            <div className="analysis-content">
              <section className="equity-card">
                <div className="section-label"><span>牌面概览</span><b>{isHumanTurn ? "LIVE" : "WAIT"}</b></div>
                <div className="equity-main">
                  <div className="equity-number"><strong>{isHumanTurn ? Math.round(equity * 100) : "—"}</strong><span>%<br />估算胜率</span></div>
                  <div className="equity-bars">
                    <span><i style={{ width: `${isHumanTurn ? equity * 100 : 0}%` }} /></span>
                    <div><b>你的范围</b><em>{human.hole.map(cardText).join("  ")}</em></div>
                  </div>
                </div>
                <div className="metric-grid">
                  <div><span>底池赔率</span><strong>{isHumanTurn && advice ? `${Math.round(advice.potOdds * 100)}%` : "—"}</strong></div>
                  <div><span>有效筹码</span><strong>{Math.min(...game.players.filter((p) => !p.folded).map((p) => p.stack)) / BIG_BLIND} BB</strong></div>
                  <div><span>SPR</span><strong>{(human.stack / Math.max(1, committedPot(game))).toFixed(1)}</strong></div>
                </div>
              </section>

              <section className={`coach-callout ${training && isHumanTurn ? "visible" : "muted"}`}>
                <div className="coach-icon">◆</div>
                <div>
                  <span>GTO 启发式建议</span>
                  <h3>{training && isHumanTurn && advice ? `优先考虑 · ${ACTION_LABELS[advice.action]}` : training ? "等待你的行动点" : "训练提示已关闭"}</h3>
                  <p>{training && isHumanTurn && advice ? advice.note : training ? "AI 行动结束后，这里会给出范围、赔率与推荐线路。" : "关闭提示时仍会记录你的决策，方便牌后复盘。"}</p>
                </div>
              </section>

              {feedback ? (
                <section className="last-decision">
                  <div className="decision-top"><span>上一决策</span><b className={feedback.score >= 85 ? "good" : feedback.score >= 65 ? "ok" : "bad"}>{feedback.score} 分</b></div>
                  <h3>{feedback.score >= 85 ? "线路漂亮，继续保持" : feedback.score >= 65 ? "可执行，但有更优选择" : "这里值得重点复盘"}</h3>
                  <p>你选择了{feedback.action}，推荐线路是{feedback.recommended}。{feedback.note}</p>
                </section>
              ) : (
                <section className="last-decision empty-decision"><span>完成第一个决策后，这里会出现即时反馈。</span></section>
              )}

              <section className="opponent-grid">
                <div className="section-label"><span>对手画像</span><small>牌后解锁</small></div>
                <div className="locked-profile">
                  <span>◇</span>
                  <div><b>本手保持未知</b><p>结束后进入“本手复盘”，再查看每位电脑的策略倾向。</p></div>
                </div>
              </section>
            </div>
          ) : (
            <div className="log-content">
              <div className={`review-summary ${reviewUnlocked ? "unlocked" : ""}`}>
                <div><span>{reviewUnlocked ? "本手复盘已生成" : "正在记录本手"}</span><h3>第 {game.handNo} 手 · {STREET_LABELS[game.street]}</h3></div>
                <strong>{handScore}<small>{handReview.length ? "分" : "暂无决策"}</small></strong>
              </div>
              <div className="review-log">
                <div className="section-label"><span>你的决策路径</span><small>{handReview.length} 个节点</small></div>
                {handReview.length ? handReview.map((item) => (
                  <div className="review-row" key={item.id}>
                    <span className={item.score >= 85 ? "good" : item.score >= 65 ? "ok" : "bad"}>{item.score}</span>
                    <div>
                      <b>{item.street} · 手牌 {item.cards}</b>
                      <p>公共牌 {item.board} · 底池 {item.pot} · 面对 {item.toCall}</p>
                      <p>你的选择：{item.action}　推荐：{item.recommended}</p>
                      <small>胜率 {Math.round(item.equity * 100)}% / 所需赔率 {Math.round(item.potOdds * 100)}% · {item.note}</small>
                    </div>
                  </div>
                )) : <p className="empty-log">你还没有在本手做出决策。每次行动后都会记录选择、推荐线路和原因。</p>}
              </div>
              <div className="opponent-review">
                <div className="section-label"><span>对手策略画像</span><small>{reviewUnlocked ? "已解锁" : "本手结束后解锁"}</small></div>
                {reviewUnlocked ? (
                  <div className="profile-list revealed">
                    {game.players.slice(1).map((player) => (
                      <div key={player.id}>
                        <span className={`profile-dot p-${player.id}`} />
                        <b>{player.name}</b>
                        <em><strong>{player.style}</strong>{AI_REVIEW_NOTES[player.styleKey as keyof typeof AI_PROFILES]}</em>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="review-lock"><span>◇</span><p>为了避免标签影响你的判断，对手风格将在本手结束后显示。</p></div>
                )}
              </div>
              <div className="hand-log">
                <div className="section-label"><span>整手行动线</span><small>{game.log.length} 个事件</small></div>
                {game.log.map((line, index) => <div key={`${line}-${index}`}><time>{String(game.log.length - index).padStart(2, "0")}</time><p>{line}</p></div>)}
              </div>
            </div>
          )}

          <footer className="coach-footer">
            <span><i /> 本地策略引擎</span>
            <button onClick={() => setInfoOpen(true)}>关于模型 ↗</button>
          </footer>
        </aside>
      </div>

      {infoOpen && (
        <div className="modal-backdrop" role="presentation" onClick={() => setInfoOpen(false)}>
          <section className="info-modal" role="dialog" aria-modal="true" aria-labelledby="info-title" onClick={(event) => event.stopPropagation()}>
            <button className="modal-close" onClick={() => setInfoOpen(false)} aria-label="关闭">×</button>
            <span className="eyebrow">ABOUT THE LAB</span>
            <h2 id="info-title">这是一间决策训练室，<br />不是一台完整 GTO 求解器。</h2>
            <p>当前版本用牌力模拟、底池赔率、位置与五类行动倾向组成轻量策略引擎，适合高频练习基本决策。真正的 GTO 训练还需要预计算范围、抽象下注树与求解数据库。</p>
            <div className="modal-grid">
              <div><b>现在可用</b><span>6 人现金局 · 完整四条街 · 牌型判定 · AI 对手 · 即时评分</span></div>
              <div><b>扩展边界</b><span>牌局命令与传输层已独立预留，可在后续接入 WebSocket 房间服务。</span></div>
            </div>
            <button className="modal-primary" onClick={() => setInfoOpen(false)}>回到牌桌</button>
          </section>
        </div>
      )}
    </main>
  );
}
