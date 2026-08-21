import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  ONLINE_BIG_BLIND,
  ONLINE_COMMAND_RECEIPT_LIMIT,
  ONLINE_DEFAULT_ACTION_TIME_MS,
  ONLINE_DEFAULT_AI_ASSIST_LIMIT,
  ONLINE_HAND_HISTORY_LIMIT,
  ONLINE_NEXT_HAND_DELAY_MS,
  ONLINE_PRIVATE_PEEK_LIMIT,
  ONLINE_REVEALED_HAND_HOLD_MS,
  ONLINE_SHOW_DECISION_TIME_MS,
  ONLINE_STARTING_STACK,
  applyOnlinePokerCommand,
  bestOnlineHand,
  createOnlineRoom,
  cryptoRandomIndex,
  makeOnlineDeck,
  projectRoomState,
  setOnlinePlayerConnection,
  shuffleOnlineDeck,
} from "../lib/online-poker.ts";

const actors = Array.from({ length: 7 }, (_, index) => ({
  accountId: `user-${index}`,
  displayName: `玩家 ${index}`,
}));

function deterministicOptions() {
  let hand = 0;
  return {
    randomIndex: (maxExclusive) => maxExclusive - 1,
    makeHandId: () => `hand-${++hand}`,
    now: () => 1_000_000,
  };
}

let commandSequence = 0;

function command(room, actor, payload, options, commandId = `command-${++commandSequence}`) {
  return applyOnlinePokerCommand(room, actor, {
    ...payload,
    commandId,
    expectedRevision: room.revision,
  }, options);
}

function accepted(result) {
  assert.equal(result.ok, true, result.ok ? undefined : `${result.error.code}: ${result.error.message}`);
  return result.state;
}

function rejected(result, code) {
  assert.equal(result.ok, false);
  assert.equal(result.error.code, code);
  return result.state;
}

function joinPlayers(room, count, options) {
  let next = room;
  for (let index = 1; index < count; index += 1) {
    next = accepted(command(next, actors[index], { type: "join" }, options));
  }
  return next;
}

function startRoom(count, { stacks, maxPlayers = count, roomOptions = {} } = {}) {
  const options = deterministicOptions();
  let room = createOnlineRoom({ roomId: `room-${commandSequence}`, owner: actors[0], maxPlayers, ...roomOptions });
  room = joinPlayers(room, count, options);
  if (stacks) {
    room = {
      ...room,
      seats: room.seats.map((seat, index) => ({ ...seat, stack: stacks[index] })),
    };
  }
  for (let index = 0; index < count; index += 1) {
    room = accepted(command(room, actors[index], { type: "ready", ready: true }, options));
  }
  room = accepted(command(room, actors[0], { type: "start" }, options));
  return { room, options };
}

function act(room, actor, action, options, raiseTo) {
  assert.ok(room.hand);
  return command(room, actor, {
    type: "act",
    handId: room.hand.id,
    action,
    ...(raiseTo === undefined ? {} : { raiseTo }),
  }, options);
}

function foldUntilSettlement(room, options) {
  let next = room;
  let decisions = 0;
  while (next.phase === "playing") {
    assert.notEqual(next.hand?.currentSeat, null, "a live fold line must have an actor");
    next = accepted(act(next, actors[next.hand.currentSeat], "fold", options));
    decisions += 1;
    assert.ok(decisions <= 6, "an uncontested fold line must settle within the table size");
  }
  assert.equal(next.phase, "between_hands");
  assert.ok(next.hand?.result);
  return next;
}

function card(rank, suit) {
  return { rank, suit };
}

test("bestOnlineHand returns exactly five cards and keeps a board-playing tie on the board", () => {
  const board = [
    card(14, "♠"),
    card(13, "♥"),
    card(12, "♦"),
    card(11, "♣"),
    card(10, "♠"),
  ];
  const boardHand = bestOnlineHand([...board, card(3, "♥"), card(2, "♦")]);
  assert.equal(boardHand.name, "顺子");
  assert.equal(boardHand.cards.length, 5);
  assert.deepEqual(boardHand.cards, board, "an equal hole-card substitution must not obscure that the board plays");

  const fullHouse = bestOnlineHand([
    card(14, "♠"),
    card(14, "♥"),
    card(13, "♠"),
    card(13, "♥"),
    card(2, "♣"),
    card(14, "♦"),
    card(12, "♣"),
  ]);
  assert.equal(fullHouse.name, "葫芦");
  assert.deepEqual(
    fullHouse.cards.map(({ rank }) => rank).sort((left, right) => right - left),
    [14, 14, 14, 13, 13],
  );
});

test("room enforces a 2-6 seat capacity and lobby readiness", () => {
  assert.throws(() => createOnlineRoom({ roomId: "bad", owner: actors[0], maxPlayers: 1 }), /2 到 6/);
  assert.throws(() => createOnlineRoom({ roomId: "bad", owner: actors[0], maxPlayers: 7 }), /2 到 6/);

  const options = deterministicOptions();
  let room = createOnlineRoom({ roomId: "six-max", owner: actors[0], maxPlayers: 6 });
  room = joinPlayers(room, 6, options);
  assert.deepEqual(room.seats.map((seat) => seat.seat), [0, 1, 2, 3, 4, 5]);
  const full = command(room, actors[6], { type: "join" }, options);
  rejected(full, "ROOM_FULL");
  assert.equal(full.state, room);

  const earlyStart = command(room, actors[0], { type: "start" }, options);
  rejected(earlyStart, "PLAYERS_NOT_READY");
  const nonOwnerStart = command(room, actors[1], { type: "start" }, options);
  rejected(nonOwnerStart, "NOT_ROOM_OWNER");
});

test("lobby leave releases the seat, transfers ownership, and closes an empty room", () => {
  const options = deterministicOptions();
  let room = createOnlineRoom({ roomId: "leave-lobby", owner: actors[0], maxPlayers: 3 });
  room = accepted(command(room, actors[1], { type: "join" }, options));
  room = accepted(command(room, actors[0], { type: "leave" }, options));

  assert.equal(room.phase, "lobby");
  assert.equal(room.ownerAccountId, actors[1].accountId);
  assert.deepEqual(room.seats.map((seat) => [seat.accountId, seat.seat]), [[actors[1].accountId, 1]]);

  room = accepted(command(room, actors[2], { type: "join" }, options));
  assert.deepEqual(room.seats.map((seat) => [seat.accountId, seat.seat]), [
    [actors[2].accountId, 0],
    [actors[1].accountId, 1],
  ]);

  let solo = createOnlineRoom({ roomId: "leave-last", owner: actors[0], maxPlayers: 2 });
  solo = accepted(command(solo, actors[0], { type: "leave" }, options));
  assert.equal(solo.phase, "closed");
  assert.equal(solo.seats.length, 0);
  assert.equal(solo.hand, null);
});

test("a current non-all-in player leaves by folding and is removed after the hand", () => {
  const { room: started, options } = startRoom(2, { maxPlayers: 3 });
  let room = accepted(command(started, actors[0], { type: "leave" }, options));

  assert.equal(room.phase, "between_hands");
  assert.deepEqual(room.hand.recentActions, [{
    seq: 1,
    seat: 0,
    street: "preflop",
    action: "fold",
    amount: 0,
    toAmount: 5,
    raiseTo: null,
    potAfter: 15,
    stackAfter: 995,
    community: [],
    timedOut: false,
    source: "leave",
    occurredAt: 1_000_000,
  }]);
  assert.equal(room.hand.pendingShowSeat, 1);
  assert.equal(room.hand.players.find((player) => player.seat === 0).folded, true);
  assert.equal(room.seats.some((seat) => seat.seat === 0), false, "the departed seat is released after settlement");
  assert.equal(room.ownerAccountId, actors[1].accountId, "ownership transfers before the pending seat is finalized");

  room = accepted(command(room, actors[1], {
    type: "show",
    handId: room.hand.id,
    show: false,
  }, options));
  assert.equal(room.phase, "between_hands", "choosing muck does not skip the shared post-hand wait");
  const completedHandId = room.hand.id;
  const nextHandAt = room.hand.nextHandAt;
  options.now = () => nextHandAt;
  room = accepted(command(room, actors[1], { type: "timeout", handId: completedHandId }, options));
  assert.equal(room.phase, "lobby", "one remaining player returns to a joinable lobby when the shared wait ends");
  assert.ok(room.hand?.result, "the completed result remains visible until another player joins");
  assert.deepEqual(room.seats.map((seat) => seat.accountId), [actors[1].accountId]);
  assert.equal(room.ownerAccountId, actors[1].accountId);

  room = accepted(command(room, actors[2], { type: "join" }, options));
  assert.equal(room.hand, null, "joining a lobby clears the previous result before ready-up");
  assert.deepEqual(room.seats.map((seat) => seat.seat), [0, 1]);
});

test("a room closes when every remaining player permanently leaves during a hand", () => {
  const { room: started, options } = startRoom(2);
  let room = accepted(command(started, actors[0], { type: "leave" }, options));
  assert.equal(room.phase, "between_hands");
  room = accepted(command(room, actors[1], { type: "leave" }, options));
  assert.equal(room.phase, "closed");
  assert.equal(room.hand, null);
  assert.deepEqual(room.seats, []);
});

test("an out-of-turn departure folds without skipping the current actor", () => {
  const { room: started, options } = startRoom(3);
  let room = accepted(command(started, actors[1], { type: "leave" }, options));

  assert.equal(room.phase, "playing");
  assert.equal(room.hand.currentSeat, 0);
  assert.equal(room.hand.players.find((player) => player.seat === 1).folded, true);
  assert.equal(projectRoomState(room, actors[0].accountId).seats.find((seat) => seat.seat === 1).pendingLeave, true);

  room = accepted(act(room, actors[0], "fold", options));
  assert.equal(room.phase, "between_hands");
  room = accepted(command(room, actors[2], {
    type: "show",
    handId: room.hand.id,
    show: false,
  }, options));
  assert.equal(room.phase, "between_hands");
  assert.deepEqual(room.seats.map((seat) => seat.seat), [0, 2]);
});

test("an unmatched raise is returned to an out-of-turn player who permanently leaves", () => {
  const { room: started, options } = startRoom(2);
  let room = accepted(act(started, actors[0], "raise", options, 100));
  assert.equal(room.hand.currentSeat, 1);

  room = accepted(command(room, actors[0], { type: "leave" }, options));
  assert.equal(room.phase, "between_hands");
  assert.deepEqual(room.hand.result.payouts, [{ seat: 1, amount: 20 }]);
  assert.deepEqual(room.hand.result.returns, [{ seat: 0, amount: 90 }]);
  assert.equal(room.hand.result.totalPot, 20);
  assert.equal(room.seats.some((seat) => seat.seat === 0), false);
  assert.equal(room.session.players.find((player) => player.seat === 0).finalStack, 990);
  assert.equal(room.seats.find((seat) => seat.seat === 1).stack, 1_010);
  assert.equal(room.session.players.reduce((sum, player) => sum + player.finalStack, 0), 2_000);
});

test("room settings control stacks, mode, action clock and per-player time banks", () => {
  const { room } = startRoom(2, {
    roomOptions: {
      tableMode: "cash",
      startingStack: 2_000,
      actionTimeMs: 10_000,
      initialTimeBankMs: 100_000,
    },
  });
  assert.equal(room.tableMode, "cash");
  assert.equal(room.startingStack, 2_000);
  assert.equal(room.hand.actionStartedAt, 1_000_000);
  assert.equal(room.hand.actionDeadlineAt, 1_010_000);
  assert.deepEqual(room.seats.map((seat) => seat.timeBankMs), [100_000, 100_000]);
  const publicState = projectRoomState(room, actors[0].accountId);
  assert.equal(publicState.actionTimeMs, 10_000);
  assert.equal(publicState.timeBankUnitMs, 10_000);
  assert.equal(publicState.seats[1].timeBankMs, 100_000);
});

test("new rooms default to twenty-second turns while stored room settings remain intact", () => {
  assert.equal(ONLINE_DEFAULT_ACTION_TIME_MS, 20_000);
  const defaultScenario = startRoom(2);
  assert.equal(defaultScenario.room.actionTimeMs, 20_000);
  assert.equal(defaultScenario.room.hand.actionStartedAt, 1_000_000);
  assert.equal(defaultScenario.room.hand.actionDeadlineAt, 1_020_000);

  let storedRoom = createOnlineRoom({ roomId: "stored-action-clock", owner: actors[0], maxPlayers: 2 });
  storedRoom.actionTimeMs = 10_000;
  storedRoom = joinPlayers(storedRoom, 2, defaultScenario.options);
  storedRoom = accepted(command(storedRoom, actors[0], { type: "ready", ready: true }, defaultScenario.options));
  storedRoom = accepted(command(storedRoom, actors[1], { type: "ready", ready: true }, defaultScenario.options));
  storedRoom = accepted(command(storedRoom, actors[0], { type: "start" }, defaultScenario.options));
  assert.equal(storedRoom.actionTimeMs, 10_000, "normalization preserves an existing room's valid setting");
  assert.equal(storedRoom.hand.actionDeadlineAt, 1_010_000);
});

