export type PokerRunStreet = "preflop" | "flop" | "turn" | "river";
export type PokerRunMode = "per_hand" | "session" | "endless";

export type PokerRunDecisionStats = {
  scoreTotal: number;
  count: number;
  byStreet: Record<PokerRunStreet, { scoreTotal: number; count: number }>;
};

export const POKER_RUN_DECISION_HISTORY_LIMIT = 400;
export const POKER_RUN_HAND_HISTORY_LIMIT = 200;

export function pokerRunCanStartNextHand(
  mode: PokerRunMode,
  runEnded: boolean,
  fixedSessionComplete: boolean,
) {
  return !runEnded && !(mode === "session" && fixedSessionComplete);
}

export function createPokerRunDecisionStats(): PokerRunDecisionStats {
  return {
    scoreTotal: 0,
    count: 0,
    byStreet: {
      preflop: { scoreTotal: 0, count: 0 },
      flop: { scoreTotal: 0, count: 0 },
      turn: { scoreTotal: 0, count: 0 },
      river: { scoreTotal: 0, count: 0 },
    },
  };
}

export function recordPokerRunDecision(
  stats: PokerRunDecisionStats,
  street: PokerRunStreet,
  score: number,
): PokerRunDecisionStats {
  const streetStats = stats.byStreet[street];
  return {
    scoreTotal: stats.scoreTotal + score,
    count: stats.count + 1,
    byStreet: {
      ...stats.byStreet,
      [street]: {
        scoreTotal: streetStats.scoreTotal + score,
        count: streetStats.count + 1,
      },
    },
  };
}

export function pokerRunBbPer100(netChips: number, bigBlind: number, completedHands: number) {
  if (bigBlind <= 0 || completedHands <= 0) return 0;
  return netChips / bigBlind / completedHands * 100;
}

export function upsertPokerRunHand<T extends { hand: number }>(
  items: T[],
  entry: T,
  limit = POKER_RUN_HAND_HISTORY_LIMIT,
) {
  return [...items.filter((item) => item.hand !== entry.hand), entry]
    .sort((left, right) => left.hand - right.hand)
    .slice(-Math.max(1, limit));
}
