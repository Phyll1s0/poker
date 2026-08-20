export type PokerSettlementPlayerId = string | number;

export type PokerShowdownParticipant<PlayerId extends PokerSettlementPlayerId = number> = {
  /** Seat/player identity. Participants must be supplied in clockwise table order. */
  id: PlayerId;
  /** Total chips committed during the hand, including folded dead money. */
  contributed: number;
  folded: boolean;
  /** Larger scores win. Folded players do not need a score. */
  score?: number;
};

export type PokerSettlementEntry<PlayerId extends PokerSettlementPlayerId = number> = {
  playerId: PlayerId;
  amount: number;
};

export type PokerSettlementLayer<PlayerId extends PokerSettlementPlayerId = number> = {
  /** Contribution cap represented by this layer. */
  cap: number;
  amount: number;
  kind: "pot" | "return";
  contributorIds: PlayerId[];
  eligibleIds: PlayerId[];
  winnerIds: PlayerId[];
  returnPlayerId: PlayerId | null;
};

export type PokerShowdownSettlement<PlayerId extends PokerSettlementPlayerId = number> = {
  /** All chips committed by all participants. */
  totalCommitted: number;
  /** Contested chips only. Uncalled chips are deliberately excluded. */
  totalPot: number;
  payouts: PokerSettlementEntry<PlayerId>[];
  /** Uncalled chips returned to their owner; these are not winnings. */
  returns: PokerSettlementEntry<PlayerId>[];
  /** Every player receiving a contested-pot payout, including side-pot winners. */
  winnerIds: PlayerId[];
  /** Winners of the first contested layer only. */
  mainPotWinnerIds: PlayerId[];
  layers: PokerSettlementLayer<PlayerId>[];
};

export type SettlePokerShowdownInput<PlayerId extends PokerSettlementPlayerId = number> = {
  /** Clockwise seat order; it also determines deterministic result ordering. */
  players: readonly PokerShowdownParticipant<PlayerId>[];
  /** Odd chips go to the first tied winner clockwise after the dealer. */
  dealerId: PlayerId;
};

function addAmount<PlayerId extends PokerSettlementPlayerId>(
  target: Map<PlayerId, number>,
  playerId: PlayerId,
  amount: number,
) {
  if (amount <= 0) return;
  target.set(playerId, (target.get(playerId) ?? 0) + amount);
}

function orderedEntries<PlayerId extends PokerSettlementPlayerId>(
  tableOrder: readonly PlayerId[],
  amounts: ReadonlyMap<PlayerId, number>,
): PokerSettlementEntry<PlayerId>[] {
  return tableOrder.flatMap((playerId) => {
    const amount = amounts.get(playerId) ?? 0;
    return amount > 0 ? [{ playerId, amount }] : [];
  });
}

function clockwiseAfterDealer<PlayerId extends PokerSettlementPlayerId>(
  tableOrder: readonly PlayerId[],
  dealerId: PlayerId,
) {
  const dealerIndex = tableOrder.indexOf(dealerId);
  return Array.from(
    { length: tableOrder.length },
    (_, offset) => tableOrder[(dealerIndex + offset + 1) % tableOrder.length],
  );
}

function validateInput<PlayerId extends PokerSettlementPlayerId>(
  players: readonly PokerShowdownParticipant<PlayerId>[],
  dealerId: PlayerId,
) {
  if (!players.length) throw new RangeError("摊牌结算至少需要一个玩家");
  const ids = new Set<PlayerId>();
  players.forEach((player) => {
    if (ids.has(player.id)) throw new RangeError("摊牌结算存在重复玩家");
    ids.add(player.id);
    if (!Number.isSafeInteger(player.contributed) || player.contributed < 0) {
      throw new RangeError("玩家投入必须是非负安全整数");
    }
    if (!player.folded && player.score !== undefined && !Number.isFinite(player.score)) {
      throw new RangeError("未弃牌玩家的牌力分数必须是有限数值");
    }
  });
  if (!ids.has(dealerId)) throw new RangeError("庄家必须是本手参与者");
}

