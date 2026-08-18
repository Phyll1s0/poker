export type StrategyAction = "fold" | "check" | "call" | "raise";
export type StrategyStreet = "preflop" | "flop" | "turn" | "river";

export type StrategyCard = {
  rank: number;
  suit: "spades" | "hearts" | "diamonds" | "clubs";
};

export type StrategySeat = {
  id: string;
  position: string;
  stackBb: number;
  streetBetBb: number;
  folded: boolean;
};

/** A serializable public-information node that can be sent to a strategy database or solver service. */
export type StrategySpot = {
  schemaVersion: 1;
  format: "cash-6max-nlhe";
  street: StrategyStreet;
  heroId: string;
  heroCards: StrategyCard[];
  board: StrategyCard[];
  potBb: number;
  toCallBb: number;
  minimumRaiseToBb: number;
  seats: StrategySeat[];
  actionHistory: Array<{ playerId: string; action: StrategyAction; amountBb?: number }>;
};

export type MixedStrategy = {
  source: "local-approximation" | "precomputed-gto" | "remote-solver";
  nodeId?: string;
  actions: Array<{
    action: StrategyAction;
    frequency: number;
    raiseToBb?: number;
    evBb?: number;
  }>;
};

/** Boundary for replacing the local heuristic with a precomputed GTO tree or remote solver. */
export interface PokerStrategyProvider {
  resolve(spot: StrategySpot, signal?: AbortSignal): Promise<MixedStrategy>;
}
