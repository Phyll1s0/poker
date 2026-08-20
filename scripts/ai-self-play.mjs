#!/usr/bin/env node

import { pathToFileURL } from "node:url";
import { AI_PROFILES, AI_STYLE_OPTIONS, sampleAiLineup } from "../lib/poker-ai.ts";
import {
  analyzeBoardTexture,
  bestHand,
  blockerValue,
  drawPotential,
  estimateEquity,
  makeDeck,
  preflopHandFeatures,
  preflopPercentile,
  preflopStrength,
} from "../lib/poker-evaluator.ts";
import {
  choosePokerPolicyAction,
  pokerCallClosesContestableLayers,
  pokerContestablePotAtDecision,
  pokerEffectiveStackAtDecision,
  sixMaxPreflopPosition,
  sixMaxPreflopPositionFactor,
} from "../lib/poker-policy.ts";

const PLAYER_COUNT = 6;
const SMALL_BLIND = 0.5;
const BIG_BLIND = 1;
const PROFILE_KEYS = AI_STYLE_OPTIONS.map(({ styleKey }) => styleKey);
const PROFILE_LABELS = Object.fromEntries(AI_STYLE_OPTIONS.map(({ styleKey, style }) => [styleKey, style]));

function clamp(value, minimum = 0, maximum = 1) {
  return Math.max(minimum, Math.min(maximum, value));
}

function rank(card) {
  return card.rank;
}

