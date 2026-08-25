import assert from "node:assert/strict";
import test from "node:test";

import {
  analyzeMultiplayerDecision,
  multiplayerPreflopPosition,
} from "../lib/multiplayer-ai-coach.ts";

function player(accountId, seat, overrides = {}) {
  return {
    accountId,
    seat,
    stack: 1_000,
    committed: 0,
    streetCommitted: 0,
    status: "active",
    ...overrides,
  };
}

const headsUpPlayers = [
  player("hero", 5, { stack: 990, committed: 10 }),
  player("villain", 2, { stack: 980, committed: 20 }),
];

function checkedFlopInput(overrides = {}) {
  return {
    decisionId: "hand-17:flop:0:hero",
    heroAccountId: "hero",
    heroCards: [
      { rank: "A", suit: "s" },
      { rank: "A", suit: "h" },
    ],
    board: [
      { rank: "A", suit: "d" },
      { rank: 7, suit: "c" },
      { rank: 2, suit: "s" },
    ],
    street: "flop",
    pot: 30,
    currentBet: 0,
    bigBlind: 10,
    startingStack: 1_000,
    dealerSeat: 5,
    players: headsUpPlayers,
    recentActions: [],
    legalActions: {
      fold: false,
      check: true,
      callAmount: null,
      minRaiseTo: 20,
      maxRaiseTo: 990,
      raiseAllInOnly: false,
    },
    iterations: 120,
    ...overrides,
  };
}

test("produces deterministic analysis for the same public decision", () => {
  const input = checkedFlopInput();

  const first = analyzeMultiplayerDecision(input);
  const replay = analyzeMultiplayerDecision(input);

  assert.deepEqual(replay, first);
  assert.equal(first.decisionId, input.decisionId);
  assert.match(first.sourceNote, /公开信息/);
  assert.match(first.sourceNote, /不读取任何对手暗牌/);
});

test("normalizes action frequencies and only exposes executable actions and sizing", () => {
  const input = checkedFlopInput();
  const analysis = analyzeMultiplayerDecision(input);
  const legalKinds = new Set(["check", "raise"]);

  assert.ok(analysis.frequencies.length > 0);
  assert.ok(analysis.frequencies.every(({ action }) => legalKinds.has(action)));
  assert.ok(Math.abs(
    analysis.frequencies.reduce((sum, route) => sum + route.frequency, 0) - 1,
  ) < 1e-12);
  assert.ok(analysis.frequencies.every(({ frequency }) => frequency >= 0 && frequency <= 1));

  assert.ok(analysis.sizing.length > 0);
  assert.ok(analysis.sizing.every(({ target }) => (
    target >= input.legalActions.minRaiseTo
    && target <= input.legalActions.maxRaiseTo
  )));
  assert.ok(Math.abs(
    analysis.sizing.reduce((sum, route) => sum + route.frequency, 0) - 1,
  ) < 1e-12);

  // Tiny mixed routes remain visible and retain their original probability.
  const filteredMix = analyzeMultiplayerDecision({
    ...checkedFlopInput(),
    decisionId: "hand-17:flop:1:hero",
    heroCards: [
      { rank: "A", suit: "c" },
      { rank: 4, suit: "c" },
    ],
    board: [
      { rank: "J", suit: "h" },
      { rank: 8, suit: "c" },
      { rank: 3, suit: "d" },
    ],
    pot: 250,
    currentBet: 150,
    players: [
      player("hero", 5, { stack: 950, committed: 50 }),
      player("villain", 2, {
        stack: 800,
        committed: 200,
        streetCommitted: 150,
      }),
    ],
    recentActions: [{
      seq: 1,
      accountId: "villain",
      seat: 2,
      street: "flop",
      action: "raise",
      amount: 150,
      toAmount: 150,
      raiseTo: 150,
      potAfter: 250,
      stackAfter: 800,
    }],
    legalActions: {
      fold: true,
      check: false,
      callAmount: 150,
      minRaiseTo: 300,
      maxRaiseTo: 950,
      raiseAllInOnly: false,
    },
    iterations: 40,
  });
  assert.ok(Math.abs(
    filteredMix.frequencies.reduce((sum, route) => sum + route.frequency, 0) - 1,
  ) < 1e-12);
});

