import type { OnlinePublicRoomState } from "./online-poker";

/**
 * The table UI talks in authenticated, revisioned commands rather than
 * sockets. The server derives the player identity from SIWC; callers never
 * submit a user or player ID. A polling adapter and a future WebSocket adapter
 * can share this contract.
 */
export type PokerCommand =
  | { type: "ready"; roomId: string; ready: boolean; requestId: string; expectedRevision: number }
  | { type: "start"; roomId: string; requestId: string; expectedRevision: number }
  | {
      type: "act";
      roomId: string;
      handId: string;
      action: "fold" | "check" | "call" | "raise";
      raiseTo?: number;
      requestId: string;
      expectedRevision: number;
    }
  | { type: "show"; roomId: string; handId: string; show: boolean; requestId: string; expectedRevision: number }
  | { type: "leave"; roomId: string; requestId: string; expectedRevision: number };

export type TableSnapshot = {
  tableId: string;
  handId: string | null;
  revision: number;
  payload: OnlinePublicRoomState;
};

export interface PokerTransport {
  connect(): Promise<void>;
  send(command: PokerCommand): Promise<void>;
  subscribe(listener: (snapshot: TableSnapshot) => void): () => void;
  disconnect(): Promise<void>;
}