test("AI assist configuration accepts only 0, 5 or 10 and initializes every joined seat", () => {
  const options = deterministicOptions();
  assert.equal(ONLINE_DEFAULT_AI_ASSIST_LIMIT, 5);
  for (const invalidLimit of [-1, 1, 6, 10.5]) {
    assert.throws(
      () => createOnlineRoom({
        roomId: `invalid-ai-limit-${invalidLimit}`,
        owner: actors[0],
        aiAssistLimit: invalidLimit,
      }),
      /0、5 或 10/,
    );
  }

  for (const limit of [0, 5, 10]) {
    let room = createOnlineRoom({
      roomId: `ai-limit-${limit}`,
      owner: actors[0],
      maxPlayers: 2,
      aiAssistLimit: limit,
    });
    assert.equal(room.aiAssistLimit, limit);
    assert.equal(room.seats[0].aiAssistsRemaining, limit);
    room = accepted(command(room, actors[1], { type: "join" }, options));
    assert.deepEqual(room.seats.map((seat) => seat.aiAssistsRemaining), [limit, limit]);

    const projected = projectRoomState(room, null);
    assert.equal(projected.aiAssistLimit, limit);
    assert.deepEqual(projected.seats.map((seat) => seat.aiAssistsRemaining), [limit, limit]);
    assert.ok(projected.seats.every((seat) => !("accountId" in seat)));
  }

  const defaultRoom = createOnlineRoom({ roomId: "default-ai-limit", owner: actors[0] });
  assert.equal(defaultRoom.aiAssistLimit, 5);
  assert.equal(defaultRoom.seats[0].aiAssistsRemaining, 5);
});

test("AI assist consumption is authoritative, idempotent and invisible to hand actions and clocks", () => {
  const { room: started, options } = startRoom(2, {
    roomOptions: { aiAssistLimit: 5 },
  });
  const deadline = started.hand.actionDeadlineAt;
  const actionStartedAt = started.hand.actionStartedAt;
  const actionSeq = started.hand.actionSeq;
  const recentActions = structuredClone(started.hand.recentActions);
  const actionHistory = structuredClone(started.hand.actionHistory);
  const payload = {
    type: "use-ai-assist",
    handId: started.hand.id,
    commandId: "ai-assist-once",
    expectedRevision: started.revision,
  };

  const first = applyOnlinePokerCommand(started, actors[0], payload, options);
  assert.equal(first.ok, true);
  let room = first.state;
  assert.equal(room.revision, started.revision + 1);
  assert.equal(room.seats[0].aiAssistsRemaining, 4);
  assert.equal(room.session.players.find((player) => player.seat === 0).aiAssistsUsed, 1);
  assert.equal(room.hand.actionStartedAt, actionStartedAt);
  assert.equal(room.hand.actionDeadlineAt, deadline);
  assert.equal(room.hand.actionSeq, actionSeq);
  assert.deepEqual(room.hand.recentActions, recentActions);
  assert.deepEqual(room.hand.actionHistory, actionHistory);

  const duplicate = applyOnlinePokerCommand(room, actors[0], payload, options);
  assert.equal(duplicate.ok, true);
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.state.revision, room.revision);
  assert.equal(duplicate.state.seats[0].aiAssistsRemaining, 4);
  assert.equal(duplicate.state.session.players.find((player) => player.seat === 0).aiAssistsUsed, 1);

  rejected(applyOnlinePokerCommand(room, actors[0], {
    ...payload,
    handId: "another-hand",
  }, options), "COMMAND_ID_CONFLICT");

  room = JSON.parse(JSON.stringify(room));
  for (let remaining = 3; remaining >= 0; remaining -= 1) {
    room = accepted(command(room, actors[0], {
      type: "use-ai-assist",
      handId: room.hand.id,
    }, options));
    assert.equal(room.seats[0].aiAssistsRemaining, remaining);
  }
  assert.equal(room.session.players.find((player) => player.seat === 0).aiAssistsUsed, 5);
  const empty = command(room, actors[0], { type: "use-ai-assist", handId: room.hand.id }, options);
  rejected(empty, "AI_ASSIST_EMPTY");
  assert.equal(empty.state, room);
  assert.equal(empty.state.revision, room.revision);
});

test("AI assist rejects invalid phase, hand, actor, deadline, disabled rooms and missing private cards", () => {
  const options = deterministicOptions();
  const lobby = createOnlineRoom({ roomId: "ai-lobby", owner: actors[0], aiAssistLimit: 5 });
  rejected(command(lobby, actors[0], { type: "use-ai-assist", handId: "none" }, options), "WRONG_PHASE");

  const enabled = startRoom(2, { roomOptions: { aiAssistLimit: 5 } });
  rejected(command(enabled.room, actors[0], {
    type: "use-ai-assist",
    handId: "wrong-hand",
  }, enabled.options), "WRONG_HAND");
  rejected(command(enabled.room, actors[1], {
    type: "use-ai-assist",
    handId: enabled.room.hand.id,
  }, enabled.options), "NOT_YOUR_TURN");

  const withoutPrivateCards = {
    ...enabled.room,
    hand: {
      ...enabled.room.hand,
      players: enabled.room.hand.players.filter((player) => player.seat !== enabled.room.hand.currentSeat),
    },
  };
  rejected(command(withoutPrivateCards, actors[0], {
    type: "use-ai-assist",
    handId: withoutPrivateCards.hand.id,
  }, enabled.options), "AI_ASSIST_DISABLED");

  enabled.options.now = () => enabled.room.hand.actionDeadlineAt;
  rejected(command(enabled.room, actors[0], {
    type: "use-ai-assist",
    handId: enabled.room.hand.id,
  }, enabled.options), "TIME_EXPIRED");

  const disabled = startRoom(2, { roomOptions: { aiAssistLimit: 0 } });
  rejected(command(disabled.room, actors[0], {
    type: "use-ai-assist",
    handId: disabled.room.hand.id,
  }, disabled.options), "AI_ASSIST_DISABLED");
});

test("AI assist allowances persist across hands, appear in the final report and reset only on restart", () => {
  const { room: started, options } = startRoom(2, {
    roomOptions: { aiAssistLimit: 10 },
  });
  let room = accepted(command(started, actors[0], {
    type: "use-ai-assist",
    handId: started.hand.id,
  }, options));
  room = accepted(act(room, actors[0], "fold", options));
  room = accepted(command(room, actors[0], { type: "ready", ready: true }, options));
  room = accepted(command(room, actors[1], { type: "ready", ready: true }, options));

  assert.equal(room.phase, "between_hands", "readiness cannot skip the private-peek window");
  const firstHandId = room.hand.id;
  const firstNextHandAt = room.hand.nextHandAt;
  options.now = () => firstNextHandAt;
  room = accepted(command(room, actors[0], { type: "timeout", handId: firstHandId }, options));

  assert.equal(room.phase, "playing");
  assert.equal(room.hand.number, 2);
  assert.deepEqual(room.seats.map((seat) => seat.aiAssistsRemaining), [9, 10]);
  assert.equal(room.session.players.find((player) => player.seat === 0).aiAssistsUsed, 1);

  const currentSeat = room.hand.currentSeat;
  room = accepted(command(room, actors[currentSeat], {
    type: "use-ai-assist",
    handId: room.hand.id,
  }, options));
  assert.equal(room.seats.find((seat) => seat.seat === currentSeat).aiAssistsRemaining, 9);

  room = accepted(command(room, actors[0], { type: "finish" }, options));
  room = accepted(act(room, actors[currentSeat], "fold", options));
  const pendingShowSeat = room.hand.pendingShowSeat;
  assert.notEqual(pendingShowSeat, null);
  room = accepted(command(room, actors[pendingShowSeat], {
    type: "show",
    handId: room.hand.id,
    show: false,
  }, options));
  const nextHandAt = room.hand.nextHandAt;
  options.now = () => nextHandAt;
  room = accepted(command(room, actors[0], { type: "timeout", handId: room.hand.id }, options));
  assert.equal(room.phase, "finished");
  const report = projectRoomState(room, null).sessionReport;
  assert.deepEqual(
    report.players.map((player) => [player.seat, player.aiAssistsUsed]).sort((left, right) => left[0] - right[0]),
    [[0, 1], [1, 1]],
  );
  assert.ok(room.handHistory.every((entry) => entry.actions.every((action) => action.action !== "use-ai-assist")));

  room = accepted(command(room, actors[0], { type: "restart" }, options));
  assert.equal(room.aiAssistLimit, 10);
  assert.deepEqual(room.seats.map((seat) => seat.aiAssistsRemaining), [10, 10]);
  assert.equal(room.session.players.length, 0);
  assert.equal(projectRoomState(room, actors[0].accountId).sessionReport, null);
});

test("legacy rooms normalize missing AI allowances to disabled without granting refresh refills", () => {
  const configured = startRoom(2, { roomOptions: { aiAssistLimit: 10 } });
  const partialSeatState = JSON.parse(JSON.stringify(configured.room));
  partialSeatState.seats.forEach((seat) => { delete seat.aiAssistsRemaining; });
  let normalized = accepted(command(partialSeatState, actors[0], {
    type: "use-time-bank",
    handId: partialSeatState.hand.id,
  }, configured.options));
  assert.equal(normalized.aiAssistLimit, 10);
  assert.deepEqual(normalized.seats.map((seat) => seat.aiAssistsRemaining), [0, 0]);

  const legacy = JSON.parse(JSON.stringify(configured.room));
  delete legacy.aiAssistLimit;
  legacy.seats.forEach((seat) => { delete seat.aiAssistsRemaining; });
  legacy.session.players.forEach((player) => { delete player.aiAssistsUsed; });
  const legacyProjection = projectRoomState(legacy, actors[0].accountId);
  assert.equal(legacyProjection.aiAssistLimit, 0);
  assert.deepEqual(legacyProjection.seats.map((seat) => seat.aiAssistsRemaining), [0, 0]);

  normalized = accepted(command(legacy, actors[0], {
    type: "use-time-bank",
    handId: legacy.hand.id,
  }, configured.options));
  assert.equal(normalized.aiAssistLimit, 0);
  assert.deepEqual(normalized.seats.map((seat) => seat.aiAssistsRemaining), [0, 0]);
  assert.ok(normalized.session.players.every((player) => player.aiAssistsUsed === 0));
  rejected(command(normalized, actors[0], {
    type: "use-ai-assist",
    handId: normalized.hand.id,
  }, configured.options), "AI_ASSIST_DISABLED");
});

test("time cards extend only the current turn and timeout is server-authoritative", () => {
  let now = 2_000_000;
  let hand = 0;
  const options = {
    randomIndex: (maxExclusive) => maxExclusive - 1,
    makeHandId: () => `timed-hand-${++hand}`,
    now: () => now,
  };
  let room = createOnlineRoom({
    roomId: "timed-room",
    owner: actors[0],
    maxPlayers: 2,
    actionTimeMs: 10_000,
    initialTimeBankMs: 100_000,
  });
  room = joinPlayers(room, 2, options);
  room = accepted(command(room, actors[0], { type: "ready", ready: true }, options));
  room = accepted(command(room, actors[1], { type: "ready", ready: true }, options));
  room = accepted(command(room, actors[0], { type: "start" }, options));
  assert.equal(room.hand.actionDeadlineAt, 2_010_000);

  now += 3_000;
  room = accepted(command(room, actors[0], { type: "use-time-bank", handId: room.hand.id }, options));
  assert.equal(room.seats[0].timeBankMs, 90_000);
  assert.equal(room.hand.actionDeadlineAt, 2_020_000);

  now = 2_020_000;
  const lateCall = act(room, actors[0], "call", options);
  rejected(lateCall, "TIME_EXPIRED");
  room = accepted(command(room, actors[1], { type: "timeout", handId: room.hand.id }, options));
  assert.equal(room.phase, "between_hands");
  assert.equal(room.hand.players.find((player) => player.seat === 0).folded, true);
  assert.deepEqual(room.hand.recentActions, [{
    seq: 1,
    seat: 0,
    street: "preflop",
    action: "fold",
    amount: 0,
    toAmount: 5,
    raiseTo: null,
    potAfter: 15,
    stackAfter: 995,
    community: [],
    timedOut: true,
    source: "timeout",
    occurredAt: now,
  }]);
});

test("an expired free action checks automatically instead of folding", () => {
  let now = 3_000_000;
  let hand = 0;
  const options = {
    randomIndex: (maxExclusive) => maxExclusive - 1,
    makeHandId: () => `check-timeout-${++hand}`,
    now: () => now,
  };
  let room = createOnlineRoom({ roomId: "check-timeout-room", owner: actors[0], maxPlayers: 2 });
  room = joinPlayers(room, 2, options);
  room = accepted(command(room, actors[0], { type: "ready", ready: true }, options));
  room = accepted(command(room, actors[1], { type: "ready", ready: true }, options));
  room = accepted(command(room, actors[0], { type: "start" }, options));
  room = accepted(act(room, actors[0], "call", options));
  room = accepted(act(room, actors[1], "check", options));
  assert.equal(room.hand.street, "flop");
  assert.equal(room.hand.currentSeat, 1);
  now = room.hand.actionDeadlineAt;
  room = accepted(command(room, actors[0], { type: "timeout", handId: room.hand.id }, options));
  assert.equal(room.phase, "playing");
  assert.equal(room.hand.currentSeat, 0);
  assert.equal(room.hand.players.find((player) => player.seat === 1).folded, false);
  assert.deepEqual(room.hand.recentActions.map(({ seq, seat, street, action, timedOut, source }) => ({
    seq,
    seat,
    street,
    action,
    timedOut,
    source,
  })), [
    { seq: 1, seat: 0, street: "preflop", action: "call", timedOut: false, source: "player" },
    { seq: 2, seat: 1, street: "preflop", action: "check", timedOut: false, source: "player" },
    { seq: 3, seat: 1, street: "flop", action: "check", timedOut: true, source: "timeout" },
  ]);
});