test("never recommends folding when checking is available", () => {
  const analysis = analyzeMultiplayerDecision(checkedFlopInput({
    decisionId: "hand-18:flop:0:hero",
    heroCards: [
      { rank: 7, suit: "s" },
      { rank: 2, suit: "h" },
    ],
    board: [
      { rank: "A", suit: "d" },
      { rank: "K", suit: "c" },
      { rank: "Q", suit: "s" },
    ],
    legalActions: {
      fold: true,
      check: true,
      callAmount: null,
      minRaiseTo: null,
      maxRaiseTo: null,
      raiseAllInOnly: false,
    },
  }));

  assert.equal(analysis.recommendedAction, "check");
  assert.equal(analysis.frequencies.find(({ action }) => action === "fold")?.frequency ?? 0, 0);
  assert.equal(analysis.frequencies.find(({ action }) => action === "check")?.frequency, 1);
});

test("a profitable terminal all-in call is never displayed as a pure fold", () => {
  const players = [
    player("hero", 5, {
      stack: 100,
      committed: 100,
      streetCommitted: 0,
    }),
    player("villain", 2, {
      stack: 0,
      committed: 200,
      streetCommitted: 100,
      status: "all-in",
    }),
  ];
  const analysis = analyzeMultiplayerDecision({
    decisionId: "hand-19:river:1:hero",
    heroAccountId: "hero",
    heroCards: [
      { rank: "A", suit: "s" },
      { rank: "A", suit: "h" },
    ],
    board: [
      { rank: "A", suit: "d" },
      { rank: "A", suit: "c" },
      { rank: "K", suit: "s" },
      { rank: "Q", suit: "h" },
      { rank: 2, suit: "d" },
    ],
    street: "river",
    pot: 300,
    currentBet: 100,
    bigBlind: 10,
    startingStack: 1_000,
    dealerSeat: 5,
    players,
    recentActions: [{
      seq: 1,
      accountId: "villain",
      seat: 2,
      street: "river",
      action: "raise",
      amount: 100,
      toAmount: 100,
      raiseTo: 100,
      potAfter: 300,
      stackAfter: 0,
    }],
    legalActions: {
      fold: true,
      check: false,
      callAmount: 100,
      minRaiseTo: null,
      maxRaiseTo: null,
      raiseAllInOnly: false,
    },
    iterations: 80,
  });

  const callFrequency = analysis.frequencies.find(({ action }) => action === "call")?.frequency ?? 0;
  const foldFrequency = analysis.frequencies.find(({ action }) => action === "fold")?.frequency ?? 0;
  assert.ok(analysis.equity > analysis.potOdds + 0.025);
  assert.equal(analysis.recommendedAction, "call");
  assert.ok(callFrequency > 0);
  assert.ok(foldFrequency < 1);
  assert.match(analysis.factors.join(" "), /跟注后无后续决策/);
});

test("maps heads-up and full six-max occupied seats to poker positions", () => {
  const headsUp = [player("button", 5), player("blind", 2)];
  assert.equal(multiplayerPreflopPosition(5, 5, headsUp), "SB");
  assert.equal(multiplayerPreflopPosition(2, 5, headsUp), "BB");

  const sixMax = Array.from({ length: 6 }, (_, seat) => player(`p${seat}`, seat));
  assert.deepEqual(
    sixMax.map(({ seat }) => multiplayerPreflopPosition(seat, 5, sixMax)),
    ["SB", "BB", "UTG", "HJ", "CO", "BTN"],
  );
});

