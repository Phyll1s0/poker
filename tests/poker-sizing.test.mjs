import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPokerSizingRoutes,
  formatPokerSizingRoute,
  legalPokerRaiseTarget,
  pokerRaiseFraction,
  pokerRaiseTargetForFraction,
  preferredPokerSizingRoute,
  scorePokerRaiseSize,
} from "../lib/poker-sizing.ts";

const postflop = {
  street: "flop",
  pot: 100,
  toCall: 0,
  highestBet: 0,
  playerBet: 0,
  playerStack: 500,
  minRaise: 10,
  bigBlind: 10,
  preflopRaiseCount: 1,
};

test("uses ordinary pot fractions when checked to", () => {
  assert.equal(pokerRaiseFraction(postflop, 50), 0.5);
  assert.equal(pokerRaiseTargetForFraction(postflop, 0.5), 50);
  const route = { target: 50, fraction: 0.5, frequency: 1, allIn: false };
  assert.equal(formatPokerSizingRoute(postflop, route), "下注至 50（底池 50%）");
});

test("uses the pot after calling for a raise over a bet", () => {
  const facingBet = {
    ...postflop,
    pot: 150,
    toCall: 50,
    highestBet: 50,
    minRaise: 50,
  };
  assert.equal(pokerRaiseTargetForFraction(facingBet, 0.5), 150);
  assert.equal(pokerRaiseFraction(facingBet, 150), 0.5);
  const route = { target: 150, fraction: 0.5, frequency: 1, allIn: false };
  assert.equal(formatPokerSizingRoute(facingBet, route), "加注至 150（跟注后底池 50%）");
});

test("formats preflop sizes in big blinds rather than pot percentages", () => {
  const preflop = {
    ...postflop,
    street: "preflop",
    pot: 15,
    toCall: 10,
    highestBet: 10,
    minRaise: 10,
    playerStack: 990,
    preflopRaiseCount: 0,
  };
  const routes = buildPokerSizingRoutes(preflop, 25);
  assert.equal(formatPokerSizingRoute(preflop, routes[0]), "开池至 25（2.5 BB）");
  assert.equal(formatPokerSizingRoute(preflop, routes[1]), "开池至 30（3 BB）");
  assert.equal(routes.reduce((sum, route) => sum + route.frequency, 0), 1);

  const threeBet = { ...preflop, preflopRaiseCount: 1 };
  const threeBetRoute = { target: 75, fraction: 0.5, frequency: 1, allIn: false };
  assert.equal(formatPokerSizingRoute(threeBet, threeBetRoute), "3bet 至 75（7.5 BB）");
});

test("clamps requested sizes to the legal minimum and stack cap", () => {
  const context = { ...postflop, highestBet: 40, toCall: 40, minRaise: 40, playerStack: 130 };
  assert.equal(legalPokerRaiseTarget(context, 45), 80);
  assert.equal(legalPokerRaiseTarget(context, 500), 130);
});

test("includes an all-in branch when the policy mixes short-stack jams", () => {
  const context = { ...postflop, pot: 300, playerStack: 180 };
  const routes = buildPokerSizingRoutes(context, 100, 0.65);
  assert.deepEqual(routes.map((route) => route.target), [100, 180]);
  assert.equal(routes[1].allIn, true);
  assert.equal(routes.reduce((sum, route) => sum + route.frequency, 0), 1);
  assert.equal(preferredPokerSizingRoute(routes), routes[1]);
});

test("size scoring rewards exact and nearby routes over a doubled size", () => {
  const routes = buildPokerSizingRoutes(postflop, 50);
  const exact = scorePokerRaiseSize(postflop, 50, routes);
  const nearby = scorePokerRaiseSize(postflop, 60, routes);
  const doubled = scorePokerRaiseSize(postflop, 100, routes);
  assert.ok(exact > nearby);
  assert.ok(nearby > doubled);
});