test("public action journal preserves every accepted action without exposing account identities", () => {
  let now = 1_000_100;
  const { room: started, options } = startRoom(2);
  options.now = () => now;

  let room = accepted(act(started, actors[0], "call", options));
  now += 25;
  room = accepted(act(room, actors[1], "check", options));

  assert.equal(room.hand.actionSeq, 2);
  assert.deepEqual(room.hand.recentActions.map((event) => ({
    seq: event.seq,
    seat: event.seat,
    street: event.street,
    action: event.action,
    occurredAt: event.occurredAt,
  })), [
    { seq: 1, seat: 0, street: "preflop", action: "call", occurredAt: 1_000_100 },
    { seq: 2, seat: 1, street: "preflop", action: "check", occurredAt: 1_000_125 },
  ]);

  room.hand.recentActions[0].accountId = actors[0].accountId;
  room.hand.recentActions[0].hole = ["private-test-value"];
  const publicHand = projectRoomState(room, actors[0].accountId).hand;
  assert.equal(publicHand.actionSeq, 2);
  assert.equal(publicHand.recentActions.length, 2);
  assert.deepEqual(Object.keys(publicHand.recentActions[0]).sort(), [
    "action",
    "amount",
    "community",
    "occurredAt",
    "potAfter",
    "raiseTo",
    "seat",
    "seq",
    "source",
    "stackAfter",
    "street",
    "timedOut",
    "toAmount",
  ]);
  assert.doesNotMatch(JSON.stringify(publicHand.recentActions), /user-[0-9]/);
  assert.doesNotMatch(JSON.stringify(publicHand.recentActions), /hole|deck|accountId/);
});

test("action receipts stay idempotent and legacy hands acquire a sound cursor", () => {
  const firstScenario = startRoom(2);
  const actionPayload = {
    type: "act",
    handId: firstScenario.room.hand.id,
    action: "call",
    commandId: "idempotent-sound-action",
    expectedRevision: firstScenario.room.revision,
  };
  const first = applyOnlinePokerCommand(firstScenario.room, actors[0], actionPayload, firstScenario.options);
  assert.equal(first.ok, true);
  assert.equal(first.state.hand.actionSeq, 1);
  const duplicate = applyOnlinePokerCommand(first.state, actors[0], actionPayload, firstScenario.options);
  assert.equal(duplicate.ok, true);
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.state.hand.actionSeq, 1);
  assert.equal(duplicate.state.hand.recentActions.length, 1);

  const legacyScenario = startRoom(2);
  delete legacyScenario.room.hand.actionSeq;
  delete legacyScenario.room.hand.recentActions;
  const normalized = accepted(act(legacyScenario.room, actors[0], "call", legacyScenario.options));
  assert.equal(normalized.hand.actionSeq, 1);
  assert.deepEqual(normalized.hand.recentActions.map(({ seq, action }) => ({ seq, action })), [
    { seq: 1, action: "call" },
  ]);
});

test("legacy v12 action journals normalize missing replay fields before the next command", () => {
  const scenario = startRoom(2);
  let room = accepted(act(scenario.room, actors[0], "call", scenario.options));
  const legacyEvent = room.hand.recentActions[0];
  delete legacyEvent.amount;
  delete legacyEvent.toAmount;
  delete legacyEvent.raiseTo;
  delete legacyEvent.potAfter;
  delete legacyEvent.stackAfter;
  delete legacyEvent.community;
  delete room.hand.actionHistory;
  delete room.hand.startedAt;
  delete room.handHistory;

  room = accepted(act(room, actors[1], "check", scenario.options));
  assert.equal(room.hand.actionHistory.length, 2);
  assert.deepEqual(room.hand.actionHistory[0], {
    seq: 1,
    seat: 0,
    street: "preflop",
    action: "call",
    amount: null,
    toAmount: null,
    raiseTo: null,
    potAfter: null,
    stackAfter: null,
    community: [],
    timedOut: false,
    source: "player",
    occurredAt: 1_000_000,
  });
  assert.equal(room.hand.actionHistory[1].amount, 0);
  assert.equal(room.handHistory.length, 0);
  assert.equal(room.hand.startedAt, 1_000_000);
});

test("completed hand history seals an exact, deeply cloned visual replay", () => {
  const { room: started, options } = startRoom(2);
  let room = accepted(act(started, actors[0], "raise", options, 30));
  room = accepted(act(room, actors[1], "call", options));
  room = accepted(act(room, actors[1], "check", options));
  room = accepted(act(room, actors[0], "raise", options, 20));
  room = accepted(act(room, actors[1], "fold", options));

  assert.equal(room.handHistory.length, 1);
  const history = room.handHistory[0];
  assert.equal(history.id, room.hand.id);
  assert.equal(history.number, 1);
  assert.equal(history.smallBlind, 5);
  assert.equal(history.bigBlind, 10);
  assert.equal(history.community.length, 3);
  assert.deepEqual(history.actions.map((event) => ({
    action: event.action,
    amount: event.amount,
    toAmount: event.toAmount,
    raiseTo: event.raiseTo,
    potAfter: event.potAfter,
    stackAfter: event.stackAfter,
    board: event.community.length,
  })), [
    { action: "raise", amount: 25, toAmount: 30, raiseTo: 30, potAfter: 40, stackAfter: 970, board: 0 },
    { action: "call", amount: 20, toAmount: 30, raiseTo: null, potAfter: 60, stackAfter: 970, board: 0 },
    { action: "check", amount: 0, toAmount: 0, raiseTo: null, potAfter: 60, stackAfter: 970, board: 3 },
    { action: "raise", amount: 20, toAmount: 20, raiseTo: 20, potAfter: 80, stackAfter: 950, board: 3 },
    { action: "fold", amount: 0, toAmount: 0, raiseTo: null, potAfter: 80, stackAfter: 970, board: 3 },
  ]);
  assert.deepEqual(history.players.map((player) => ({
    seat: player.seat,
    start: player.stackAtHandStart,
    afterBlinds: player.stackAfterBlinds,
    final: player.stackAfterHand,
    contributed: player.contributed,
  })), [
    { seat: 0, start: 1_000, afterBlinds: 995, final: 1_030, contributed: 50 },
    { seat: 1, start: 1_000, afterBlinds: 990, final: 970, contributed: 30 },
  ]);
  assert.equal(history.result.totalPot, 60);
  assert.deepEqual(history.result.returns, [{ seat: 0, amount: 20 }]);
  assert.deepEqual(history.result.winnerSeats, [0]);

  const cloned = setOnlinePlayerConnection(room, actors[0].accountId, false, 1_100_000);
  assert.notEqual(cloned.handHistory, room.handHistory);
  assert.notEqual(cloned.handHistory[0], room.handHistory[0]);
  assert.notEqual(cloned.handHistory[0].players[0].hole, room.handHistory[0].players[0].hole);
  assert.notEqual(cloned.handHistory[0].actions[2].community, room.handHistory[0].actions[2].community);
  assert.notEqual(cloned.handHistory[0].result.payouts, room.handHistory[0].result.payouts);
});

test("completed hand history is idempotent and capped to the latest thirty hands", () => {
  const scenario = startRoom(2, { roomOptions: { tableMode: "cash" } });
  let room = scenario.room;
  const firstFoldPayload = {
    type: "act",
    handId: room.hand.id,
    action: "fold",
    commandId: "history-idempotent-fold",
    expectedRevision: room.revision,
  };
  const firstFold = applyOnlinePokerCommand(room, actors[room.hand.currentSeat], firstFoldPayload, scenario.options);
  room = accepted(firstFold);
  const duplicateFold = applyOnlinePokerCommand(room, actors[0], firstFoldPayload, scenario.options);
  assert.equal(duplicateFold.ok, true);
  assert.equal(duplicateFold.duplicate, true);
  assert.equal(duplicateFold.state.handHistory.length, 1);

  for (let completed = 1; completed < ONLINE_HAND_HISTORY_LIMIT + 1; completed += 1) {
    const completedHandId = room.hand.id;
    const deadline = room.hand.nextHandAt;
    scenario.options.now = () => deadline;
    room = accepted(command(room, actors[0], { type: "timeout", handId: completedHandId }, scenario.options));
    assert.equal(room.phase, "playing");
    const actor = actors[room.hand.currentSeat];
    room = accepted(act(room, actor, "fold", scenario.options));
    assert.ok(room.handHistory.length <= ONLINE_HAND_HISTORY_LIMIT);
  }

  assert.equal(room.handHistory.length, ONLINE_HAND_HISTORY_LIMIT);
  assert.equal(room.handHistory[0].number, 2);
  assert.equal(room.handHistory.at(-1).number, ONLINE_HAND_HISTORY_LIMIT + 1);
  assert.equal(new Set(room.handHistory.map((entry) => entry.id)).size, ONLINE_HAND_HISTORY_LIMIT);
});

test("hand history projection protects hidden cards and unlocks full review only for finished participants", () => {
  const { room: started, options } = startRoom(2, { roomOptions: { tableMode: "cash" } });
  const privateHoles = new Map(started.hand.players.map((player) => [player.seat, player.hole]));
  let room = accepted(act(started, actors[0], "fold", options));

  const ownerBefore = projectRoomState(room, actors[0].accountId).handHistory[0];
  const winnerBefore = projectRoomState(room, actors[1].accountId).handHistory[0];
  const spectatorBefore = projectRoomState(room, null).handHistory[0];
  assert.deepEqual(ownerBefore.players[0].holeCards, privateHoles.get(0));
  assert.equal(ownerBefore.players[1].holeCards, null);
  assert.equal(winnerBefore.players[0].holeCards, null);
  assert.deepEqual(winnerBefore.players[1].holeCards, privateHoles.get(1));
  assert.ok(spectatorBefore.players.every((player) => player.holeCards === null));

  room = accepted(command(room, actors[1], {
    type: "show",
    handId: room.hand.id,
    show: true,
  }, options));
  assert.equal(room.handHistory[0].players.find((player) => player.seat === 1).shown, true);
  assert.deepEqual(
    projectRoomState(room, null).handHistory[0].players.find((player) => player.seat === 1).holeCards,
    privateHoles.get(1),
    "a voluntary show is synchronized into the sealed history",
  );

  room = accepted(command(room, actors[0], { type: "finish" }, options));
  const nextHandAt = room.hand.nextHandAt;
  options.now = () => nextHandAt;
  room = accepted(command(room, actors[0], { type: "timeout", handId: room.hand.id }, options));
  assert.equal(room.phase, "finished");

  room.handHistory[0].actions[0].accountId = actors[0].accountId;
  room.handHistory[0].actions[0].deck = ["private-action-value"];
  room.handHistory[0].result.accountId = actors[1].accountId;
  room.handHistory[0].result.deck = ["private-result-value"];
  for (const actor of actors.slice(0, 2)) {
    const participantHistory = projectRoomState(room, actor.accountId).handHistory[0];
    assert.ok(participantHistory.players.every((player) => player.holeCards?.length === 2));
  }
  for (const viewer of [null, actors[2].accountId]) {
    const visitorHistory = projectRoomState(room, viewer).handHistory[0];
    assert.equal(visitorHistory.players.find((player) => player.seat === 0).holeCards, null);
    assert.ok(visitorHistory.players.find((player) => player.seat === 1).holeCards);
    const serialized = JSON.stringify(visitorHistory);
    assert.doesNotMatch(serialized, /user-[0-9]|private-action-value|private-result-value|"deck"|"accountId"/);
  }
});

test("commands use optimistic revision checks and idempotent command IDs", () => {
  const options = deterministicOptions();
  const room = createOnlineRoom({ roomId: "revisions", owner: actors[0], maxPlayers: 2 });
  const payload = { type: "ready", ready: true, commandId: "same-id", expectedRevision: 0 };
  const first = applyOnlinePokerCommand(room, actors[0], payload, options);
  assert.equal(first.ok, true);
  assert.equal(first.state.revision, 1);

  const duplicate = applyOnlinePokerCommand(first.state, actors[0], payload, options);
  assert.equal(duplicate.ok, true);
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.resultRevision, 1);
  assert.equal(duplicate.state.revision, 1);

  const conflict = applyOnlinePokerCommand(first.state, actors[1], payload, options);
  rejected(conflict, "COMMAND_ID_CONFLICT");

  const alteredPayload = applyOnlinePokerCommand(first.state, actors[0], { ...payload, ready: false }, options);
  rejected(alteredPayload, "COMMAND_ID_CONFLICT");

  const stale = applyOnlinePokerCommand(first.state, actors[0], {
    type: "ready",
    ready: false,
    commandId: "new-id",
    expectedRevision: 0,
  }, options);
  rejected(stale, "STALE_REVISION");
  assert.equal(stale.state.revision, 1);
});

test("idempotency receipts survive long room sessions", () => {
  const options = deterministicOptions();
  let room = createOnlineRoom({ roomId: "long-session", owner: actors[0], maxPlayers: 2 });
  const firstPayload = { type: "ready", ready: true, commandId: "oldest-id", expectedRevision: 0 };
  room = accepted(applyOnlinePokerCommand(room, actors[0], firstPayload, options));
  for (let index = 1; index <= 300; index += 1) {
    room = accepted(applyOnlinePokerCommand(room, actors[0], {
      type: "ready",
      ready: index % 2 === 0,
      commandId: `later-${index}`,
      expectedRevision: room.revision,
    }, options));
  }
  assert.equal(room.processedCommands.length, 301);
  const retry = applyOnlinePokerCommand(room, actors[0], firstPayload, options);
  assert.equal(retry.ok, true);
  assert.equal(retry.duplicate, true);
  assert.equal(retry.resultRevision, 1);
  assert.equal(retry.state.revision, 301);
});

