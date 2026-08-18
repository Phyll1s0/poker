/**
 * The table UI talks in commands, not sockets. A future online adapter can
 * implement this contract without replacing the local poker engine or UI.
 */
export type PokerCommand =
  | { type: "join"; tableId: string; playerId: string }
  | { type: "act"; handId: string; action: "fold" | "check" | "call" | "raise"; amount?: number }
  | { type: "ready"; tableId: string };

export type TableSnapshot = {
  tableId: string;
  handId: string;
  revision: number;
  payload: unknown;
};

export interface PokerTransport {
  connect(): Promise<void>;
  send(command: PokerCommand): Promise<void>;
  subscribe(listener: (snapshot: TableSnapshot) => void): () => void;
  disconnect(): Promise<void>;
}