function seedNumber(seed) {
  let hash = 2166136261;
  for (const character of String(seed)) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function seededRandom(seed) {
  let state = seedNumber(seed);
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffledDeck(random) {
  const deck = makeDeck([0, 1, 2, 3]);
  for (let i = deck.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function visibleHandStrength(player, board) {
  const cards = [...player.hole, ...board];
  if (cards.length < 5) return preflopStrength(player.hole);
  const category = bestHand(cards).category;
  return clamp(category / 7 + Math.max(...player.hole.map(rank)) / 140, 0, 1);
}

function isInPosition(players, playerId, dealer, street, lastAggressor = null) {
  if (street === "preflop") {
    if (lastAggressor !== null && lastAggressor !== playerId) {
      const order = { SB: 0, BB: 1, UTG: 2, HJ: 3, CO: 4, BTN: 5 };
      return order[sixMaxPreflopPosition(playerId, dealer)] > order[sixMaxPreflopPosition(lastAggressor, dealer)];
    }
    return playerId === dealer;
  }
  const start = (dealer + 1) % PLAYER_COUNT;
  let lastToAct = -1;
  for (let offset = 0; offset < PLAYER_COUNT; offset += 1) {
    const candidate = players[(start + offset) % PLAYER_COUNT];
    if (!candidate.folded && candidate.stack > 0) lastToAct = candidate.id;
  }
  return playerId === lastToAct;
}

function decideAction(context) {
  const {
    player,
    players,
    dealer,
    board,
    currentBet,
    minRaise,
    raiseCount,
    pot,
    street,
    opponents,
    stackBb,
    equityIterations,
    equityRandom,
    equityCache,
    random,
    openingRaiserId,
    preflopLimpers,
    preflopColdCallers,
    lastAggressor,
  } = context;
  const profile = AI_PROFILES[player.styleKey];
  const toCall = Math.max(0, currentBet - player.bet);
  const draw = drawPotential(player.hole, board);
  const blockers = blockerValue(player.hole, board);
  const boardTexture = analyzeBoardTexture(board);
  const handStrength = street === "preflop" ? preflopStrength(player.hole) : visibleHandStrength(player, board);
  const liveOpponents = players
    .filter((candidate) => candidate.id !== player.id && !candidate.folded);
  const effectiveStack = pokerEffectiveStackAtDecision(
    player.stack,
    player.bet,
    liveOpponents.map((candidate) => ({ stack: candidate.stack, bet: candidate.bet })),
  );
  const effectiveStackBb = effectiveStack / BIG_BLIND;
  const opponentsCanRespond = liveOpponents.some((candidate) => candidate.stack > 0);
  const callEndsHand = toCall > 0 && (
    pokerCallClosesContestableLayers(
      player.id,
      player.contributed,
      player.stack,
      toCall,
      players,
    )
    || !opponentsCanRespond
    || (street === "river" && liveOpponents
      .filter((candidate) => candidate.stack > 0)
      .every((candidate) => candidate.hasActed && candidate.bet === currentBet))
  );
  const decisionPot = pokerContestablePotAtDecision(
    player.id,
    player.contributed,
    player.stack,
    toCall,
    players,
  );
  const policyPot = toCall > 0 ? decisionPot.currentPot : pot;
  const potOdds = decisionPot.callCost > 0
    ? decisionPot.callCost / Math.max(1, decisionPot.finalPot)
    : 0;
  const equityMattersPreflop = effectiveStackBb <= 18 || (raiseCount >= 2 && effectiveStackBb <= 45);
  const shouldSampleEquity = callEndsHand || street !== "preflop" || equityMattersPreflop;
  const layerKey = callEndsHand
    ? decisionPot.layers.map((layer) => `${layer.amount}:${layer.opponentIds.join(",")}`).join(";")
    : "open";
  const equityKey = `${player.id}|${opponents}|${board.map((card) => `${card.rank}-${card.suit}`).join(",")}|${layerKey}`;
  let equity = shouldSampleEquity ? equityCache.get(equityKey) : handStrength;
  if (equity === undefined) {
    if (callEndsHand && decisionPot.finalPot > 0 && decisionPot.layers.length > 0) {
      const layerIterations = Math.max(24, Math.floor(equityIterations / decisionPot.layers.length));
      const expectedPayout = decisionPot.layers.reduce((sum, layer) => {
        if (!layer.opponentIds.length) return sum + layer.amount;
        const layerEquity = estimateEquity(player.hole, board, {
          opponents: layer.opponentIds.length,
          iterations: layerIterations,
          random: equityRandom,
          suits: [0, 1, 2, 3],
        });
        return sum + layer.amount * layerEquity;
      }, 0);
      equity = expectedPayout / decisionPot.finalPot;
    } else {
      equity = estimateEquity(player.hole, board, {
        opponents,
        iterations: equityIterations,
        random: equityRandom,
        suits: [0, 1, 2, 3],
      });
    }
    equityCache.set(equityKey, equity);
  }
  const action = choosePokerPolicyAction({
    profile,
    street,
    equity,
    handStrength,
    draw,
    blockers,
    pot: policyPot,
    toCall,
    potOdds,
    inPosition: isInPosition(players, player.id, dealer, street, lastAggressor),
    activeOpponents: opponents,
    opponentsCanRespond,
    callEndsHand,
    effectiveStackBb,
    startingDepthBb: stackBb,
    highestBet: currentBet,
    playerBet: player.bet,
    playerStack: player.stack,
    minRaise,
    raiseLocked: player.raiseLocked,
    squidPressure: 0,
    bigBlind: BIG_BLIND,
    preflopPercentile: preflopPercentile(player.hole),
    preflopHand: preflopHandFeatures(player.hole),
    preflopPosition: sixMaxPreflopPosition(player.id, dealer),
    preflopPositionFactor: sixMaxPreflopPositionFactor(player.id, dealer),
    preflopRaiseCount: raiseCount,
    preflopOpenerPosition: openingRaiserId === null ? undefined : sixMaxPreflopPosition(openingRaiserId, dealer),
    preflopLimpers,
    preflopColdCallers,
    preflopPreviouslyRaised: player.pfr,
    boardWetness: boardTexture.wetness,
    boardPairing: boardTexture.pairedness,
    boardHighCard: boardTexture.highCard,
    initiative: lastAggressor === player.id,
    streetRaiseCount: raiseCount,
  }, random);
  return action.kind === "raise" ? { kind: "raise", target: action.raiseTo } : action;
}

function post(player, amount) {
  const paid = Math.min(player.stack, Math.max(0, amount));
  player.stack -= paid;
  player.bet += paid;
  player.contributed += paid;
  return paid;
}

function recordAction(player, street, action, currentBetBefore, amount) {
  if (street === "preflop" && amount > 0 && (action === "call" || action === "raise")) {
    player.vpip = true;
    if (action === "raise") player.pfr = true;
  }
  if (action === "call" && amount > 0) player.calls += 1;
  if (action === "raise") {
    if (currentBetBefore === 0) player.bets += 1;
    else player.raises += 1;
  }
}

function bettingRound(state, street, startAt) {
  const { players, board } = state;
  for (const player of players) {
    player.hasActed = false;
    player.raiseLocked = false;
  }
  let currentBet = Math.max(...players.map((player) => player.bet));
  let minRaise = BIG_BLIND;
  let raiseCount = 0;
  let openingRaiserId = null;
  let preflopLimpers = 0;
  let preflopColdCallers = 0;
  let lastAggressor = state.lineAggressor ?? null;
  let pending = new Set(players.filter((player) => !player.folded && player.stack > 0).map((player) => player.id));
  let cursor = startAt;
  let safety = 0;

  while (pending.size > 0 && safety < 160) {
    safety += 1;
    if (players.filter((player) => !player.folded).length <= 1) break;
    const player = players[cursor];
    cursor = (cursor + 1) % PLAYER_COUNT;
    if (!pending.has(player.id) || player.folded || player.stack <= 0) continue;
    pending.delete(player.id);

    const pot = players.reduce((sum, candidate) => sum + candidate.contributed, 0);
    const opponents = players.filter((candidate) => !candidate.folded && candidate.id !== player.id).length;
    let decision = decideAction({
      player,
      players,
      dealer: state.dealer,
      board,
      currentBet,
      minRaise,
      raiseCount,
      pot,
      street,
      opponents,
      stackBb: state.stackBb,
      equityIterations: state.equityIterations,
      equityRandom: state.equityRandom,
      equityCache: state.equityCache,
      random: state.policyRandom,
      openingRaiserId,
      preflopLimpers,
      preflopColdCallers,
      lastAggressor,
    });
    const toCall = Math.max(0, currentBet - player.bet);
    const currentBetBefore = currentBet;

    if (decision.kind === "fold" && toCall === 0) decision = { kind: "check" };
    if (decision.kind === "check" && toCall > 0) decision = { kind: "fold" };

    if (decision.kind === "fold") {
      player.folded = true;
      player.hasActed = true;
      continue;
    }
    if (decision.kind === "check") {
      player.hasActed = true;
      continue;
    }
    if (decision.kind === "call") {
      const paid = post(player, toCall);
      player.hasActed = true;
      if (street === "preflop" && paid > 0) {
        if (raiseCount === 0) preflopLimpers += 1;
        else preflopColdCallers += 1;
      }
      recordAction(player, street, "call", currentBetBefore, paid);
      continue;
    }

    const maximumTarget = player.bet + player.stack;
    const requestedTarget = Math.max(currentBet + minRaise, decision.target ?? currentBet + minRaise);
    const target = Math.min(maximumTarget, requestedTarget);
    if (target <= currentBet) {
      const paid = post(player, toCall);
      player.hasActed = true;
      recordAction(player, street, "call", currentBetBefore, paid);
      continue;
    }
    const previousBet = player.bet;
    const paid = post(player, target - player.bet);
    const increase = target - currentBet;
    currentBet = target;
    player.hasActed = true;
    const fullRaise = increase >= minRaise;
    if (fullRaise) minRaise = increase;
    if (street === "preflop" && raiseCount === 0) openingRaiserId = player.id;
    raiseCount += 1;
    lastAggressor = player.id;
    for (const other of players) {
      if (other.id === player.id || other.folded || other.stack <= 0) continue;
      if (fullRaise) {
        other.hasActed = false;
        other.raiseLocked = false;
      } else if (other.hasActed) {
        other.raiseLocked = target - other.bet < minRaise;
      }
    }
    recordAction(player, street, "raise", currentBetBefore, paid);
    pending = new Set(players
      .filter((candidate) => candidate.id !== player.id && !candidate.folded && candidate.stack > 0 && candidate.bet < currentBet)
      .map((candidate) => candidate.id));
    if (player.bet <= previousBet) break;
  }
  state.lineAggressor = lastAggressor;
}

function settle(players, board) {
  const payouts = Array(PLAYER_COUNT).fill(0);
  const contenders = players.filter((player) => !player.folded);
  const totalPot = players.reduce((sum, player) => sum + player.contributed, 0);
  if (contenders.length === 1) {
    payouts[contenders[0].id] = totalPot;
    return { payouts, showdownIds: [], showdownWinners: [] };
  }

  const scores = new Map(contenders.map((player) => [player.id, bestHand([...player.hole, ...board]).score]));
  const levels = [...new Set(players.map((player) => player.contributed).filter((value) => value > 0))].sort((a, b) => a - b);
  let previous = 0;
  for (const level of levels) {
    const contributors = players.filter((player) => player.contributed >= level);
    const amount = (level - previous) * contributors.length;
    const eligible = contenders.filter((player) => player.contributed >= level);
    const best = Math.max(...eligible.map((player) => scores.get(player.id)));
    const winners = eligible.filter((player) => scores.get(player.id) === best);
    for (const winner of winners) payouts[winner.id] += amount / winners.length;
    previous = level;
  }

  const topScore = Math.max(...contenders.map((player) => scores.get(player.id)));
  const showdownWinners = contenders.filter((player) => scores.get(player.id) === topScore).map((player) => player.id);
  return { payouts, showdownIds: contenders.map((player) => player.id), showdownWinners };
}

function createAggregate(styleKey) {
  return {
    styleKey,
    label: PROFILE_LABELS[styleKey],
    hands: 0,
    vpip: 0,
    pfr: 0,
    bets: 0,
    raises: 0,
    calls: 0,
    showdowns: 0,
    showdownWins: 0,
    netBb: 0,
    clusterCount: 0,
    clusterNetSquared: 0,
    clusterNetHands: 0,
    clusterHandsSquared: 0,
  };
}

function playHand(handIndex, stackBb, randoms, equityIterations, aggregates) {
  const deck = shuffledDeck(randoms.deal);
  const lineup = sampleAiLineup(PLAYER_COUNT, randoms.lineup);
  const dealer = handIndex % PLAYER_COUNT;
  const players = lineup.map(({ styleKey }, id) => ({
    id,
    styleKey,
    hole: [deck[id * 2], deck[id * 2 + 1]],
    stack: stackBb,
    bet: 0,
    contributed: 0,
    folded: false,
    vpip: false,
    pfr: false,
    bets: 0,
    raises: 0,
    calls: 0,
    hasActed: false,
    raiseLocked: false,
  }));
  const board = deck.slice(12, 17);
  const smallBlindId = (dealer + 1) % PLAYER_COUNT;
  const bigBlindId = (dealer + 2) % PLAYER_COUNT;
  post(players[smallBlindId], SMALL_BLIND);
  post(players[bigBlindId], BIG_BLIND);
  const state = {
    players,
    board: [],
    dealer,
    stackBb,
    equityIterations,
    equityRandom: randoms.equity,
    policyRandom: randoms.policy,
    equityCache: new Map(),
    lineAggressor: null,
  };

  bettingRound(state, "preflop", (dealer + 3) % PLAYER_COUNT);
  for (const [street, count] of [["flop", 3], ["turn", 4], ["river", 5]]) {
    if (players.filter((player) => !player.folded).length <= 1) break;
    if (players.filter((player) => !player.folded && player.stack > 0).length <= 1) break;
    for (const player of players) player.bet = 0;
    state.board = board.slice(0, count);
    bettingRound(state, street, (dealer + 1) % PLAYER_COUNT);
  }

  const settlement = settle(players, board);
  const winnerShare = settlement.showdownWinners.length > 0 ? 1 / settlement.showdownWinners.length : 0;
  const clusters = Object.fromEntries(PROFILE_KEYS.map((styleKey) => [styleKey, { hands: 0, netBb: 0 }]));
  for (const player of players) {
    const aggregate = aggregates[player.styleKey];
    aggregate.hands += 1;
    aggregate.vpip += Number(player.vpip);
    aggregate.pfr += Number(player.pfr);
    aggregate.bets += player.bets;
    aggregate.raises += player.raises;
    aggregate.calls += player.calls;
    const netBb = settlement.payouts[player.id] - player.contributed;
    aggregate.netBb += netBb;
    clusters[player.styleKey].hands += 1;
    clusters[player.styleKey].netBb += netBb;
    if (settlement.showdownIds.includes(player.id)) aggregate.showdowns += 1;
    if (settlement.showdownWinners.includes(player.id)) aggregate.showdownWins += winnerShare;
  }
  for (const styleKey of PROFILE_KEYS) {
    const aggregate = aggregates[styleKey];
    const cluster = clusters[styleKey];
    aggregate.clusterCount += 1;
    aggregate.clusterNetSquared += cluster.netBb ** 2;
    aggregate.clusterNetHands += cluster.netBb * cluster.hands;
    aggregate.clusterHandsSquared += cluster.hands ** 2;
  }
}

export function runSimulation(options = {}) {
  const hands = Number(options.hands ?? 20_000);
  const stackBb = Number(options.stackBb ?? 100);
  const seed = String(options.seed ?? "rangecraft-2026");
  const equityIterations = Number(options.equityIterations ?? 4);
  if (!Number.isInteger(hands) || hands < 1) throw new Error("hands 必须是大于 0 的整数");
  if (!Number.isFinite(stackBb) || stackBb < 10) throw new Error("stack-bb 必须至少为 10");
  if (!Number.isInteger(equityIterations) || equityIterations < 1) throw new Error("equity-iterations 必须是大于 0 的整数");

  const randoms = {
    deal: seededRandom(`${seed}:deal`),
    lineup: seededRandom(`${seed}:lineup`),
    equity: seededRandom(`${seed}:equity`),
    policy: seededRandom(`${seed}:policy`),
  };
  const aggregates = Object.fromEntries(PROFILE_KEYS.map((styleKey) => [styleKey, createAggregate(styleKey)]));
  const startedAt = performance.now();
  for (let hand = 0; hand < hands; hand += 1) playHand(hand, stackBb, randoms, equityIterations, aggregates);
  const elapsedMs = performance.now() - startedAt;
  const results = PROFILE_KEYS.map((styleKey) => {
    const value = aggregates[styleKey];
    const meanNetBb = value.hands ? value.netBb / value.hands : 0;
    const clusterInfluenceSquared = Math.max(
      0,
      value.clusterNetSquared
        - 2 * meanNetBb * value.clusterNetHands
        + meanNetBb ** 2 * value.clusterHandsSquared,
    );
    const clusterCorrection = value.clusterCount > 1 ? value.clusterCount / (value.clusterCount - 1) : 0;
    const netBbPer100StandardError = value.hands
      ? Math.sqrt(clusterCorrection * clusterInfluenceSquared) / value.hands * 100
      : 0;
    return {
      styleKey,
      label: value.label,
      hands: value.hands,
      vpip: value.hands ? value.vpip / value.hands : 0,
      pfr: value.hands ? value.pfr / value.hands : 0,
      aggression: value.calls ? (value.bets + value.raises) / value.calls : value.bets + value.raises,
      showdownWinRate: value.showdowns ? value.showdownWins / value.showdowns : 0,
      showdowns: value.showdowns,
      netBb: value.netBb,
      netBbPer100: value.hands ? value.netBb / value.hands * 100 : 0,
      netBbPer100Ci95: netBbPer100StandardError * 1.96,
    };
  });
  return {
    config: { hands, playerHands: hands * PLAYER_COUNT, seed, stackBb, players: PLAYER_COUNT, equityIterations },
    elapsedMs,
    totalNetBb: results.reduce((sum, result) => sum + result.netBb, 0),
    results,
  };
}

function percent(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function signed(value, digits = 2) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}`;
}

export function formatReport(report) {
  const rows = report.results.map((result) => ({
    风格: `${result.label} (${result.styleKey})`,
    Hands: String(result.hands),
    VPIP: percent(result.vpip),
    PFR: percent(result.pfr),
    Agg: result.aggression.toFixed(2),
    "W$SD": percent(result.showdownWinRate),
    "Net BB": signed(result.netBb, 1),
    "bb/100": signed(result.netBbPer100),
    "约95% CI": `±${result.netBbPer100Ci95.toFixed(2)}`,
  }));
  const headers = Object.keys(rows[0]);
  const widths = Object.fromEntries(headers.map((header) => [header, Math.max(header.length, ...rows.map((row) => row[header].length))]));
  const line = (row) => headers.map((header) => row[header].padEnd(widths[header])).join("  ");
  return [
    "RangeCraft AI 自博弈基准",
    `6-max · ${report.config.hands.toLocaleString("zh-CN")} 手 · seed=${report.config.seed} · ${report.config.stackBb}BB · 权益 MC×${report.config.equityIterations} · ${(report.elapsedMs / 1000).toFixed(2)}s`,
    "每手使用种子随机阵容；同风格可重复出现，统计按风格汇总。",
    "",
    line(Object.fromEntries(headers.map((header) => [header, header]))),
    line(Object.fromEntries(headers.map((header) => [header, "-".repeat(widths[header])]))),
    ...rows.map(line),
    "",
    `零和校验：${signed(report.totalNetBb, 6)} BB`,
    "Agg=(bet+raise)/call；W$SD=进入摊牌后的主池胜率（平分按份额计）；CI 按每个牌桌手聚类近似。",
    `注意：这是共享牌力/策略核的快速回归，不是 CFR/GTO 求解器；权益敏感节点为吞吐量使用 ${report.config.equityIterations} 次采样，低于界面电脑的 90/120 次和实时教练的 220/360 次。`,
  ].join("\n");
}

function parseArguments(argv) {
  const options = { hands: 20_000, seed: "rangecraft-2026", stackBb: 100, equityIterations: 4, json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--json") options.json = true;
    else if (argument === "--help" || argument === "-h") options.help = true;
    else if (argument === "--hands") options.hands = Number(argv[++index]);
    else if (argument.startsWith("--hands=")) options.hands = Number(argument.slice(8));
    else if (argument === "--seed") options.seed = argv[++index];
    else if (argument.startsWith("--seed=")) options.seed = argument.slice(7);
    else if (argument === "--stack-bb") options.stackBb = Number(argv[++index]);
    else if (argument.startsWith("--stack-bb=")) options.stackBb = Number(argument.slice(11));
    else if (argument === "--equity-iterations") options.equityIterations = Number(argv[++index]);
    else if (argument.startsWith("--equity-iterations=")) options.equityIterations = Number(argument.slice(20));
    else throw new Error(`未知参数：${argument}`);
  }
  return options;
}

function help() {
  return [
    "用法：node --experimental-strip-types scripts/ai-self-play.mjs [选项]",
    "",
    "  --hands N       模拟手数（默认 20000）",
    "  --seed VALUE    可重复运行的随机种子",
    "  --stack-bb N    每手起始有效筹码（默认 100）",
    "  --equity-iterations N  权益敏感节点采样数（默认 4；界面对局为 70/82）",
    "  --json           输出机器可读 JSON",
    "  -h, --help       显示帮助",
  ].join("\n");
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === invokedPath) {
  try {
    const options = parseArguments(process.argv.slice(2));
    if (options.help) console.log(help());
    else {
      const report = runSimulation(options);
      console.log(options.json ? JSON.stringify(report, null, 2) : formatReport(report));
    }
  } catch (error) {
    console.error(`AI 自博弈失败：${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
