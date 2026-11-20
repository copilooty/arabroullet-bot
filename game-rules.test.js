import test from "node:test";
import assert from "node:assert/strict";
import { colorFor, settleBet, settleBets, validateBet } from "./game-rules.js";

test("European roulette straight-up bets pay 36x the stake, including zero", () => {
  assert.equal(settleBet({ type: "number", value: 12, amount: 100 }, 12).payout, 3_600);
  assert.equal(settleBet({ type: "number", value: 0, amount: 100 }, 0).payout, 3_600);
});

test("European wheel colors follow the standard single-zero roulette layout", () => {
  assert.equal(colorFor(1), "red");
  assert.equal(colorFor(2), "black");
  assert.equal(colorFor(3), "red");
  assert.equal(colorFor(12), "red");
  assert.equal(colorFor(13), "black");
  assert.equal(colorFor(36), "red");
  assert.equal(colorFor(0), "green");
  assert.equal(settleBet({ type: "color", value: "red", amount: 500 }, 7).payout, 1_000);
  assert.equal(settleBet({ type: "color", value: "red", amount: 500 }, 0).payout, 0);
});

test("combined bets settle against one shared result", () => {
  const round = settleBets([
    { type: "color", value: "red", amount: 100 },
    { type: "number", value: 12, amount: 100 }
  ], 12);
  assert.equal(round.totalStake, 200);
  assert.equal(round.payout, 3_800);
});

test("invalid stakes and selections are rejected", () => {
  assert.throws(() => validateBet({ type: "number", value: 37, amount: 10 }), /число/);
  assert.throws(() => validateBet({ type: "color", value: "green", amount: 10 }), /Выбери/);
  assert.throws(() => validateBet({ type: "number", value: 1, amount: 1.5 }), /целым числом/);
});
