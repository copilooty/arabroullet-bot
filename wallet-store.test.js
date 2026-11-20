import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWalletStore } from "./wallet-store.js";

const temporaryDirectory = mkdtempSync(join(tmpdir(), "arabian-roulette-test-"));
after(() => rmSync(temporaryDirectory, { recursive: true, force: true }));

test("new users receive the bonus and unaffordable bets do not change their balance", () => {
  const wallets = createWalletStore(join(temporaryDirectory, "wallets.json"));
  assert.equal(wallets.getBalance("123"), 10_000);
  assert.throws(
    () => wallets.play("123", { type: "number", value: 1, amount: 10_001 }),
    /Недостаточно монет/
  );
  assert.equal(wallets.getBalance("123"), 10_000);
});

test("updated balances persist when the store is reopened", () => {
  const filePath = join(temporaryDirectory, "persistent-wallets.json");
  const wallets = createWalletStore(filePath);
  const round = wallets.play("456", { type: "number", value: 0, amount: 100 });
  const reopenedWallets = createWalletStore(filePath);
  assert.equal(reopenedWallets.getBalance("456"), round.balance);
});

test("multiple chat bets use one result and debit the combined stake once", () => {
  const wallets = createWalletStore(join(temporaryDirectory, "combined-wallets.json"));
  const round = wallets.playBets("789", [
    { type: "range", from: 1, to: 3, amount: 50 },
    { type: "color", value: "red", amount: 25 }
  ]);
  assert.equal(round.totalStake, 75);
  assert.equal(round.balance, 10_000 - round.totalStake + round.payout);
  assert.equal(wallets.getBalance("789"), round.balance);
});

test("admin grants have no configured cap and reject unsafe balances", () => {
  const wallets = createWalletStore(join(temporaryDirectory, "admin-wallets.json"));
  const balance = wallets.grant("987", 1_000_000_000_000);
  assert.equal(balance, 1_000_000_010_000);
  assert.throws(() => wallets.grant("987", Number.MAX_SAFE_INTEGER), /безопасный предел/);
  assert.equal(wallets.getBalance("987"), balance);
});