test("idempotency receipts use a bounded replay window", () => {
  const options = deterministicOptions();
  let room = createOnlineRoom({ roomId: "bounded-receipts", owner: actors[0], maxPlayers: 2 });
  for (let index = 0; index < ONLINE_COMMAND_RECEIPT_LIMIT + 37; index += 1) {
    room = accepted(applyOnlinePokerCommand(room, actors[0], {
      type: "ready",
      ready: index % 2 === 0,
      commandId: `bounded-${index}`,
      expectedRevision: room.revision,
    }, options));
  }
  assert.equal(room.processedCommands.length, ONLINE_COMMAND_RECEIPT_LIMIT);
  assert.equal(room.processedCommands[0].commandId, "bounded-37");
  assert.equal(room.processedCommands.at(-1).commandId, `bounded-${ONLINE_COMMAND_RECEIPT_LIMIT + 36}`);
});

test("deck is unique, deterministic when injected, and defaults to Web Crypto", async () => {
  const deck = makeOnlineDeck();
  assert.equal(deck.length, 52);
  assert.equal(new Set(deck.map((entry) => `${entry.rank}-${entry.suit}`)).size, 52);

  const ordered = shuffleOnlineDeck((maxExclusive) => maxExclusive - 1);
  assert.deepEqual(ordered, deck);
  for (let index = 0; index < 20; index += 1) {
    const sampled = cryptoRandomIndex(7);
    assert.ok(sampled >= 0 && sampled < 7);
  }
  const source = await readFile(new URL("../lib/online-poker.ts", import.meta.url), "utf8");
  assert.match(source, /crypto\.getRandomValues/);
  assert.doesNotMatch(source, /Math\.random/);
});

test("two-player table uses dealer as small blind and correct street order", () => {
  const { room: started, options } = startRoom(2);
  let room = started;
  assert.ok(room.hand);
  assert.equal(room.hand.dealerSeat, 0);
  assert.equal(room.hand.smallBlindSeat, 0);
  assert.equal(room.hand.bigBlindSeat, 1);
  assert.equal(room.hand.currentSeat, 0, "dealer/SB acts first preflop heads-up");
  assert.deepEqual(room.hand.players.find((player) => player.seat === 1).hole, [card(2, "♠"), card(4, "♠")]);
  assert.deepEqual(room.hand.players.find((player) => player.seat === 0).hole, [card(3, "♠"), card(5, "♠")]);
  assert.equal(room.hand.players.find((player) => player.seat === 0).bet, 5);
  assert.equal(room.hand.players.find((player) => player.seat === 1).bet, 10);
  assert.equal(room.seats.find((seat) => seat.seat === 0).stack, 995);
  assert.equal(room.seats.find((seat) => seat.seat === 1).stack, 990);

  room = accepted(act(room, actors[0], "call", options));
  assert.equal(room.hand.currentSeat, 1);
  room = accepted(act(room, actors[1], "check", options));
  assert.equal(room.hand.street, "flop");
  assert.equal(room.hand.community.length, 3);
  assert.equal(room.hand.pot, 20);
  assert.equal(room.hand.currentSeat, 1, "BB acts first postflop heads-up");
});

test("three-player table posts blinds left of the dealer and acts after the big blind", () => {
  const { room } = startRoom(3);
  assert.ok(room.hand);
  assert.equal(room.hand.dealerSeat, 0);
  assert.equal(room.hand.smallBlindSeat, 1);
  assert.equal(room.hand.bigBlindSeat, 2);
  assert.equal(room.hand.currentSeat, 0);
});

test("a short all-in big blind does not reduce the preflop bring-in", () => {
  const liveAction = startRoom(3, { stacks: [100, 100, 3] });
  assert.equal(liveAction.room.hand.highestBet, 10);
  const utgView = projectRoomState(liveAction.room, actors[0].accountId);
  assert.equal(utgView.legalActions.callAmount, 10);
  assert.equal(utgView.legalActions.raise.minRaiseTo, 20);

  const onlyOneActor = startRoom(3, { stacks: [100, 5, 3] });
  assert.equal(onlyOneActor.room.hand.highestBet, 5);
  const soleActorView = projectRoomState(onlyOneActor.room, actors[0].accountId);
  assert.equal(soleActorView.legalActions.callAmount, 5);
  const settled = accepted(act(onlyOneActor.room, actors[0], "call", onlyOneActor.options));
  assert.equal(settled.phase, "between_hands");
  assert.equal(settled.seats.reduce((sum, seat) => sum + seat.stack, 0), 108);
});

test("a phantom short-BB bring-in disappears when only one funded actor remains", () => {
  const started = startRoom(3, { stacks: [100, 100, 3] });
  assert.equal(started.room.hand.highestBet, 10);

  const settled = accepted(act(started.room, actors[0], "fold", started.options));
  assert.equal(settled.phase, "between_hands");
  assert.equal(settled.hand.community.length, 5);
  assert.equal(settled.hand.currentSeat, null);
  assert.equal(settled.seats.find((seat) => seat.seat === 1).stack >= 95, true);
  assert.equal(settled.seats.reduce((sum, seat) => sum + seat.stack, 0), 203);
});

test("check/call lines complete cleanly at every supported table size", () => {
  for (let count = 2; count <= 6; count += 1) {
    const started = startRoom(count);
    let room = started.room;
    let actions = 0;
    while (room.phase === "playing") {
      assert.ok(room.hand?.currentSeat !== null);
      const currentSeat = room.hand.currentSeat;
      const currentActor = actors[currentSeat];
      const view = projectRoomState(room, currentActor.accountId);
      const action = view.legalActions.callAmount === null ? "check" : "call";
      room = accepted(act(room, currentActor, action, started.options));
      actions += 1;
      assert.ok(actions < 100, `${count} 人桌没有在合理行动数内结束`);
    }
    assert.equal(room.phase, "between_hands");
    assert.equal(room.hand.community.length, 5);
    assert.equal(room.seats.reduce((sum, seat) => sum + seat.stack, 0), count * ONLINE_STARTING_STACK);
  }
});

test("server strictly rejects wrong player, hand, action and raise size without mutation", () => {
  const { room, options } = startRoom(2);
  assert.ok(room.hand);
  const originalRevision = room.revision;

  const wrongPlayer = act(room, actors[1], "call", options);
  rejected(wrongPlayer, "NOT_YOUR_TURN");
  assert.equal(wrongPlayer.state, room);

  const wrongHand = command(room, actors[0], {
    type: "act",
    handId: "old-hand",
    action: "call",
  }, options);
  rejected(wrongHand, "WRONG_HAND");

  const illegalCheck = act(room, actors[0], "check", options);
  rejected(illegalCheck, "CALL_REQUIRED");

  const tooSmall = act(room, actors[0], "raise", options, 15);
  rejected(tooSmall, "INVALID_RAISE");
  assert.equal(tooSmall.state.revision, originalRevision);
  assert.equal(tooSmall.state.hand.highestBet, ONLINE_BIG_BLIND);

  const tooLarge = act(room, actors[0], "raise", options, ONLINE_STARTING_STACK + 1);
  rejected(tooLarge, "INVALID_RAISE");

  const valid = act(room, actors[0], "raise", options, 20);
  assert.equal(valid.ok, true);
  assert.equal(valid.state.hand.highestBet, 20);
});

test("an under-minimum raise is legal only when it is the player's exact all-in", () => {
  const { room: started, options } = startRoom(2);
  const short = {
    ...started,
    seats: started.seats.map((seat) => seat.seat === 0 ? { ...seat, stack: 10 } : { ...seat }),
  };
  const notAllIn = act(short, actors[0], "raise", options, 14);
  rejected(notAllIn, "INVALID_RAISE");

  const allIn = act(short, actors[0], "raise", options, 15);
  assert.equal(allIn.ok, true);
  assert.equal(allIn.state.seats.find((seat) => seat.seat === 0).stack, 0);
  assert.equal(allIn.state.hand.highestBet, 15);
});

test("an unacted player must raise a full increment over an incomplete all-in", () => {
  const { room: started, options } = startRoom(3);
  let room = accepted(act(started, actors[0], "call", options));
  room = accepted(act(room, actors[1], "call", options));
  room = accepted(act(room, actors[2], "check", options));
  assert.equal(room.hand.street, "flop");
  assert.equal(room.hand.currentSeat, 1);

  room = accepted(act(room, actors[1], "check", options));
  room = {
    ...room,
    seats: room.seats.map((seat) => seat.seat === 2 ? { ...seat, stack: 5 } : { ...seat }),
  };
  room = accepted(act(room, actors[2], "raise", options, 5));
  const viewer = projectRoomState(room, actors[0].accountId);
  assert.equal(viewer.legalActions.raise.minRaiseTo, 15);
  assert.equal(viewer.legalActions.raise.allInOnly, false);

  const foldedUnactedPlayer = accepted(act(room, actors[0], "fold", options));
  const checkedPlayerView = projectRoomState(foldedUnactedPlayer, actors[1].accountId);
  assert.equal(checkedPlayerView.legalActions.callAmount, 5);
  assert.equal(checkedPlayerView.legalActions.raise, null, "incomplete all-in does not reopen a prior checker");

  room = accepted(act(room, actors[0], "raise", options, 15));
  assert.equal(room.phase, "playing");
  assert.equal(room.hand.highestBet, 15);
  assert.equal(room.hand.currentSeat, 1);
});

test("cumulative incomplete all-ins reopen raising only after a full increment", () => {
  const buildCumulativeRaise = (finalTarget) => {
    const { room: started, options } = startRoom(5);
    let room = accepted(act(started, actors[3], "call", options));
    room = accepted(act(room, actors[4], "call", options));
    room = accepted(act(room, actors[0], "call", options));
    room = accepted(act(room, actors[1], "call", options));
    room = accepted(act(room, actors[2], "check", options));
    assert.equal(room.hand.street, "flop");
    assert.equal(room.hand.currentSeat, 1);

    room = accepted(act(room, actors[1], "check", options));
    room = { ...room, seats: room.seats.map((seat) => seat.seat === 2 ? { ...seat, stack: 5 } : { ...seat }) };
    room = accepted(act(room, actors[2], "raise", options, 5));
    room = { ...room, seats: room.seats.map((seat) => seat.seat === 3 ? { ...seat, stack: 8 } : { ...seat }) };
    room = accepted(act(room, actors[3], "raise", options, 8));
    room = { ...room, seats: room.seats.map((seat) => seat.seat === 4 ? { ...seat, stack: finalTarget } : { ...seat }) };
    room = accepted(act(room, actors[4], "raise", options, finalTarget));
    room = accepted(act(room, actors[0], "call", options));
    return { room, options };
  };

  const belowFullRaise = buildCumulativeRaise(9).room;
  const locked = projectRoomState(belowFullRaise, actors[1].accountId).legalActions;
  assert.equal(locked.callAmount, 9);
  assert.equal(locked.raise, null, "a cumulative increase below one full bet keeps prior action locked");

  const fullRaise = buildCumulativeRaise(10).room;
  const reopened = projectRoomState(fullRaise, actors[1].accountId).legalActions;
  assert.equal(reopened.callAmount, 10);
  assert.equal(reopened.raise.minRaiseTo, 20, "a cumulative full-bet increase reopens raising");
});

test("all-in call runs the board, reveals live hands, and conserves chips", () => {
  const { room: started, options } = startRoom(2);
  let room = accepted(act(started, actors[0], "raise", options, 1000));
  assert.equal(room.seats.find((seat) => seat.seat === 0).stack, 0);
  room = accepted(act(room, actors[1], "call", options));

  assert.equal(room.phase, "between_hands");
  assert.ok(room.hand.result);
  assert.equal(room.hand.result.kind, "showdown");
  assert.equal(room.hand.result.totalPot, 2000);
  assert.equal(room.hand.result.payouts.reduce((sum, payout) => sum + payout.amount, 0), 2000);
  assert.equal(room.hand.community.length, 5);
  assert.equal(room.seats.reduce((sum, seat) => sum + seat.stack, 0), 2000);
  assert.ok(room.hand.players.every((player) => player.shown));
  assert.ok(room.seats.every((seat) => seat.stack >= 0));
});

test("an all-in departure remains eligible and another command finalizes the seat after settlement", () => {
  const { room: started, options } = startRoom(3, { stacks: [20, 100, 100] });
  started.hand.players.find((player) => player.seat === 0).hole = [card(14, "♠"), card(14, "♥")];
  started.hand.players.find((player) => player.seat === 1).hole = [card(13, "♠"), card(13, "♥")];
  started.hand.players.find((player) => player.seat === 2).hole = [card(12, "♠"), card(12, "♥")];
  started.hand.deck = [
    card(2, "♣"), card(3, "♦"), card(7, "♣"), card(8, "♦"), card(9, "♣"),
  ];

  let room = accepted(act(started, actors[0], "raise", options, 20));
  assert.equal(room.seats.find((seat) => seat.seat === 0).stack, 0);
  room = accepted(command(room, actors[0], { type: "leave" }, options));
  assert.equal(room.seats.find((seat) => seat.seat === 0).pendingLeave, true);
  assert.equal(room.hand.players.find((player) => player.seat === 0).folded, false, "all-in hand stays live");

  room = accepted(act(room, actors[1], "call", options));
  room = accepted(act(room, actors[2], "call", options));
  room = accepted(act(room, actors[1], "fold", options));

  assert.equal(room.phase, "between_hands");
  assert.equal(room.hand.result.payouts.some((payout) => payout.seat === 0), true, "departing all-in may still win");
  assert.equal(room.hand.players.find((player) => player.seat === 0).folded, false);
  assert.deepEqual(room.seats.map((seat) => seat.seat), [1, 2], "terminal action finalizes an earlier departure");
  const publicResult = projectRoomState(room, actors[1].accountId).hand.result;
  const departedWinner = publicResult.winnerDetails.find((winner) => winner.seat === 0);
  assert.equal(departedWinner.displayName, actors[0].displayName);
  assert.deepEqual(departedWinner.holeCards, [card(14, "♠"), card(14, "♥")], "shown winning cards survive seat release");
});

