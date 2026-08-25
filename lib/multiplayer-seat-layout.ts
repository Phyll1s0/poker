import { ONLINE_MAX_PLAYERS, ONLINE_MIN_PLAYERS } from "./online-poker.ts";

/**
 * Ten fixed points around the rail. The viewer is always visual seat zero;
 * smaller tables select a symmetric subset without changing physical seats as
 * players temporarily leave or return.
 */
export const MULTIPLAYER_VISUAL_SEATS_BY_TABLE_SIZE: Readonly<Record<number, readonly number[]>> = {
  2: [0, 5],
  3: [0, 3, 7],
  4: [0, 2, 5, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 4, 5, 6, 8],
  7: [0, 1, 3, 4, 6, 7, 9],
  8: [0, 1, 3, 4, 5, 6, 7, 9],
  9: [0, 1, 2, 3, 4, 6, 7, 8, 9],
  10: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
};

export function normalizedMultiplayerTableSize(tableSize: number) {
  if (!Number.isInteger(tableSize)) return ONLINE_MAX_PLAYERS;
  return Math.max(ONLINE_MIN_PLAYERS, Math.min(ONLINE_MAX_PLAYERS, tableSize));
}

export function multiplayerRelativeSeat(
  seat: number,
  viewerSeat: number,
  tableSize: number,
) {
  const size = normalizedMultiplayerTableSize(tableSize);
  return ((seat - viewerSeat) % size + size) % size;
}

export function multiplayerVisualSeat(
  seat: number,
  viewerSeat: number,
  tableSize: number,
) {
  const size = normalizedMultiplayerTableSize(tableSize);
  const relativeSeat = multiplayerRelativeSeat(seat, viewerSeat, size);
  return MULTIPLAYER_VISUAL_SEATS_BY_TABLE_SIZE[size]?.[relativeSeat] ?? null;
}
