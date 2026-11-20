import test from "node:test";
import assert from "node:assert/strict";
import { parseTextBet } from "./telegram-bot.js";

test("chat accepts Russian text bets on a color, number, range, and shorthand thousands", () => {
  assert.deepEqual(parseTextBet("1000 на красное"), { type: "color", value: "red", amount: 1_000 });
  assert.deepEqual(parseTextBet("1000 на чёрное"), { type: "color", value: "black", amount: 1_000 });
  assert.deepEqual(parseTextBet("5000 на 12"), { type: "number", value: 12, amount: 5_000 });
  assert.deepEqual(parseTextBet("1к на 1-3"), { type: "range", from: 1, to: 3, amount: 1_000 });
  assert.deepEqual(parseTextBet("/bet 1000 0"), { type: "number", value: 0, amount: 1_000 });
});

test("unsupported chat bet targets are rejected", () => {
  assert.throws(() => parseTextBet("1000 на 13"), /число 0–12/);
  assert.throws(() => parseTextBet("1000 на 2-4"), /диапазонов/);
});
