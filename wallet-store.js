import { randomInt } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { STARTING_BALANCE, settleBets, validateBet } from "./game-rules.js";

export function createWalletStore(filePath) {
  mkdirSync(dirname(filePath), { recursive: true });

  let wallets = {};
  try {
    wallets = JSON.parse(readFileSync(filePath, "utf8"));
    if (!wallets || typeof wallets !== "object" || Array.isArray(wallets)) {
      throw new TypeError("Wallet data must be a JSON object.");
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  function save() {
    const temporaryPath = `${filePath}.${process.pid}.tmp`;
    writeFileSync(temporaryPath, JSON.stringify(wallets), "utf8");
    renameSync(temporaryPath, filePath);
  }

  function ensureUser(userId) {
    const key = String(userId);
    if (!/^\d{1,20}$/.test(key)) throw new TypeError("Invalid user ID.");
    if (!Object.hasOwn(wallets, key)) {
      wallets[key] = STARTING_BALANCE;
      save();
    }
    return wallets[key];
  }

  function grant(userId, amount) {
    const key = String(userId);
    if (!/^\d{1,20}$/.test(key)) throw new TypeError("Некорректный ID игрока.");
    if (!Number.isSafeInteger(amount) || amount < 1) {
      throw new TypeError("Количество монет должно быть целым числом больше нуля.");
    }

    const updatedBalance = ensureUser(key) + amount;
    if (!Number.isSafeInteger(updatedBalance)) {
      throw new RangeError("Баланс превысит безопасный предел хранения числа.");
    }
    wallets[key] = updatedBalance;
    save();
    return updatedBalance;
  }

  function play(userId, inputBet) {
    const round = playBets(userId, [inputBet]);
    return { ...round.bets[0], balance: round.balance };
  }

  function playBets(userId, inputBets) {
    const key = String(userId);
    const balance = ensureUser(key);
    if (!Array.isArray(inputBets) || inputBets.length < 1 || inputBets.length > 20) {
      throw new TypeError("Добавь от 1 до 20 ставок.");
    }
    const bets = inputBets.map(validateBet);
    const totalStake = bets.reduce((sum, bet) => sum + bet.amount, 0);
    if (!Number.isSafeInteger(totalStake)) {
      throw new RangeError("Общая сумма ставок слишком большая.");
    }
    if (totalStake > balance) {
      throw new RangeError("Недостаточно монет для этой ставки.");
    }

    const round = settleBets(bets, randomInt(0, 13));
    const updatedBalance = balance - totalStake + round.payout;
    if (!Number.isSafeInteger(updatedBalance)) {
      throw new RangeError("Баланс после выигрыша слишком большой.");
    }
    wallets[key] = updatedBalance;
    save();
    return { ...round, balance: wallets[key] };
  }

  return {
    ensureUser,
    getBalance(userId) {
      return ensureUser(userId);
    },
    grant,
    play,
    playBets
  };
}
