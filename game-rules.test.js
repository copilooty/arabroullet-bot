import test from "node:test";
import assert from "node:assert/strict";
import { colorFor, settleBet, settleBets, validateBet } from "./game-rules.js";

test("number bets pay the published multiplier, with the largest payout on zero", () => {
  assert.equal(settleBet({ type: "number", value: 8, amount: 100 }, 8).payout, 1_200);
  assert.equal(settleBet({ type: "number", value: 0, amount: 100 }, 0).payout, 1_300);
});

test("color bets win on matching nonzero results only", () => {
  assert.equal(colorFor(7), "red");
  assert.equal(colorFor(8), "black");
  assert.equal(colorFor(0), "green");
  assert.equal(settleBet({ type: "color", value: "red", amount: 500 }, 7).payout, 1_000);
  assert.equal(settleBet({ type: "color", value: "red", amount: 500 }, 0).payout, 0);
});

test("range bets and combined bets settle against one shared result", () => {
  assert.equal(settleBet({ type: "range", from: 1, to: 3, amount: 100 }, 2).payout, 400);
  assert.equal(settleBet({ type: "range", from: 1, to: 3, amount: 100 }, 0).payout, 0);
  const round = settleBets([
    { type: "color", value: "red", amount: 100 },
    { type: "number", value: 3, amount: 100 }
  ], 3);
  assert.equal(round.totalStake, 200);
  assert.equal(round.payout, 1_400);
});

test("invalid stakes and selections are rejected", () => {
  assert.throws(() => validateBet({ type: "number", value: 13, amount: 10 }), /число/);
  assert.throws(() => validateBet({ type: "color", value: "green", amount: 10 }), /Выбери/);
  assert.throws(() => validateBet({ type: "number", value: 1, amount: 1.5 }), /целым числом/);
  assert.throws(() => validateBet({ type: "range", from: 1, to: 4, amount: 10 }), /диапазонов/);
});