test("maps eight and ten-handed extra early seats to a conservative UTG family", () => {
  const eightMax = Array.from({ length: 8 }, (_, seat) => player(`e${seat}`, seat));
  assert.deepEqual(
    eightMax.map(({ seat }) => multiplayerPreflopPosition(seat, 7, eightMax)),
    ["SB", "BB", "UTG", "UTG", "UTG", "HJ", "CO", "BTN"],
  );

  const tenMax = Array.from({ length: 10 }, (_, seat) => player(`t${seat}`, seat));
  assert.deepEqual(
    tenMax.map(({ seat }) => multiplayerPreflopPosition(seat, 9, tenMax)),
    ["SB", "BB", "UTG", "UTG", "UTG", "UTG", "UTG", "HJ", "CO", "BTN"],
  );
});

test("keeps the dealer, blinds and late positions correct when ten-max wraps at seat nine", () => {
  const players = Array.from({ length: 10 }, (_, seat) => player(`p${seat}`, seat));
  assert.equal(multiplayerPreflopPosition(8, 8, players), "BTN");
  assert.equal(multiplayerPreflopPosition(9, 8, players), "SB");
  assert.equal(multiplayerPreflopPosition(0, 8, players), "BB");
  assert.equal(multiplayerPreflopPosition(7, 8, players), "CO");
  assert.equal(multiplayerPreflopPosition(6, 8, players), "HJ");
  assert.equal(multiplayerPreflopPosition(1, 8, players), "UTG");
});

test("uses actual postflop position for blind three-bet sizing", () => {
  const analysis = analyzeMultiplayerDecision({
    decisionId: "hand-20:preflop:1:hero",
    heroAccountId: "hero",
    heroCards: [
      { rank: "A", suit: "s" },
      { rank: "A", suit: "h" },
    ],
    board: [],
    street: "preflop",
    pot: 40,
    currentBet: 25,
    bigBlind: 10,
    startingStack: 1_000,
    dealerSeat: 5,
    players: [
      player("hero", 1, { stack: 990, committed: 10, streetCommitted: 10 }),
      player("button", 5, { stack: 975, committed: 25, streetCommitted: 25 }),
    ],
    recentActions: [{
      seq: 1,
      accountId: "button",
      seat: 5,
      street: "preflop",
      action: "raise",
      amount: 25,
      toAmount: 25,
      raiseTo: 25,
      potAfter: 40,
      stackAfter: 975,
    }],
    legalActions: {
      fold: true,
      check: false,
      callAmount: 15,
      minRaiseTo: 40,
      maxRaiseTo: 1_000,
      raiseAllInOnly: false,
    },
    iterations: 80,
  });

  assert.equal(analysis.position, "BB");
  assert.equal(analysis.inPosition, false, "BB 对 BTN 翻后应当无位置");
  assert.ok(analysis.sizing.some(({ target }) => target >= 100), JSON.stringify(analysis.sizing));
});

test("ignores all-in seats when deciding who acts last postflop", () => {
  const analysis = analyzeMultiplayerDecision({
    ...checkedFlopInput(),
    decisionId: "hand-20:flop:1:hero",
    heroAccountId: "hero",
    dealerSeat: 5,
    pot: 300,
    players: [
      player("villain", 0, { stack: 900, committed: 100 }),
      player("hero", 4, { stack: 900, committed: 100 }),
      player("button", 5, {
        stack: 0,
        committed: 100,
        status: "all-in",
      }),
    ],
    recentActions: [{
      seq: 1,
      accountId: "villain",
      seat: 0,
      street: "flop",
      action: "check",
      amount: 0,
      toAmount: 0,
      raiseTo: null,
      potAfter: 300,
      stackAfter: 900,
    }],
    legalActions: {
      fold: false,
      check: true,
      callAmount: null,
      minRaiseTo: 20,
      maxRaiseTo: 900,
      raiseAllInOnly: false,
    },
    iterations: 60,
  });

  assert.equal(analysis.inPosition, true);
  assert.match(analysis.factors[0], /有位置/);
});