test("uncalled all-in chips are returned instead of reported as pot winnings", () => {
  const shortCall = startRoom(2, { stacks: [100, 20] });
  let room = accepted(act(shortCall.room, actors[0], "raise", shortCall.options, 100));
  room = accepted(act(room, actors[1], "call", shortCall.options));
  assert.equal(room.hand.result.totalPot, 40);
  assert.deepEqual(room.hand.result.returns, [{ seat: 0, amount: 80 }]);
  assert.equal(room.hand.result.payouts.reduce((sum, payout) => sum + payout.amount, 0), 40);
  assert.equal(room.seats.reduce((sum, seat) => sum + seat.stack, 0), 120);

  const foldLine = startRoom(2);
  room = accepted(act(foldLine.room, actors[0], "raise", foldLine.options, 1000));
  room = accepted(act(room, actors[1], "fold", foldLine.options));
  assert.equal(room.hand.result.totalPot, 20);
  assert.deepEqual(room.hand.result.payouts, [{ seat: 0, amount: 20 }]);
  assert.deepEqual(room.hand.result.returns, [{ seat: 0, amount: 990 }]);
  assert.equal(room.seats.reduce((sum, seat) => sum + seat.stack, 0), 2000);
});

test("a departing high bettor no longer forces the table to match an orphaned bet", () => {
  const scenario = startRoom(3);
  let room = accepted(act(scenario.room, actors[0], "raise", scenario.options, 100));
  room = accepted(command(room, actors[0], { type: "leave" }, scenario.options));

  const departed = room.hand.players.find((player) => player.seat === 0);
  assert.equal(departed.folded, true);
  assert.equal(departed.bet, 10);
  assert.equal(departed.contributed, 10);
  assert.equal(room.seats.find((seat) => seat.seat === 0).stack, 990);
  assert.equal(room.hand.highestBet, 10);
  assert.equal(room.hand.minRaise, 10);
  assert.deepEqual(room.hand.pendingReturns, [{ seat: 0, amount: 90 }]);

  const smallBlind = projectRoomState(room, actors[1].accountId).legalActions;
  assert.equal(smallBlind.callAmount, 5);
  assert.equal(smallBlind.raise.minRaiseTo, 20);

  room = accepted(act(room, actors[1], "call", scenario.options));
  room = accepted(act(room, actors[2], "check", scenario.options));
  while (room.phase === "playing") {
    const currentSeat = room.hand.currentSeat;
    const legal = projectRoomState(room, actors[currentSeat].accountId).legalActions;
    room = accepted(act(room, actors[currentSeat], legal.check ? "check" : "call", scenario.options));
  }
  assert.deepEqual(room.hand.result.returns, [{ seat: 0, amount: 90 }]);
  assert.equal(room.seats.some((seat) => seat.seat === 0), false);
  const departedReturner = projectRoomState(room, actors[1].accountId).hand.result.winnerDetails
    .find((detail) => detail.seat === 0);
  assert.equal(departedReturner.displayName, actors[0].displayName);
});

test("folding a later full raiser restores the prior legal raise increment", () => {
  const scenario = startRoom(3);
  let room = accepted(act(scenario.room, actors[0], "raise", scenario.options, 30));
  room = accepted(act(room, actors[1], "raise", scenario.options, 100));
  room = accepted(command(room, actors[1], { type: "leave" }, scenario.options));

  assert.equal(room.hand.highestBet, 30);
  assert.equal(room.hand.minRaise, 20);
  assert.deepEqual(room.hand.fullRaiseHistory, [{ seat: 0, target: 30, increment: 20 }]);
  const bigBlind = projectRoomState(room, actors[2].accountId).legalActions;
  assert.equal(bigBlind.callAmount, 20);
  assert.equal(bigBlind.raise.minRaiseTo, 50);
});

test("a postflop bettor leaving out of turn does not erase unacted players' decisions", () => {
  const scenario = startRoom(3);
  let room = accepted(act(scenario.room, actors[0], "call", scenario.options));
  room = accepted(act(room, actors[1], "call", scenario.options));
  room = accepted(act(room, actors[2], "check", scenario.options));
  assert.equal(room.hand.street, "flop");
  assert.equal(room.hand.currentSeat, 1);

  room = accepted(act(room, actors[1], "raise", scenario.options, 30));
  assert.equal(room.hand.currentSeat, 2);
  room = accepted(command(room, actors[1], { type: "leave" }, scenario.options));

  assert.equal(room.phase, "playing");
  assert.equal(room.hand.street, "flop");
  assert.equal(room.hand.currentSeat, 2);
  assert.equal(room.hand.highestBet, 0);
  assert.equal(room.hand.players.find((player) => player.seat === 2).hasActed, false);
  const nextPlayer = projectRoomState(room, actors[2].accountId).legalActions;
  assert.equal(nextPlayer.check, true);
  assert.equal(nextPlayer.raise.minRaiseTo, 10);
});

test("consecutive out-of-turn departures settle orphaned side pots without stalling", () => {
  const scenario = startRoom(4, { stacks: [191, 166, 101, 8] });
  let room = accepted(act(scenario.room, actors[3], "call", scenario.options));
  room = accepted(act(room, actors[0], "raise", scenario.options, 20));
  room = accepted(act(room, actors[1], "call", scenario.options));
  room = accepted(act(room, actors[2], "call", scenario.options));
  assert.equal(room.hand.street, "flop");

  room = accepted(act(room, actors[1], "check", scenario.options));
  room = accepted(act(room, actors[2], "raise", scenario.options, 34));
  room = accepted(act(room, actors[0], "call", scenario.options));
  room = accepted(command(room, actors[2], { type: "leave" }, scenario.options));
  room = accepted(command(room, actors[0], { type: "leave" }, scenario.options));

  assert.equal(room.phase, "between_hands");
  assert.equal(room.hand.community.length, 5);
  assert.equal(room.hand.result.totalPot, 136);
  assert.equal(room.hand.result.payouts.some((payout) => payout.seat === 0 || payout.seat === 2), false, "folded hands never receive an orphaned side pot");
  assert.equal(room.hand.result.payouts.reduce((sum, payout) => sum + payout.amount, 0), 136);
  assert.deepEqual(room.seats.map((seat) => seat.seat), [1, 3]);
});

test("dead blinds go to the only live hand when both blinds leave out of turn", () => {
  const scenario = startRoom(3);
  let room = accepted(command(scenario.room, actors[1], { type: "leave" }, scenario.options));
  room = accepted(command(room, actors[2], { type: "leave" }, scenario.options));

  assert.equal(room.phase, "between_hands");
  assert.deepEqual(room.hand.result.payouts, [{ seat: 0, amount: 10 }]);
  assert.deepEqual(room.hand.result.returns, [{ seat: 2, amount: 5 }]);
  assert.deepEqual(room.hand.result.winnerSeats, [0]);
  assert.equal(room.hand.result.totalPot, 10);
});

test("the sole funded live player auto-runs out instead of folding an uncontested side pot", () => {
  const scenario = startRoom(5, { stacks: [9, 3, 10, 171, 146] });
  let room = accepted(act(scenario.room, actors[3], "call", scenario.options));
  room = accepted(act(room, actors[4], "raise", scenario.options, 20));
  room = accepted(act(room, actors[0], "call", scenario.options));
  room = accepted(act(room, actors[3], "call", scenario.options));
  assert.equal(room.hand.street, "flop");
  assert.equal(room.hand.currentSeat, 3);

  room = accepted(act(room, actors[3], "fold", scenario.options));
  assert.equal(room.phase, "between_hands");
  assert.equal(room.hand.result.payouts.reduce((sum, payout) => sum + payout.amount, 0), 62);
  assert.equal(room.seats.reduce((sum, seat) => sum + seat.stack, 0), 339);
});

test("side pots are paid only to eligible players", () => {
  const { room: started, options } = startRoom(3, { stacks: [100, 200, 1000] });
  assert.ok(started.hand);
  started.hand.players.find((player) => player.seat === 0).hole = [card(14, "♠"), card(14, "♥")];
  started.hand.players.find((player) => player.seat === 1).hole = [card(13, "♠"), card(13, "♥")];
  started.hand.players.find((player) => player.seat === 2).hole = [card(12, "♠"), card(12, "♥")];
  started.hand.deck = [
    card(2, "♣"), card(3, "♦"), card(7, "♣"), card(8, "♦"), card(9, "♣"),
  ];

  let room = accepted(act(started, actors[0], "raise", options, 100));
  room = accepted(act(room, actors[1], "raise", options, 200));
  room = accepted(act(room, actors[2], "call", options));

  assert.equal(room.phase, "between_hands");
  const payouts = new Map(room.hand.result.payouts.map((payout) => [payout.seat, payout.amount]));
  assert.equal(payouts.get(0), 300, "AA wins the three-way main pot");
  assert.equal(payouts.get(1), 200, "KK wins the side pot against QQ");
  assert.equal(payouts.has(2), false);
  assert.deepEqual(room.hand.result.mainPotWinnerSeats, [0]);
  assert.deepEqual(room.hand.result.winnerSeats, [0, 1], "winnerSeats includes side-pot recipients");
  assert.deepEqual(room.hand.result.returns, []);
  assert.deepEqual(room.seats.map((seat) => seat.stack), [300, 200, 800]);
  assert.equal(room.seats.reduce((sum, seat) => sum + seat.stack, 0), 1300);
});

test("uncontested winner chooses show or muck before the next hand", () => {
  const { room: started, options } = startRoom(2);
  let room = accepted(act(started, actors[0], "fold", options));
  assert.equal(room.phase, "between_hands");
  assert.equal(room.hand.pendingShowSeat, 1);
  assert.equal(room.hand.result.totalPot, 10);
  assert.deepEqual(room.hand.result.returns, [{ seat: 1, amount: 5 }]);
  assert.equal(projectRoomState(room, actors[0].accountId).seats[1].holeCards, null);
  const completedHandId = room.hand.id;
  const nextHandAt = room.hand.nextHandAt;
  const showDecisionDeadlineAt = room.hand.showDecisionDeadlineAt;

  options.now = () => showDecisionDeadlineAt - 1;

  room = accepted(command(room, actors[1], {
    type: "show",
    handId: room.hand.id,
    show: true,
  }, options));
  assert.equal(room.phase, "between_hands");
  assert.ok(projectRoomState(room, actors[0].accountId).seats[1].holeCards);
  assert.ok(
    nextHandAt - options.now() >= ONLINE_REVEALED_HAND_HOLD_MS,
    "even the latest valid reveal keeps the complete display tail",
  );

  room = accepted(command(room, actors[0], { type: "ready", ready: true }, options));
  room = accepted(command(room, actors[1], { type: "ready", ready: true }, options));
  assert.equal(room.phase, "between_hands", "all-ready cannot skip cards already shown to the table");
  assert.equal(room.hand.id, completedHandId);
  assert.ok(room.seats.every((seat) => seat.ready));

  options.now = () => nextHandAt;
  room = accepted(command(room, actors[0], { type: "timeout", handId: completedHandId }, options));
  assert.equal(room.phase, "playing");
  assert.equal(room.hand.number, 2);
  assert.equal(room.hand.dealerSeat, 1);
  assert.equal(room.hand.smallBlindSeat, 1);
  assert.equal(room.hand.currentSeat, 1);
});

