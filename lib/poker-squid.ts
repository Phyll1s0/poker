export type SquidLedgerPlayer = {
  id: number;
  name: string;
  stack: number;
};

export function squidMultiplier(count: number) {
  if (count >= 7) return 4;
  if (count >= 5) return 3;
  if (count >= 3) return 2;
  return 1;
}

export function settleSquidRound<T extends SquidLedgerPlayer>(
  players: T[],
  counts: number[],
  bounty: number,
  invested: number[],
) {
  const payers = players.filter((player) => (counts[player.id] ?? 0) === 0);
  const holders = players.filter((player) => (counts[player.id] ?? 0) > 0);
  const holderUnits = new Map(holders.map((holder) => [
    holder.id,
    counts[holder.id] * squidMultiplier(counts[holder.id]),
  ]));
  const obligationPerPayer = payers.length
    ? [...holderUnits.values()].reduce((sum, units) => sum + units * bounty, 0)
    : 0;
  const payerIds = new Set(payers.map((payer) => payer.id));
  const cashInvested = [...invested];
  let externalFunding = 0;

  const nextPlayers = players.map((player) => {
    if (payerIds.has(player.id)) {
      const funding = Math.max(0, obligationPerPayer - player.stack);
      externalFunding += funding;
      cashInvested[player.id] = (cashInvested[player.id] ?? 0) + funding;
      return { ...player, stack: player.stack + funding - obligationPerPayer };
    }
    const payout = (holderUnits.get(player.id) ?? 0) * bounty * payers.length;
    return { ...player, stack: player.stack + payout };
  });

  return {
    players: nextPlayers,
    cashInvested,
    payers,
    holders,
    holderUnits,
    obligationPerPayer,
    externalFunding,
  };
}
