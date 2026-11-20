import test from "node:test";
import assert from "node:assert/strict";
import { parseTextBet } from "./telegram-bot.js";

test("chat accepts Russian text bets on colors, European numbers, and shorthand thousands", () => {
  assert.deepEqual(parseTextBet("1000 на красное"), { type: "color", value: "red", amount: 1_000 });
  assert.deepEqual(parseTextBet("1000 на чёрное"), { type: "color", value: "black", amount: 1_000 });
  assert.deepEqual(parseTextBet("5000 на 12"), { type: "number", value: 12, amount: 5_000 });
  assert.deepEqual(parseTextBet("2к на 36"), { type: "number", value: 36, amount: 2_000 });
  assert.deepEqual(parseTextBet("/bet 1000 0"), { type: "number", value: 0, amount: 1_000 });
});

test("unsupported chat bet targets are rejected", () => {
  assert.throws(() => parseTextBet("1000 на 37"), /число от 0 до 36/);
  assert.throws(() => parseTextBet("1000 на 1-3"), /число от 0 до 36/);
});