test("uncontested show choice expires on the server and any member can auto-muck it", () => {
  let now = 4_000_000;
  let handNumber = 0;
  const options = {
    randomIndex: (maxExclusive) => maxExclusive - 1,
    makeHandId: () => `show-clock-${++handNumber}`,
    now: () => now,
  };
  let room = createOnlineRoom({ roomId: "show-clock-room", owner: actors[0], maxPlayers: 2 });
  room = joinPlayers(room, 2, options);
  room = accepted(command(room, actors[0], { type: "ready", ready: true }, options));
  room = accepted(command(room, actors[1], { type: "ready", ready: true }, options));
  room = accepted(command(room, actors[0], { type: "start" }, options));
  room = accepted(act(room, actors[0], "fold", options));

  assert.equal(room.phase, "between_hands");
  assert.equal(room.hand.nextHandAt, now + ONLINE_NEXT_HAND_DELAY_MS);
  assert.equal(room.hand.showDecisionDeadlineAt, now + ONLINE_SHOW_DECISION_TIME_MS);
  assert.equal(
    room.hand.nextHandAt - room.hand.showDecisionDeadlineAt,
    ONLINE_REVEALED_HAND_HOLD_MS,
  );
  assert.equal(
    projectRoomState(room, actors[0].accountId).hand.showDecisionDeadlineAt,
    room.hand.showDecisionDeadlineAt,
  );

  now = room.hand.showDecisionDeadlineAt - 1;
  rejected(command(room, actors[0], { type: "timeout", handId: room.hand.id }, options), "TIME_NOT_EXPIRED");
  now += 1;
  rejected(command(room, actors[1], {
    type: "show",
    handId: room.hand.id,
    show: true,
  }, options), "TIME_EXPIRED");

  const timeoutPayload = {
    type: "timeout",
    handId: room.hand.id,
    commandId: "show-timeout-idempotent",
    expectedRevision: room.revision,
  };
  const timedOut = applyOnlinePokerCommand(room, actors[0], timeoutPayload, options);
  room = accepted(timedOut);
  assert.equal(room.phase, "between_hands", "the first timeout only auto-mucks the unanswered choice");
  assert.equal(room.hand.number, 1);
  assert.equal(room.hand.pendingShowSeat, null);
  assert.equal(room.hand.showDecisionDeadlineAt, null);
  assert.equal(room.hand.nextHandAt, now + ONLINE_REVEALED_HAND_HOLD_MS);

  const duplicate = applyOnlinePokerCommand(room, actors[0], timeoutPayload, options);
  assert.equal(duplicate.ok, true);
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.state.revision, room.revision);

  now = room.hand.nextHandAt - 1;
  rejected(command(room, actors[0], { type: "timeout", handId: room.hand.id }, options), "TIME_NOT_EXPIRED");
  now += 1;
  room = accepted(command(room, actors[0], { type: "timeout", handId: room.hand.id }, options));
  assert.equal(room.phase, "playing", "the second deadline starts the next hand");
  assert.equal(room.hand.number, 2);
  assert.equal(room.hand.showDecisionDeadlineAt, null);
  assert.equal(room.hand.nextHandAt, null);
});

test("the shared next-hand deadline advances despite disconnected or unready seats", () => {
  let now = 5_000_000;
  let handNumber = 0;
  const options = {
    randomIndex: (maxExclusive) => maxExclusive - 1,
    makeHandId: () => `next-clock-${++handNumber}`,
    now: () => now,
  };
  let room = createOnlineRoom({ roomId: "next-clock-room", owner: actors[0], maxPlayers: 2 });
  room = joinPlayers(room, 2, options);
  room = accepted(command(room, actors[0], { type: "ready", ready: true }, options));
  room = accepted(command(room, actors[1], { type: "ready", ready: true }, options));
  room = accepted(command(room, actors[0], { type: "start" }, options));
  room = accepted(act(room, actors[0], "fold", options));
  room = accepted(command(room, actors[1], {
    type: "show",
    handId: room.hand.id,
    show: false,
  }, options));
  const completedHandId = room.hand.id;
  const nextHandAt = room.hand.nextHandAt;
  assert.equal(nextHandAt, now + ONLINE_NEXT_HAND_DELAY_MS);

  room = setOnlinePlayerConnection(room, actors[1].accountId, false, now + 10);
  room = accepted(command(room, actors[0], { type: "ready", ready: true }, options));
  assert.equal(room.seats.find((seat) => seat.seat === 1).ready, false);
  assert.equal(room.seats.find((seat) => seat.seat === 1).connected, false);

  now = nextHandAt - 1;
  rejected(command(room, actors[0], { type: "timeout", handId: completedHandId }, options), "TIME_NOT_EXPIRED");
  now += 1;
  room = accepted(command(room, actors[0], { type: "ready", ready: false }, options));
  assert.equal(room.phase, "between_hands", "explicitly becoming unready is not an advance command");
  const expectedRevision = room.revision;
  const advancePayload = {
    type: "timeout",
    handId: completedHandId,
    commandId: "advance-next-hand-once",
    expectedRevision,
  };
  const advanced = applyOnlinePokerCommand(room, actors[0], advancePayload, options);
  room = accepted(advanced);
  assert.equal(room.phase, "playing");
  assert.equal(room.hand.number, 2);
  assert.notEqual(room.hand.id, completedHandId);
  assert.equal(room.hand.nextHandAt, null);
  assert.ok(room.hand.players.some((player) => player.seat === 1), "disconnection preserves the player's seat");

  const duplicate = applyOnlinePokerCommand(room, actors[0], advancePayload, options);
  assert.equal(duplicate.ok, true);
  assert.equal(duplicate.duplicate, true);
  const losingRace = applyOnlinePokerCommand(room, actors[1], {
    ...advancePayload,
    commandId: "advance-next-hand-racer",
  }, options);
  rejected(losingRace, "STALE_REVISION");
  assert.equal(losingRace.state.hand.number, 2, "an optimistic race cannot deal a second extra hand");
});

test("manual show wins an optimistic race against a timeout without resolving twice", () => {
  const scenario = startRoom(2);
  let room = accepted(act(scenario.room, actors[0], "fold", scenario.options));
  const sharedRevision = room.revision;
  const handId = room.hand.id;
  const shown = applyOnlinePokerCommand(room, actors[1], {
    type: "show",
    handId,
    show: true,
    commandId: "manual-show-race",
    expectedRevision: sharedRevision,
  }, scenario.options);
  room = accepted(shown);
  assert.equal(room.phase, "between_hands");
  assert.equal(room.hand.players.find((player) => player.seat === 1).shown, true);

  const timeoutLoser = applyOnlinePokerCommand(room, actors[0], {
    type: "timeout",
    handId,
    commandId: "timeout-show-race",
    expectedRevision: sharedRevision,
  }, scenario.options);
  rejected(timeoutLoser, "STALE_REVISION");
  assert.equal(timeoutLoser.state.hand.players.find((player) => player.seat === 1).shown, true);
});

test("private peeks are viewer-isolated, idempotent, reconnect-safe and absent from public history", () => {
  const { room: started, options } = startRoom(3);
  const targetHole = structuredClone(started.hand.players.find((player) => player.seat === 1).hole);
  let room = accepted(act(started, actors[0], "fold", options));
  room = accepted(act(room, actors[1], "fold", options));
  assert.equal(room.phase, "between_hands");

  const before = {
    actionSeq: room.hand.actionSeq,
    recentActions: structuredClone(room.hand.recentActions),
    actionHistory: structuredClone(room.hand.actionHistory),
    pendingShowSeat: room.hand.pendingShowSeat,
    showDecisionDeadlineAt: room.hand.showDecisionDeadlineAt,
    nextHandAt: room.hand.nextHandAt,
    ready: room.seats.map((seat) => seat.ready),
    shown: room.hand.players.map((player) => player.shown),
    voluntaryShows: room.session.players.map((player) => player.voluntaryShows),
  };
  const initialViewer = projectRoomState(room, actors[0].accountId);
  assert.equal(initialViewer.hand.privatePeekLimit, ONLINE_PRIVATE_PEEK_LIMIT);
  assert.equal(initialViewer.hand.privatePeekRemaining, ONLINE_PRIVATE_PEEK_LIMIT);
  assert.deepEqual(initialViewer.hand.privatePeekedSeats, []);
  assert.equal(initialViewer.seats.find((seat) => seat.seat === 1).holeCards, null);

  const payload = {
    type: "peek",
    handId: room.hand.id,
    targetSeat: 1,
    commandId: "private-peek-idempotent",
    expectedRevision: room.revision,
  };
  const first = applyOnlinePokerCommand(room, actors[0], payload, options);
  room = accepted(first);
  assert.equal(room.revision, payload.expectedRevision + 1);
  assert.deepEqual(room.hand.privatePeekedSeatsByAccountId, { [actors[0].accountId]: [1] });

  const viewer = projectRoomState(room, actors[0].accountId);
  const otherViewer = projectRoomState(room, actors[2].accountId);
  const spectator = projectRoomState(room, null);
  assert.deepEqual(viewer.seats.find((seat) => seat.seat === 1).holeCards, targetHole);
  assert.equal(viewer.seats.find((seat) => seat.seat === 1).privatelyPeeked, true);
  assert.equal(viewer.hand.privatePeekRemaining, ONLINE_PRIVATE_PEEK_LIMIT - 1);
  assert.deepEqual(viewer.hand.privatePeekedSeats, [1]);
  assert.equal(
    viewer.handHistory[0].players.find((player) => player.seat === 1).holeCards,
    null,
    "a private peek must not unlock the public replay",
  );
  assert.equal(otherViewer.seats.find((seat) => seat.seat === 1).holeCards, null);
  assert.equal(otherViewer.seats.find((seat) => seat.seat === 1).privatelyPeeked, false);
  assert.equal(otherViewer.hand.privatePeekRemaining, ONLINE_PRIVATE_PEEK_LIMIT);
  assert.deepEqual(otherViewer.hand.privatePeekedSeats, []);
  assert.ok(spectator.seats.every((seat) => seat.holeCards === null));
  assert.equal(spectator.hand.privatePeekLimit, 0);
  assert.equal(spectator.hand.privatePeekRemaining, 0);
  assert.deepEqual(spectator.hand.privatePeekedSeats, []);
  assert.doesNotMatch(JSON.stringify(otherViewer), /privatePeekedSeatsByAccountId|user-[0-9]/);

  assert.equal(room.hand.actionSeq, before.actionSeq);
  assert.deepEqual(room.hand.recentActions, before.recentActions);
  assert.deepEqual(room.hand.actionHistory, before.actionHistory);
  assert.equal(room.hand.pendingShowSeat, before.pendingShowSeat);
  assert.equal(room.hand.showDecisionDeadlineAt, before.showDecisionDeadlineAt);
  assert.equal(room.hand.nextHandAt, before.nextHandAt);
  assert.deepEqual(room.seats.map((seat) => seat.ready), before.ready);
  assert.deepEqual(room.hand.players.map((player) => player.shown), before.shown);
  assert.deepEqual(room.session.players.map((player) => player.voluntaryShows), before.voluntaryShows);

  const duplicate = applyOnlinePokerCommand(room, actors[0], payload, options);
  assert.equal(duplicate.ok, true);
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.state.revision, room.revision);
  assert.equal(projectRoomState(duplicate.state, actors[0].accountId).hand.privatePeekRemaining, 4);
  rejected(applyOnlinePokerCommand(room, actors[0], {
    ...payload,
    targetSeat: 2,
  }, options), "COMMAND_ID_CONFLICT");

  room = setOnlinePlayerConnection(room, actors[0].accountId, false, 1_000_100);
  assert.deepEqual(projectRoomState(room, actors[0].accountId).seats.find((seat) => seat.seat === 1).holeCards, targetHole);
  room = setOnlinePlayerConnection(room, actors[0].accountId, true, 1_000_200);
  assert.deepEqual(projectRoomState(room, actors[0].accountId).seats.find((seat) => seat.seat === 1).holeCards, targetHole);
  assert.equal(projectRoomState(room, actors[0].accountId).hand.privatePeekRemaining, 4);
});

test("private peek validates phase, actor, hand and target without charging rejected requests", () => {
  const options = deterministicOptions();
  const lobby = createOnlineRoom({ roomId: "peek-errors-lobby", owner: actors[0], maxPlayers: 3 });
  rejected(command(lobby, actors[0], { type: "peek", handId: "none", targetSeat: 1 }, options), "PEEK_NOT_ALLOWED");

  const scenario = startRoom(3);
  rejected(command(scenario.room, actors[0], {
    type: "peek",
    handId: scenario.room.hand.id,
    targetSeat: 1,
  }, scenario.options), "PEEK_NOT_ALLOWED");

  let room = accepted(act(scenario.room, actors[0], "fold", scenario.options));
  room = accepted(act(room, actors[1], "fold", scenario.options));
  const revision = room.revision;
  rejected(command(room, actors[0], { type: "peek", handId: "wrong-hand", targetSeat: 1 }, scenario.options), "WRONG_HAND");
  rejected(command(room, actors[0], { type: "peek", handId: room.hand.id, targetSeat: 0 }, scenario.options), "PEEK_NOT_ALLOWED");
  rejected(command(room, actors[0], { type: "peek", handId: room.hand.id, targetSeat: 4 }, scenario.options), "PEEK_NOT_ALLOWED");
  rejected(command(room, actors[6], { type: "peek", handId: room.hand.id, targetSeat: 1 }, scenario.options), "NOT_A_MEMBER");
  rejected(command(room, actors[0], { type: "peek", handId: room.hand.id, targetSeat: -1 }, scenario.options), "INVALID_COMMAND");
  rejected(command(room, actors[0], { type: "peek", handId: room.hand.id, targetSeat: 6 }, scenario.options), "INVALID_COMMAND");
  rejected(command(room, actors[0], { type: "peek", handId: room.hand.id, targetSeat: 1.5 }, scenario.options), "INVALID_COMMAND");
  assert.equal(room.revision, revision);
  assert.deepEqual(room.hand.privatePeekedSeatsByAccountId, {});

  room = accepted(command(room, actors[0], { type: "peek", handId: room.hand.id, targetSeat: 1 }, scenario.options));
  const afterFirstPeek = room;
  const repeated = command(room, actors[0], { type: "peek", handId: room.hand.id, targetSeat: 1 }, scenario.options);
  rejected(repeated, "PEEK_ALREADY_VISIBLE");
  assert.equal(repeated.state, afterFirstPeek);
  assert.equal(projectRoomState(room, actors[0].accountId).hand.privatePeekRemaining, 4);

  rejected(command(room, actors[0], { type: "peek", handId: room.hand.id, targetSeat: 2 }, scenario.options), "PEEK_NOT_ALLOWED");
  room = accepted(command(room, actors[2], {
    type: "show",
    handId: room.hand.id,
    show: true,
  }, scenario.options));
  const ownerAfterPublicShow = projectRoomState(room, actors[0].accountId);
  const otherAfterPublicShow = projectRoomState(room, actors[1].accountId);
  assert.equal(ownerAfterPublicShow.seats.find((seat) => seat.seat === 2).privatelyPeeked, false);
  assert.ok(ownerAfterPublicShow.seats.find((seat) => seat.seat === 2).holeCards);
  assert.ok(otherAfterPublicShow.seats.find((seat) => seat.seat === 2).holeCards);
  assert.ok(ownerAfterPublicShow.hand.result.winnerDetails.find((winner) => winner.seat === 2).holeCards);
  assert.equal(ownerAfterPublicShow.hand.privatePeekRemaining, 4, "waiting for a show decision does not charge a peek");
  rejected(command(room, actors[0], { type: "peek", handId: room.hand.id, targetSeat: 2 }, scenario.options), "PEEK_ALREADY_VISIBLE");
});

