import {
  pokerDecisionStackContext,
  type PokerDecisionStackContext,
} from "./poker-policy.ts";

export type PokerStackPlayer = {
  id: number;
  stack: number;
  bet: number;
  contributed: number;
  folded: boolean;
};

export type ResolvedPokerDecisionStacks<T extends PokerStackPlayer> = {
  decision: PokerDecisionStackContext;
  contestable: PokerDecisionStackContext;
  opponent: T | null;
  startingDepth: number;
  maxContestableTarget: number;
};

/**
 * Resolves the stack dimensions needed by one decision without reading hidden
 * cards. The latest aggressor selects the strategy node, while the deepest
 * live opponent independently selects the useful raise-to ceiling.
 */
export function resolvePokerDecisionStacks<T extends PokerStackPlayer>({
  player,
  players,
  highestBet,
  lastAggressorId,
}: {
  player: T;
  players: readonly T[];
  highestBet: number;
  lastAggressorId?: number | null;
}): ResolvedPokerDecisionStacks<T> {
  const liveOpponents = players.filter((candidate) => (
    candidate.id !== player.id && !candidate.folded
  ));
  const opponents = liveOpponents.map((candidate) => ({
    id: candidate.id,
    stack: candidate.stack,
    bet: candidate.bet,
  }));
  const toCall = Math.max(0, highestBet - player.bet);
  const latestAggressor = toCall > 0
    && lastAggressorId !== undefined
    && lastAggressorId !== null
    && lastAggressorId !== player.id
    && liveOpponents.some((candidate) => candidate.id === lastAggressorId)
    ? lastAggressorId
    : undefined;
  // `null` explicitly means the pot is still unraised. Several limpers and the
  // BB may all have the same wager; choosing the first seat as an "aggressor"
  // would make effective depth depend on array order. In that node the deepest
  // live opponent defines the contestable stack. `undefined` remains the
  // compatibility path for callers that genuinely do not know the aggressor.
  const highestBettor = toCall > 0 && latestAggressor === undefined && lastAggressorId !== null
    ? [...liveOpponents]
        .filter((candidate) => candidate.bet > player.bet)
        .sort((left, right) => right.bet - left.bet)[0]?.id
    : undefined;
  const decision = pokerDecisionStackContext(
    player.stack,
    player.bet,
    opponents,
    latestAggressor ?? highestBettor,
  );
  const contestable = pokerDecisionStackContext(player.stack, player.bet, opponents);
  const opponent = decision.opponentId === undefined
    ? null
    : liveOpponents.find((candidate) => candidate.id === decision.opponentId) ?? null;
  const playerStartingStack = player.stack + player.contributed;
  const opponentStartingStack = opponent
    ? opponent.stack + opponent.contributed
    : playerStartingStack;
  return {
    decision,
    contestable,
    opponent,
    startingDepth: Math.min(playerStartingStack, opponentStartingStack),
    maxContestableTarget: player.bet + contestable.effectiveStack,
  };
}

export type CashGameBankrollCarry = {
  stacks: number[];
  cashInvested: number[];
  reboughtIds: number[];
};

/** Carries a cash-game table into the next hand and funds only sub-1-BB seats. */
export function resolveNextCashGameBankrolls({
  stacks,
  cashInvested,
  buyInStack,
  bigBlind,
}: {
  stacks: readonly number[];
  cashInvested: readonly (number | undefined)[];
  buyInStack: number;
  bigBlind: number;
}): CashGameBankrollCarry {
  const reboughtIds: number[] = [];
  const nextStacks = stacks.map((stack, playerId) => {
    if (stack >= bigBlind) return stack;
    reboughtIds.push(playerId);
    return buyInStack;
  });
  const nextCashInvested = stacks.map((stack, playerId) => (
    (cashInvested[playerId] ?? buyInStack)
    + (stack < bigBlind ? buyInStack - stack : 0)
  ));
  return { stacks: nextStacks, cashInvested: nextCashInvested, reboughtIds };
}