/**
 * Settles main pots, side pots and uncalled excess without mutating its input.
 *
 * The caller evaluates hands and supplies comparable numeric scores. This keeps
 * pot construction independent from the card/evaluator representation used by
 * the solo table. A one-contributor layer is always a return, never a payout.
 */
export function settlePokerShowdown<PlayerId extends PokerSettlementPlayerId = number>({
  players,
  dealerId,
}: SettlePokerShowdownInput<PlayerId>): PokerShowdownSettlement<PlayerId> {
  validateInput(players, dealerId);

  const tableOrder = players.map((player) => player.id);
  const oddChipOrder = clockwiseAfterDealer(tableOrder, dealerId);
  const levels = [...new Set(players
    .filter((player) => player.contributed > 0)
    .map((player) => player.contributed))]
    .sort((left, right) => left - right);
  const payouts = new Map<PlayerId, number>();
  const returns = new Map<PlayerId, number>();
  const layers: PokerSettlementLayer<PlayerId>[] = [];
  let previousLevel = 0;
  let mainPotWinnerIds: PlayerId[] = [];

  for (const level of levels) {
    const contributors = players.filter((player) => player.contributed >= level);
    const layerAmount = (level - previousLevel) * contributors.length;
    previousLevel = level;
    if (layerAmount <= 0) continue;

    if (contributors.length === 1) {
      const returnPlayerId = contributors[0].id;
      addAmount(returns, returnPlayerId, layerAmount);
      layers.push({
        cap: level,
        amount: layerAmount,
        kind: "return",
        contributorIds: [returnPlayerId],
        eligibleIds: [],
        winnerIds: [],
        returnPlayerId,
      });
      continue;
    }

    const directlyEligible = contributors.filter((player) => !player.folded);
    // This fallback mirrors the multiplayer engine. It only matters for a
    // historical orphaned layer (for example, forced departures after betting):
    // folded hands remain ineligible and their chips stay dead money.
    const eligible = directlyEligible.length
      ? directlyEligible
      : players.filter((player) => !player.folded);
    if (!eligible.length) throw new Error("底池没有仍持牌的玩家");
    eligible.forEach((player) => {
      if (player.score === undefined || !Number.isFinite(player.score)) {
        throw new RangeError("所有可争夺底池的玩家都必须提供牌力分数");
      }
    });

    const topScore = Math.max(...eligible.map((player) => player.score!));
    const winnerSet = new Set(eligible
      .filter((player) => player.score === topScore)
      .map((player) => player.id));
    const orderedWinners = oddChipOrder.filter((playerId) => winnerSet.has(playerId));
    if (!mainPotWinnerIds.length) mainPotWinnerIds = [...orderedWinners];

    const share = Math.floor(layerAmount / orderedWinners.length);
    let remainder = layerAmount - share * orderedWinners.length;
    orderedWinners.forEach((playerId) => {
      addAmount(payouts, playerId, share + (remainder > 0 ? 1 : 0));
      remainder = Math.max(0, remainder - 1);
    });
    layers.push({
      cap: level,
      amount: layerAmount,
      kind: "pot",
      contributorIds: contributors.map((player) => player.id),
      eligibleIds: eligible.map((player) => player.id),
      winnerIds: [...orderedWinners],
      returnPlayerId: null,
    });
  }

  const payoutEntries = orderedEntries(tableOrder, payouts);
  const returnEntries = orderedEntries(tableOrder, returns);
  const totalCommitted = players.reduce((sum, player) => sum + player.contributed, 0);
  const totalPot = payoutEntries.reduce((sum, entry) => sum + entry.amount, 0);
  const returned = returnEntries.reduce((sum, entry) => sum + entry.amount, 0);
  if (totalPot + returned !== totalCommitted) {
    throw new Error("结算未满足筹码守恒");
  }

  return {
    totalCommitted,
    totalPot,
    payouts: payoutEntries,
    returns: returnEntries,
    winnerIds: payoutEntries.map((entry) => entry.playerId),
    mainPotWinnerIds,
    layers,
  };
}