test("each player gets five private peeks per hand and readiness cannot shorten their deadline", () => {
  const { room: started, options } = startRoom(6);
  let room = foldUntilSettlement(started, options);
  const pendingWinnerSeat = room.hand.pendingShowSeat;
  assert.notEqual(pendingWinnerSeat, null);
  room = accepted(command(room, actors[pendingWinnerSeat], {
    type: "show",
    handId: room.hand.id,
    show: false,
  }, options));
  const completedHandId = room.hand.id;
  const firstDeadline = room.hand.nextHandAt;
  const hiddenHoles = new Map(room.hand.players.map((player) => [player.seat, structuredClone(player.hole)]));
  assert.equal(projectRoomState(room, actors[0].accountId).hand.privatePeekRemaining, ONLINE_PRIVATE_PEEK_LIMIT);

  for (const targetSeat of [1, 2, 3, 4]) {
    room = accepted(command(room, actors[0], { type: "peek", handId: completedHandId, targetSeat }, options));
  }
  options.now = () => firstDeadline - 1;
  room = accepted(command(room, actors[0], { type: "peek", handId: completedHandId, targetSeat: 5 }, options));

  const privateView = projectRoomState(room, actors[0].accountId);
  assert.equal(privateView.hand.privatePeekRemaining, 0);
  assert.deepEqual(privateView.hand.privatePeekedSeats, [1, 2, 3, 4, 5]);
  for (const targetSeat of [1, 2, 3, 4, 5]) {
    assert.deepEqual(privateView.seats.find((seat) => seat.seat === targetSeat).holeCards, hiddenHoles.get(targetSeat));
    assert.equal(privateView.seats.find((seat) => seat.seat === targetSeat).privatelyPeeked, true);
  }
  const sixth = command(room, actors[0], { type: "peek", handId: completedHandId, targetSeat: 5 }, options);
  rejected(sixth, "PEEK_ALREADY_VISIBLE");
  assert.equal(sixth.state, room);
  assert.equal(projectRoomState(room, actors[0].accountId).hand.privatePeekRemaining, 0);
  const otherPlayerView = projectRoomState(room, actors[1].accountId);
  assert.deepEqual(otherPlayerView.hand.privatePeekedSeats, []);
  assert.equal(otherPlayerView.hand.privatePeekRemaining, ONLINE_PRIVATE_PEEK_LIMIT);
  assert.ok(otherPlayerView.seats.every((seat) => seat.seat === 1 || seat.holeCards === null));

  for (const actor of actors.slice(0, 6)) {
    room = accepted(command(room, actor, { type: "ready", ready: true }, options));
  }
  assert.equal(room.phase, "between_hands", "even all-ready cannot skip the private result window");
  assert.equal(room.hand.id, completedHandId);
  assert.equal(room.hand.nextHandAt, firstDeadline);

  options.now = () => firstDeadline;
  const expired = command(room, actors[0], { type: "peek", handId: completedHandId, targetSeat: 1 }, options);
  rejected(expired, "PEEK_NOT_ALLOWED");
  assert.equal(expired.state, room);
  room = accepted(command(room, actors[0], { type: "timeout", handId: completedHandId }, options));
  assert.equal(room.phase, "playing");
  assert.equal(room.hand.number, 2);
  assert.deepEqual(room.hand.privatePeekedSeatsByAccountId, {});

  room = foldUntilSettlement(room, options);
  const resetView = projectRoomState(room, actors[0].accountId);
  assert.equal(resetView.hand.privatePeekLimit, ONLINE_PRIVATE_PEEK_LIMIT);
  assert.equal(resetView.hand.privatePeekRemaining, ONLINE_PRIVATE_PEEK_LIMIT);
  assert.deepEqual(resetView.hand.privatePeekedSeats, []);
  assert.ok(resetView.seats.every((seat) => seat.seat === 0 || seat.holeCards === null));
});

test("a player who leaves during the hand remains a private-peek target for that result", () => {
  const { room: started, options } = startRoom(3);
  const departedHole = structuredClone(started.hand.players.find((player) => player.seat === 1).hole);
  let room = accepted(command(started, actors[1], { type: "leave" }, options));
  room = accepted(act(room, actors[0], "fold", options));
  assert.equal(room.phase, "between_hands");
  assert.equal(room.seats.some((seat) => seat.seat === 1), false);
  const pendingWinnerSeat = room.hand.pendingShowSeat;
  assert.notEqual(pendingWinnerSeat, null);
  room = accepted(command(room, actors[pendingWinnerSeat], {
    type: "show",
    handId: room.hand.id,
    show: false,
  }, options));

  const beforePeek = projectRoomState(room, actors[0].accountId);
  const departedTarget = beforePeek.hand.privatePeekTargets.find((target) => target.seat === 1);
  assert.equal(departedTarget.displayName, actors[1].displayName);
  assert.equal(departedTarget.holeCards, null);

  room = accepted(command(room, actors[0], {
    type: "peek",
    handId: room.hand.id,
    targetSeat: 1,
  }, options));
  const afterPeek = projectRoomState(room, actors[0].accountId);
  assert.deepEqual(
    afterPeek.hand.privatePeekTargets.find((target) => target.seat === 1).holeCards,
    departedHole,
  );
  assert.equal(
    projectRoomState(room, actors[2].accountId).hand.privatePeekTargets.find((target) => target.seat === 1).holeCards,
    null,
  );
});

test("legacy or malformed private-peek grants are normalized and never reveal active or invalid targets", () => {
  const active = startRoom(3);
  const dirtyActive = structuredClone(active.room);
  dirtyActive.hand.privatePeekedSeatsByAccountId = {
    [actors[0].accountId]: [0, 1, 99],
  };
  const projectedActive = projectRoomState(dirtyActive, actors[0].accountId);
  assert.deepEqual(projectedActive.hand.privatePeekedSeats, []);
  assert.equal(projectedActive.seats.find((seat) => seat.seat === 1).holeCards, null);
  const normalizedActive = setOnlinePlayerConnection(
    dirtyActive,
    actors[0].accountId,
    false,
    1_000_100,
  );
  assert.deepEqual(normalizedActive.hand.privatePeekedSeatsByAccountId, {});

  let settled = foldUntilSettlement(active.room, active.options);
  settled.hand.privatePeekedSeatsByAccountId = {
    [actors[0].accountId]: [0, 1, 2, 99],
  };
  const defensiveView = projectRoomState(settled, actors[0].accountId);
  assert.deepEqual(defensiveView.hand.privatePeekedSeats, [1]);
  assert.equal(defensiveView.seats.find((seat) => seat.seat === 0).privatelyPeeked, false);
  assert.equal(defensiveView.seats.find((seat) => seat.seat === 2).holeCards, null);
});

test("all players readying early preserve the full result window before auto-mucking", () => {
  const { room: started, options } = startRoom(2);
  let room = accepted(act(started, actors[0], "fold", options));
  const completedHandId = room.hand.id;
  const nextHandAt = room.hand.nextHandAt;
  assert.equal(room.hand.pendingShowSeat, 1);

  room = accepted(command(room, actors[0], { type: "ready", ready: true }, options));
  room = accepted(command(room, actors[1], { type: "ready", ready: true }, options));

  assert.equal(room.phase, "between_hands");
  assert.equal(room.hand.id, completedHandId);
  assert.equal(room.hand.pendingShowSeat, 1);

  options.now = () => nextHandAt;
  room = accepted(command(room, actors[0], { type: "timeout", handId: completedHandId }, options));
  assert.equal(room.phase, "playing");
  assert.equal(room.hand.number, 2);
  assert.notEqual(room.hand.id, completedHandId);
  assert.equal(room.session.players.find((player) => player.seat === 1).voluntaryShows, 0);
});

test("legacy completed states without phase clocks normalize without stalling", () => {
  let now = 7_000_000;
  let handNumber = 0;
  const options = {
    randomIndex: (maxExclusive) => maxExclusive - 1,
    makeHandId: () => `legacy-clock-${++handNumber}`,
    now: () => now,
  };
  let room = createOnlineRoom({ roomId: "legacy-clock-room", owner: actors[0], maxPlayers: 2 });
  room = joinPlayers(room, 2, options);
  room = accepted(command(room, actors[0], { type: "ready", ready: true }, options));
  room = accepted(command(room, actors[1], { type: "ready", ready: true }, options));
  room = accepted(command(room, actors[0], { type: "start" }, options));
  room = accepted(act(room, actors[0], "fold", options));
  const firstHandId = room.hand.id;
  room.phase = "showdown";
  delete room.hand.betweenHandsWaitCompleted;
  delete room.hand.showDecisionDeadlineAt;
  delete room.hand.nextHandAt;

  room = accepted(command(room, actors[0], { type: "timeout", handId: firstHandId }, options));
  assert.equal(room.phase, "playing", "a pre-clock showdown migrates, auto-mucks, and advances without stalling");
  assert.equal(room.hand.number, 2);
});

test("legacy reveal clocks migrate without extending or exceeding the shared twenty-second wait", () => {
  let now = 7_500_000;
  const options = {
    randomIndex: (maxExclusive) => maxExclusive - 1,
    makeHandId: (() => {
      let handNumber = 0;
      return () => `legacy-reveal-${++handNumber}`;
    })(),
    now: () => now,
  };
  let room = createOnlineRoom({ roomId: "legacy-reveal-room", owner: actors[0], maxPlayers: 2 });
  room = joinPlayers(room, 2, options);
  room = accepted(command(room, actors[0], { type: "ready", ready: true }, options));
  room = accepted(command(room, actors[1], { type: "ready", ready: true }, options));
  room = accepted(command(room, actors[0], { type: "start" }, options));
  room = accepted(act(room, actors[0], "fold", options));
  const completedHandId = room.hand.id;

  const migrateLegacyClock = (deadline) => {
    const legacyRoom = structuredClone(room);
    legacyRoom.phase = "showdown";
    legacyRoom.hand.showDecisionDeadlineAt = deadline;
    legacyRoom.hand.nextHandAt = null;
    delete legacyRoom.hand.betweenHandsWaitCompleted;
    return accepted(command(legacyRoom, actors[0], { type: "ready", ready: true }, options));
  };

  const shorterClock = migrateLegacyClock(now + 8_000);
  assert.equal(shorterClock.phase, "between_hands");
  assert.equal(shorterClock.hand.nextHandAt, now + 8_000, "migration never extends a saved in-flight deadline");

  room = migrateLegacyClock(now + 30_000);
  assert.equal(room.phase, "between_hands");
  assert.equal(ONLINE_NEXT_HAND_DELAY_MS, 20_000);
  assert.equal(room.hand.nextHandAt, now + ONLINE_NEXT_HAND_DELAY_MS);
  assert.equal(room.hand.showDecisionDeadlineAt, now + ONLINE_SHOW_DECISION_TIME_MS);
  now = room.hand.showDecisionDeadlineAt - 1;
  const beforeDeadline = command(room, actors[0], { type: "timeout", handId: completedHandId }, options);
  rejected(beforeDeadline, "TIME_NOT_EXPIRED");
  now += 1;
  room = accepted(command(room, actors[0], { type: "timeout", handId: completedHandId }, options));
  assert.equal(room.phase, "between_hands");
  assert.equal(room.hand.pendingShowSeat, null);
  now = room.hand.nextHandAt - 1;
  rejected(command(room, actors[0], { type: "timeout", handId: completedHandId }, options), "TIME_NOT_EXPIRED");
  now += 1;
  room = accepted(command(room, actors[0], { type: "timeout", handId: completedHandId }, options));
  assert.equal(room.phase, "playing");
  assert.equal(room.hand.number, 2);
});

test("a departing pending winner is auto-mucked and safely removed", () => {
  const { room: started, options } = startRoom(3);
  let room = accepted(act(started, actors[0], "fold", options));
  room = accepted(act(room, actors[1], "fold", options));
  assert.equal(room.phase, "between_hands");
  assert.equal(room.hand.pendingShowSeat, 2);

  room = accepted(command(room, actors[2], { type: "leave" }, options));
  assert.equal(room.phase, "between_hands");
  assert.equal(room.hand.pendingShowSeat, null);
  assert.equal(room.hand.players.find((player) => player.seat === 2).shown, false);
  assert.deepEqual(room.seats.map((seat) => seat.seat), [0, 1]);
  const hiddenWinner = projectRoomState(room, actors[0].accountId).hand.result.winnerDetails
    .find((winner) => winner.seat === 2);
  assert.equal(hiddenWinner.displayName, actors[2].displayName);
  assert.equal(hiddenWinner.holeCards, null, "a departed winner's mucked cards stay private");
});

