import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  ONLINE_BIG_BLIND,
  ONLINE_COMMAND_RECEIPT_LIMIT,
  ONLINE_NEXT_HAND_DELAY_MS,
  ONLINE_SHOW_DECISION_TIME_MS,
  ONLINE_STARTING_STACK,
  applyOnlinePokerCommand,
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

function card(rank, suit) {
  return { rank, suit };
}

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

  assert.equal(room.phase, "showdown");
  assert.equal(room.hand.pendingShowSeat, 1);
  assert.equal(room.hand.players.find((player) => player.seat === 0).folded, true);
  assert.equal(room.seats.find((seat) => seat.seat === 0).pendingLeave, true);
  assert.equal(room.seats.find((seat) => seat.seat === 0).connected, false);
  assert.equal(room.ownerAccountId, actors[1].accountId, "ownership transfers before the pending seat is finalized");

  room = accepted(command(room, actors[1], {
    type: "show",
    handId: room.hand.id,
    show: false,
  }, options));
  assert.equal(room.phase, "lobby", "one remaining player returns to a joinable lobby");
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
  assert.equal(room.phase, "showdown");
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
  assert.equal(room.phase, "showdown");
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
  assert.equal(room.phase, "showdown");
  assert.deepEqual(room.hand.result.payouts, [{ seat: 1, amount: 20 }]);
  assert.deepEqual(room.hand.result.returns, [{ seat: 0, amount: 90 }]);
  assert.equal(room.hand.result.totalPot, 20);
  assert.equal(room.seats.find((seat) => seat.seat === 0).stack, 990);
  assert.equal(room.seats.find((seat) => seat.seat === 1).stack, 1_010);
  assert.equal(room.seats.reduce((sum, seat) => sum + seat.stack, 0), 2_000);
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
  assert.equal(room.phase, "showdown");
  assert.equal(room.hand.players.find((player) => player.seat === 0).folded, true);
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

  assert.equal(room.phase, "showdown");
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
  assert.equal(room.phase, "showdown");
  assert.equal(room.hand.pendingShowSeat, 1);
  assert.equal(room.hand.result.totalPot, 10);
  assert.deepEqual(room.hand.result.returns, [{ seat: 1, amount: 5 }]);
  assert.equal(projectRoomState(room, actors[0].accountId).seats[1].holeCards, null);

  room = accepted(command(room, actors[1], {
    type: "show",
    handId: room.hand.id,
    show: true,
  }, options));
  assert.equal(room.phase, "between_hands");
  assert.ok(projectRoomState(room, actors[0].accountId).seats[1].holeCards);

  room = accepted(command(room, actors[0], { type: "ready", ready: true }, options));
  room = accepted(command(room, actors[1], { type: "ready", ready: true }, options));
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

  assert.equal(room.phase, "showdown");
  assert.equal(room.hand.showDecisionDeadlineAt, now + ONLINE_SHOW_DECISION_TIME_MS);
  assert.equal(room.hand.nextHandAt, null);
  assert.equal(
    projectRoomState(room, actors[0].accountId).hand.showDecisionDeadlineAt,
    now + ONLINE_SHOW_DECISION_TIME_MS,
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
  assert.equal(room.phase, "between_hands");
  assert.equal(room.hand.pendingShowSeat, null);
  assert.equal(room.hand.players.find((player) => player.seat === 1).shown, false);
  assert.equal(room.hand.showDecisionDeadlineAt, null);
  assert.equal(room.hand.nextHandAt, now + ONLINE_NEXT_HAND_DELAY_MS);

  const duplicate = applyOnlinePokerCommand(room, actors[0], timeoutPayload, options);
  assert.equal(duplicate.ok, true);
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.state.revision, room.revision);
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
  delete room.hand.showDecisionDeadlineAt;
  delete room.hand.nextHandAt;

  room = accepted(command(room, actors[0], { type: "timeout", handId: firstHandId }, options));
  assert.equal(room.phase, "between_hands", "a pre-clock showdown is immediately auto-mucked on first timeout");
  assert.equal(room.hand.nextHandAt, now + ONLINE_NEXT_HAND_DELAY_MS);

  delete room.hand.nextHandAt;
  room = accepted(command(room, actors[1], { type: "timeout", handId: firstHandId }, options));
  assert.equal(room.phase, "playing", "a pre-clock between-hands state can immediately advance");
  assert.equal(room.hand.number, 2);
});

test("a departing pending winner is auto-mucked and safely removed", () => {
  const { room: started, options } = startRoom(3);
  let room = accepted(act(started, actors[0], "fold", options));
  room = accepted(act(room, actors[1], "fold", options));
  assert.equal(room.phase, "showdown");
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
  let room = {
    ...active,
    phase: "between_hands",
    seats: active.seats.map((seat) => ({
      ...seat,
      stack: seat.seat === 0 ? 0 : 500,
      ready: false,
    })),
  };
  room = accepted(command(room, actors[1], { type: "ready", ready: true }, options));
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
