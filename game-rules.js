export const STARTING_BALANCE = 10_000;
export const NUMBER_COUNT = 13;

export function colorFor(number) {
  if (!Number.isInteger(number) || number < 0 || number >= NUMBER_COUNT) {
    throw new RangeError("Number must be from 0 to 12.");
  }
  if (number === 0) return "green";
  return number % 2 === 1 ? "red" : "black";
}

export function validateBet(bet) {
  if (!bet || !Number.isSafeInteger(bet.amount) || bet.amount < 1) {
    throw new TypeError("Ставка должна быть целым числом больше нуля.");
  }

  if (bet.type === "range") {
    const groups = [[1, 3], [4, 6], [7, 9], [10, 12]];
    if (!groups.some(([from, to]) => bet.from === from && bet.to === to)) {
      throw new TypeError("Выбери один из диапазонов: 1–3, 4–6, 7–9 или 10–12.");
    }
    return { amount: bet.amount, type: bet.type, from: bet.from, to: bet.to };
  }

  if (bet.type === "number") {
    if (!Number.isInteger(bet.value) || bet.value < 0 || bet.value > 12) {
      throw new TypeError("Выбери число от 0 до 12.");
    }
    return { amount: bet.amount, type: bet.type, value: bet.value };
  }

  if (bet.type === "color" && (bet.value === "red" || bet.value === "black")) {
    return { amount: bet.amount, type: bet.type, value: bet.value };
  }

  throw new TypeError("Выбери число, красное или чёрное.");
}

export function settleBet(inputBet, result) {
  const bet = validateBet(inputBet);
  const resultColor = colorFor(result);
  const won = bet.type === "number" ? bet.value === result
    : bet.type === "range" ? result >= bet.from && result <= bet.to
      : bet.value === resultColor;

  const multiplier = bet.type === "color"
    ? 2
    : bet.type === "range" ? 4
    : bet.value === 0 ? 13 : 12;
  const payout = won ? bet.amount * multiplier : 0;
  if (!Number.isSafeInteger(payout)) {
    throw new RangeError("Размер выигрыша слишком большой.");
  }

  return {
    bet,
    result,
    color: resultColor,
    won,
    multiplier,
    payout
  };
}

export function settleBets(inputBets, result) {
  if (!Array.isArray(inputBets) || inputBets.length < 1 || inputBets.length > 20) {
    throw new TypeError("Добавь от 1 до 20 ставок.");
  }

  const bets = inputBets.map((bet) => settleBet(bet, result));
  const totalStake = bets.reduce((sum, bet) => sum + bet.bet.amount, 0);
  const payout = bets.reduce((sum, bet) => sum + bet.payout, 0);
  if (!Number.isSafeInteger(totalStake) || !Number.isSafeInteger(payout)) {
    throw new RangeError("Общая сумма ставок слишком большая.");
  }

  return {
    bets,
    result,
    color: colorFor(result),
    won: bets.some((bet) => bet.won),
    totalStake,
    payout
  };
}