test("starting the next hand never silently tops up a short stack", () => {
  const { room: started, options } = startRoom(2);
  let room = accepted(act(started, actors[0], "raise", options, 995));
  room = accepted(act(room, actors[1], "raise", options, 1000));
  room = accepted(act(room, actors[0], "fold", options));
  assert.deepEqual(room.seats.map((seat) => seat.stack), [5, 1995]);

  room = accepted(command(room, actors[1], {
    type: "show",
    handId: room.hand.id,
    show: false,
  }, options));
  room = accepted(command(room, actors[0], { type: "ready", ready: true }, options));
  room = accepted(command(room, actors[1], { type: "ready", ready: true }, options));

  assert.equal(room.phase, "between_hands", "readiness cannot skip the result window");
  const completedHandId = room.hand.id;
  const nextHandAt = room.hand.nextHandAt;
  options.now = () => nextHandAt;
  room = accepted(command(room, actors[0], { type: "timeout", handId: completedHandId }, options));

  assert.equal(room.phase, "between_hands");
  assert.deepEqual(room.hand.players.map((player) => player.contributed), [5, 5]);
  assert.equal(room.hand.result.totalPot, 10);
  const chipsInPlay = room.seats.reduce((sum, seat) => sum + seat.stack, 0);
  assert.equal(chipsInPlay, 2000);
});

test("two stacks all-in from the blinds run out without requiring an actor", () => {
  const { room } = startRoom(2, { stacks: [5, 5] });
  assert.equal(room.phase, "between_hands");
  assert.equal(room.hand.community.length, 5);
  assert.equal(room.hand.result.totalPot, 10);
  assert.equal(room.seats.reduce((sum, seat) => sum + seat.stack, 0), 10);
});

test("busted seats do not block funded players from readying the next hand", () => {
  const { room: active, options } = startRoom(3);
  const settled = foldUntilSettlement(active, options);
  let room = {
    ...settled,
    seats: settled.seats.map((seat) => ({
      ...seat,
      stack: seat.seat === 0 ? 0 : 500,
      ready: false,
    })),
  };
  room = accepted(command(room, actors[1], { type: "ready", ready: true }, options));
  assert.equal(room.phase, "between_hands");
  const nextHandAt = room.hand.nextHandAt;
  options.now = () => nextHandAt;
  room = accepted(command(room, actors[2], { type: "ready", ready: true }, options));
  assert.equal(room.phase, "playing");
  assert.deepEqual(room.hand.players.map((player) => player.seat), [1, 2]);
  assert.equal(room.hand.dealerSeat, 2, "the previous BB must not post the BB twice when play contracts to HU");
  assert.equal(room.hand.smallBlindSeat, 2);
  assert.equal(room.hand.bigBlindSeat, 1);
});

test("a completed heads-up tournament clears its phase clock instead of retrying forever", () => {
  const { room: active, options } = startRoom(2, {
    roomOptions: { tableMode: "tournament" },
  });
  const terminal = structuredClone(active);
  terminal.phase = "between_hands";
  terminal.seats[0].stack = 0;
  terminal.seats[1].stack = 2_000;
  terminal.hand.pendingShowSeat = null;
  terminal.hand.showDecisionDeadlineAt = null;
  terminal.hand.nextHandAt = 1_000_000;
  terminal.hand.result = {
    kind: "showdown",
    totalPot: 2_000,
    winnerSeats: [1],
    mainPotWinnerSeats: [1],
    payouts: [{ seat: 1, amount: 2_000 }],
    returns: [],
    handNames: [{ seat: 1, name: "一对" }],
  };

  const result = command(terminal, actors[0], {
    type: "timeout",
    handId: terminal.hand.id,
  }, options);
  const completed = accepted(result);
  assert.equal(completed.phase, "between_hands");
  assert.equal(completed.hand.id, terminal.hand.id);
  assert.equal(completed.hand.nextHandAt, null);
  assert.equal(projectRoomState(completed, actors[0].accountId).hand.nextHandAt, null);
});

test("only the owner can end a session and a queued finish keeps the shared post-hand window", () => {
  const { room: started, options } = startRoom(2, {
    roomOptions: { tableMode: "cash" },
  });
  rejected(command(started, actors[1], { type: "finish" }, options), "NOT_ROOM_OWNER");

  const finishPayload = {
    type: "finish",
    commandId: "finish-current-hand-once",
    expectedRevision: started.revision,
  };
  let room = accepted(applyOnlinePokerCommand(started, actors[0], finishPayload, options));
  assert.equal(room.phase, "playing");
  assert.equal(projectRoomState(room, actors[1].accountId).finishRequested, true);

  const duplicate = applyOnlinePokerCommand(room, actors[0], finishPayload, options);
  assert.equal(duplicate.ok, true);
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.state.revision, room.revision);

  room = accepted(act(room, actors[0], "fold", options));
  assert.equal(room.phase, "between_hands", "the reveal choice lives inside the shared post-hand wait");
  const nextHandAt = room.hand.nextHandAt;
  assert.equal(projectRoomState(room, actors[0].accountId).sessionReport, null);

  room = accepted(command(room, actors[1], {
    type: "show",
    handId: room.hand.id,
    show: false,
  }, options));
  assert.equal(room.phase, "between_hands", "manual muck cannot finish the session before the shared deadline");
  assert.equal(room.hand.nextHandAt, nextHandAt, "manual muck never restarts the post-hand clock");
  assert.equal(projectRoomState(room, actors[0].accountId).sessionReport, null);

  options.now = () => nextHandAt;
  room = accepted(command(room, actors[0], { type: "timeout", handId: room.hand.id }, options));
  assert.equal(room.phase, "finished");
  assert.equal(room.hand.nextHandAt, null);

  const ownerView = projectRoomState(room, actors[0].accountId);
  const guestView = projectRoomState(room, actors[1].accountId);
  assert.deepEqual(ownerView.sessionReport, guestView.sessionReport, "every member receives the same frozen public report");
  assert.equal(ownerView.sessionReport.handsCompleted, 1);
  assert.equal(ownerView.sessionReport.players.reduce((sum, player) => sum + player.netChips, 0), 0);
  assert.deepEqual(ownerView.sessionReport.players.map((player) => player.netChips).sort((a, b) => a - b), [-5, 5]);
  assert.doesNotMatch(JSON.stringify(ownerView.sessionReport), /user-[0-9]/, "authentication identities remain private");
  rejected(command(room, actors[0], { type: "ready", ready: true }, options), "WRONG_PHASE");
});

test("ending the session during the post-hand wait keeps its original deadline", () => {
  const { room: started, options } = startRoom(2, {
    roomOptions: { tableMode: "cash" },
  });
  let room = accepted(act(started, actors[0], "fold", options));
  const completedHandId = room.hand.id;
  const nextHandAt = room.hand.nextHandAt;

  room = accepted(command(room, actors[0], { type: "finish" }, options));
  assert.equal(room.phase, "between_hands");
  assert.equal(room.hand.nextHandAt, nextHandAt);
  assert.equal(room.session.finishRequestedByAccountId, actors[0].accountId);

  room = accepted(command(room, actors[1], {
    type: "show",
    handId: completedHandId,
    show: true,
  }, options));
  assert.equal(room.phase, "between_hands");
  assert.equal(room.hand.nextHandAt, nextHandAt, "showing cannot restart or shorten the shared wait");

  options.now = () => nextHandAt;
  room = accepted(command(room, actors[0], { type: "timeout", handId: completedHandId }, options));
  assert.equal(room.phase, "finished");
  assert.equal(projectRoomState(room, actors[1].accountId).sessionReport.handsCompleted, 1);
});

test("session report counts voluntary preflop money and postflop aggression from real actions", () => {
  const { room: started, options } = startRoom(2, {
    roomOptions: { tableMode: "cash" },
  });
  let room = accepted(act(started, actors[0], "call", options));
  room = accepted(act(room, actors[1], "check", options));
  assert.equal(room.hand.street, "flop");
  room = accepted(act(room, actors[1], "check", options));
  room = accepted(act(room, actors[0], "raise", options, 20));
  room = accepted(act(room, actors[1], "fold", options));
  room = accepted(command(room, actors[0], {
    type: "show",
    handId: room.hand.id,
    show: true,
  }, options));
  room = accepted(command(room, actors[0], { type: "finish" }, options));
  const nextHandAt = room.hand.nextHandAt;
  assert.equal(room.phase, "between_hands");
  options.now = () => nextHandAt;
  room = accepted(command(room, actors[0], { type: "timeout", handId: room.hand.id }, options));

  const report = projectRoomState(room, actors[0].accountId).sessionReport;
  const button = report.players.find((player) => player.seat === 0);
  const bigBlind = report.players.find((player) => player.seat === 1);
  assert.equal(button.handsDealt, 1);
  assert.equal(button.vpipPercent, 100, "calling beyond the small blind counts as VPIP");
  assert.equal(button.pfrPercent, 0);
  assert.equal(button.aggressionFrequencyPercent, 100, "the flop bet is a postflop aggressive action");
  assert.equal(button.voluntaryShows, 1);
  assert.equal(bigBlind.vpipPercent, 0, "posting and checking the big blind is not VPIP");
  assert.equal(bigBlind.checkActions, 2);
  assert.equal(bigBlind.foldActions, 1);
  assert.equal(bigBlind.aggressionFrequencyPercent, 0);
  assert.ok(report.players.every((player) => player.sampleSize === "insufficient"));
  assert.ok(report.players.every((player) => player.insights.some((insight) => insight.includes("样本不足"))));
});

test("owner can restart a finished room without changing its members or invitation state", () => {
  const { room: started, options } = startRoom(2, {
    roomOptions: {
      tableMode: "cash",
      startingStack: 2_000,
      initialTimeBankMs: 100_000,
    },
  });
  let room = accepted(command(started, actors[0], { type: "finish" }, options));
  assert.equal(room.phase, "playing", "finishing during a live hand is queued");
  room = accepted(act(room, actors[0], "fold", options));
  room = accepted(command(room, actors[1], { type: "show", handId: room.hand.id, show: false }, options));
  const nextHandAt = room.hand.nextHandAt;
  assert.equal(room.phase, "between_hands");
  options.now = () => nextHandAt;
  room = accepted(command(room, actors[0], { type: "timeout", handId: room.hand.id }, options));
  assert.equal(room.phase, "finished");

  rejected(command(room, actors[1], { type: "restart" }, options), "NOT_ROOM_OWNER");
  const roomId = room.roomId;
  const members = room.seats.map((seat) => seat.accountId);
  room = accepted(command(room, actors[0], { type: "restart" }, options));
  assert.equal(room.phase, "lobby");
  assert.equal(room.roomId, roomId);
  assert.equal(room.hand, null);
  assert.deepEqual(room.seats.map((seat) => seat.accountId), members);
  assert.deepEqual(room.seats.map((seat) => seat.stack), [2_000, 2_000]);
  assert.deepEqual(room.seats.map((seat) => seat.timeBankMs), [100_000, 100_000]);
  assert.ok(room.seats.every((seat) => seat.ready === false));
  assert.equal(room.session.handsCompleted, 0);
  assert.equal(projectRoomState(room, actors[0].accountId).sessionReport, null);
});

test("viewer projection exposes only their own or explicitly shown hole cards", () => {
  const { room } = startRoom(3);
  assert.ok(room.hand);
  const allPrivateCards = [
    ...room.hand.players.flatMap((player) => player.hole),
    ...room.hand.deck,
  ];
  assert.equal(allPrivateCards.length, 52);
  assert.equal(new Set(allPrivateCards.map((entry) => `${entry.rank}-${entry.suit}`)).size, 52);

  for (let viewer = 0; viewer < 3; viewer += 1) {
    const projected = projectRoomState(room, actors[viewer].accountId);
    assert.equal(projected.viewerSeat, viewer);
    projected.seats.forEach((seat) => {
      if (seat.seat === viewer) assert.ok(seat.holeCards);
      else assert.equal(seat.holeCards, null);
    });
    const serialized = JSON.stringify(projected);
    assert.doesNotMatch(serialized, /"deck"/);
    assert.doesNotMatch(serialized, /processedCommands/);
    assert.doesNotMatch(serialized, /hasTakenAction|fullRaiseHistory|pendingReturns/);
    assert.doesNotMatch(serialized, /user-[0-9]/, "stable authentication subjects stay server-private");
  }

  const spectator = projectRoomState(room, null);
  assert.equal(spectator.viewerSeat, null);
  assert.ok(spectator.seats.every((seat) => seat.holeCards === null));
  assert.equal(spectator.legalActions, null);
});

test("connection changes preserve seat and private hand for reconnect", () => {
  const { room } = startRoom(2);
  const originalHole = room.hand.players.find((player) => player.seat === 0).hole;
  const disconnected = setOnlinePlayerConnection(room, actors[0].accountId, false, 1234);
  assert.equal(disconnected.revision, room.revision + 1);
  assert.equal(disconnected.seats[0].connected, false);
  assert.equal(disconnected.seats[0].disconnectedAt, 1234);
  assert.deepEqual(projectRoomState(disconnected, actors[0].accountId).seats[0].holeCards, originalHole);

  const reconnected = setOnlinePlayerConnection(disconnected, actors[0].accountId, true, 5678);
  assert.equal(reconnected.seats[0].connected, true);
  assert.equal(reconnected.seats[0].disconnectedAt, null);
  assert.deepEqual(projectRoomState(reconnected, actors[0].accountId).seats[0].holeCards, originalHole);
});
