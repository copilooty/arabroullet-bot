import { settleBets, validateBet } from "./game-rules.js";
import { parseTextBet } from "./telegram-bot.js";

const STARTING_BALANCE = 10_000;
const MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER;

function isValidTelegramId(value) {
  return /^\d{1,20}$/.test(String(value));
}

function isValidWebhookSecret(request, expectedSecret) {
  const received = request.headers.get("X-Telegram-Bot-Api-Secret-Token") || "";
  if (!expectedSecret || received.length !== expectedSecret.length) return false;
  let difference = 0;
  for (let index = 0; index < expectedSecret.length; index += 1) {
    difference |= received.charCodeAt(index) ^ expectedSecret.charCodeAt(index);
  }
  return difference === 0;
}

function randomNumber() {
  const limit = 0x1_0000_0000 - (0x1_0000_0000 % 13);
  const buffer = new Uint32Array(1);
  do {
    crypto.getRandomValues(buffer);
  } while (buffer[0] >= limit);
  return buffer[0] % 13;
}

function adminIds(env) {
  return new Set(String(env.ADMIN_IDS || "").split(",").map((id) => id.trim()).filter(isValidTelegramId));
}

function defaultSession() {
  return { bets: [], lastBets: [], lastRound: null, chatId: null, messageId: null, adminAction: null };
}

async function loadSession(db, userId) {
  const row = await db.prepare(
    "SELECT bets_json, last_bets_json, last_round_json, chat_id, message_id, admin_action FROM sessions WHERE user_id = ?"
  ).bind(String(userId)).first();
  if (!row) return defaultSession();
  return {
    bets: JSON.parse(row.bets_json),
    lastBets: JSON.parse(row.last_bets_json),
    lastRound: row.last_round_json === null ? null : JSON.parse(row.last_round_json),
    chatId: row.chat_id,
    messageId: row.message_id,
    adminAction: row.admin_action
  };
}

async function saveSession(db, userId, state) {
  await db.prepare(`
    INSERT INTO sessions (user_id, bets_json, last_bets_json, last_round_json, chat_id, message_id, admin_action)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      bets_json = excluded.bets_json,
      last_bets_json = excluded.last_bets_json,
      last_round_json = excluded.last_round_json,
      chat_id = excluded.chat_id,
      message_id = excluded.message_id,
      admin_action = excluded.admin_action
  `).bind(
    String(userId),
    JSON.stringify(state.bets),
    JSON.stringify(state.lastBets),
    state.lastRound === null ? null : JSON.stringify(state.lastRound),
    state.chatId === null ? null : String(state.chatId),
    state.messageId,
    state.adminAction
  ).run();
}

async function getBalance(db, userId) {
  const key = String(userId);
  if (!isValidTelegramId(key)) throw new TypeError("Некорректный ID игрока.");
  await db.prepare("INSERT OR IGNORE INTO wallets (user_id, balance) VALUES (?, ?)").bind(key, STARTING_BALANCE).run();
  const wallet = await db.prepare("SELECT balance FROM wallets WHERE user_id = ?").bind(key).first();
  if (!wallet) throw new Error("Не удалось загрузить баланс игрока.");
  return Number(wallet.balance);
}

async function grantCoins(db, userId, amount) {
  const key = String(userId);
  if (!isValidTelegramId(key)) throw new TypeError("Некорректный ID игрока.");
  if (!Number.isSafeInteger(amount) || amount < 1) {
    throw new TypeError("Количество монет должно быть целым числом больше нуля.");
  }
  await getBalance(db, key);
  const wallet = await db.prepare(
    "UPDATE wallets SET balance = balance + ? WHERE user_id = ? AND balance <= ? RETURNING balance"
  ).bind(amount, key, MAX_SAFE_INTEGER - amount).first();
  if (!wallet) throw new RangeError("Баланс превысит безопасный предел хранения числа.");
  return Number(wallet.balance);
}

async function playBets(db, userId, inputBets) {
  const key = String(userId);
  const balance = await getBalance(db, key);
  if (!Array.isArray(inputBets) || inputBets.length < 1 || inputBets.length > 20) {
    throw new TypeError("Добавь от 1 до 20 ставок.");
  }
  const bets = inputBets.map(validateBet);
  const totalStake = bets.reduce((sum, bet) => sum + bet.amount, 0);
  if (!Number.isSafeInteger(totalStake)) throw new RangeError("Общая сумма ставок слишком большая.");
  if (totalStake > balance) throw new RangeError("Недостаточно монет для этой ставки.");

  const round = settleBets(bets, randomNumber());
  const wallet = await db.prepare(`
    UPDATE wallets
    SET balance = balance - ? + ?
    WHERE user_id = ? AND balance >= ?
    RETURNING balance
  `).bind(totalStake, round.payout, key, totalStake).first();
  if (!wallet) throw new RangeError("Баланс изменился — ставки не сделаны.");
  return { ...round, balance: Number(wallet.balance) };
}

async function telegram(env, method, payload) {
  const response = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  const result = await response.json();
  if (!response.ok || !result.ok) {
    throw new Error(`Telegram ${method} failed: ${result.description || response.statusText}`);
  }
  return result.result;
}

async function sendMessage(env, chatId, text, replyMarkup) {
  return telegram(env, "sendMessage", {
    chat_id: chatId,
    text,
    ...(replyMarkup ? { reply_markup: replyMarkup } : {})
  });
}

async function answerCallback(env, query, text) {
  await telegram(env, "answerCallbackQuery", {
    callback_query_id: query.id,
    ...(text ? { text } : {})
  });
}

function colorName(color) {
  if (color === "red") return "красное 🔴";
  if (color === "black") return "чёрное ⚫";
  return "зелёное 💚";
}

function describeBet(bet) {
  if (bet.type === "number") return `число ${bet.value}`;
  if (bet.type === "range") return `${bet.from}–${bet.to}`;
  return colorName(bet.value);
}

function formatGame(state, balance) {
  const lines = [
    "🎰 Минирулетка",
    "Угадайте число из:",
    "0💚  1🔴  2⚫  3🔴  4⚫  5🔴  6⚫",
    "7🔴  8⚫  9🔴  10⚫  11🔴  12⚫",
    "",
    "Ставки можно написать текстом:",
    "1000 на красное  |  5000 на 12  |  1000 на 1–3",
    "",
    state.bets.length
      ? `Текущая ставка:\n${state.bets.map((bet) => `• ${bet.amount.toLocaleString("ru-RU")} на ${describeBet(bet)}`).join("\n")}\nВсего: ${state.bets.reduce((sum, bet) => sum + bet.amount, 0).toLocaleString("ru-RU")}`
      : "Сделайте ставку кнопкой или сообщением."
  ];

  if (state.lastRound) {
    const { result, color, payout, totalStake, balance: updatedBalance } = state.lastRound;
    lines.push(
      "",
      `Последний результат: ${result} ${colorName(color)}.`,
      payout > 0
        ? `Выплата: ${payout.toLocaleString("ru-RU")} монет (ставки: ${totalStake.toLocaleString("ru-RU")}).`
        : `Ставка ${totalStake.toLocaleString("ru-RU")} монет не сыграла.`,
      `Баланс: ${updatedBalance.toLocaleString("ru-RU")} монет.`
    );
  } else {
    lines.push("", `Баланс: ${balance.toLocaleString("ru-RU")} монет.`);
  }

  lines.push("", "Выплаты: число ×12, диапазон ×4, цвет ×2, ноль ×13. Ставка включена в выплату.");
  return lines.join("\n");
}

function gameKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: "1 – 3", callback_data: "bet:range:1:3" },
        { text: "4 – 6", callback_data: "bet:range:4:6" },
        { text: "7 – 9", callback_data: "bet:range:7:9" },
        { text: "10 – 12", callback_data: "bet:range:10:12" }
      ],
      [
        { text: "1к на 🔴", callback_data: "bet:color:red" },
        { text: "1к на ⚫", callback_data: "bet:color:black" },
        { text: "1к на 0💚", callback_data: "bet:number:0" }
      ],
      [
        { text: "Повторить", callback_data: "repeat" },
        { text: "Удвоить", callback_data: "double" },
        { text: "Крутить", callback_data: "spin" }
      ],
      [{ text: "Очистить ставки", callback_data: "clear" }]
    ]
  };
}

function adminKeyboard() {
  return {
    inline_keyboard: [
      [{ text: "Выдать игроку", callback_data: "admin:grant-player" }],
      [{ text: "Выдать себе", callback_data: "admin:grant-self" }],
      [{ text: "Проверить баланс", callback_data: "admin:balance" }]
    ]
  };
}

function menuKeyboard(userId, admins) {
  const keyboard = [[{ text: "🎰 Рулетка" }], [{ text: "💰 Баланс" }, { text: "📖 Помощь" }]];
  if (admins.has(String(userId))) keyboard.push([{ text: "⚙️ Админ" }]);
  return { keyboard, resize_keyboard: true };
}

async function sendGame(env, state, chatId, userId) {
  const balance = await getBalance(env.DB, userId);
  const message = await sendMessage(env, chatId, formatGame(state, balance), gameKeyboard());
  state.chatId = chatId;
  state.messageId = message.message_id;
  await saveSession(env.DB, userId, state);
}

async function refreshGame(env, state, chatId, userId) {
  const balance = await getBalance(env.DB, userId);
  if (String(state.chatId) === String(chatId) && state.messageId) {
    await telegram(env, "editMessageText", {
      chat_id: chatId,
      message_id: state.messageId,
      text: formatGame(state, balance),
      reply_markup: gameKeyboard()
    });
    await saveSession(env.DB, userId, state);
    return;
  }
  await sendGame(env, state, chatId, userId);
}

async function addBet(env, state, userId, inputBet) {
  const bet = validateBet(inputBet);
  const total = state.bets.reduce((sum, current) => sum + current.amount, 0) + bet.amount;
  if (!Number.isSafeInteger(total)) throw new RangeError("Общая сумма ставок слишком большая.");
  if (total > await getBalance(env.DB, userId)) {
    throw new RangeError("Недостаточно монет. Уменьши ставку или нажми «Очистить ставки».");
  }
  state.bets.push(bet);
}

function isAdmin(userId, admins) {
  return admins.has(String(userId));
}

function parseAdminAmount(value) {
  if (!/^\d+$/.test(value)) throw new TypeError("Введи целое число монет больше нуля.");
  const amount = Number(value);
  if (!Number.isSafeInteger(amount) || amount < 1) {
    throw new TypeError("Сумма должна быть целым числом больше нуля.");
  }
  return amount;
}

async function processAdminMessage(env, state, text, command, userId, chatId, admins) {
  const admin = isAdmin(userId, admins);
  if (command === "/admin" || text.toLowerCase() === "⚙️ админ") {
    if (!admin) {
      await sendMessage(env, chatId, "Нет доступа к панели администратора.");
      return true;
    }
    state.adminAction = null;
    await saveSession(env.DB, userId, state);
    await sendMessage(
      env,
      chatId,
      "⚙️ Панель администратора\n\nВыдача не ограничена игровым лимитом.",
      adminKeyboard()
    );
    return true;
  }

  if (command === "/give") {
    if (!admin) {
      await sendMessage(env, chatId, "Команда доступна только администратору.");
      return true;
    }
    const args = text.replace(/^\/give(?:@\w+)?\s*/i, "").trim().split(/\s+/);
    try {
      if (args.length === 1 && args[0]) {
        const amount = parseAdminAmount(args[0]);
        const balance = await grantCoins(env.DB, userId, amount);
        await sendMessage(env, chatId, `Начислено тебе ${amount.toLocaleString("ru-RU")} монет.\nБаланс: ${balance.toLocaleString("ru-RU")}.`);
      } else if (args.length === 2 && isValidTelegramId(args[0])) {
        const amount = parseAdminAmount(args[1]);
        const balance = await grantCoins(env.DB, args[0], amount);
        await sendMessage(env, chatId, `Игроку ${args[0]} начислено ${amount.toLocaleString("ru-RU")} монет.\nБаланс: ${balance.toLocaleString("ru-RU")}.`);
      } else {
        await sendMessage(env, chatId, "Формат: /give ID_ИГРОКА СУММА или /give СУММА (себе).");
      }
    } catch (error) {
      await sendMessage(env, chatId, error.message);
    }
    return true;
  }

  if (!admin || !state.adminAction || (text.startsWith("/") && command !== "/cancel")) return false;
  if (command === "/cancel") {
    state.adminAction = null;
    await saveSession(env.DB, userId, state);
    await sendMessage(env, chatId, "Действие отменено.");
    return true;
  }

  try {
    if (state.adminAction === "grant-self") {
      const amount = parseAdminAmount(text);
      const balance = await grantCoins(env.DB, userId, amount);
      state.adminAction = null;
      await saveSession(env.DB, userId, state);
      await sendMessage(env, chatId, `Начислено тебе ${amount.toLocaleString("ru-RU")} монет.\nБаланс: ${balance.toLocaleString("ru-RU")}.`);
      return true;
    }
    if (state.adminAction === "grant-player") {
      const match = text.match(/^(\d{1,20})\s+(\d+)$/);
      if (!match) throw new TypeError("Отправь ID игрока и сумму, например: 123456789 1000000.");
      const amount = parseAdminAmount(match[2]);
      const balance = await grantCoins(env.DB, match[1], amount);
      state.adminAction = null;
      await saveSession(env.DB, userId, state);
      await sendMessage(env, chatId, `Игроку ${match[1]} начислено ${amount.toLocaleString("ru-RU")} монет.\nБаланс: ${balance.toLocaleString("ru-RU")}.`);
      return true;
    }
    if (state.adminAction === "balance") {
      if (!isValidTelegramId(text)) throw new TypeError("Отправь числовой Telegram ID игрока.");
      const balance = await getBalance(env.DB, text);
      state.adminAction = null;
      await saveSession(env.DB, userId, state);
      await sendMessage(env, chatId, `Баланс игрока ${text}: ${balance.toLocaleString("ru-RU")} монет.`);
      return true;
    }
  } catch (error) {
    await sendMessage(env, chatId, error.message);
    return true;
  }
  return false;
}

async function handleMessage(message, env) {
  const userId = message.from?.id;
  const chatId = message.chat?.id;
  if (!userId || !chatId || typeof message.text !== "string") return;
  const text = message.text.trim();
  const command = text.split(/\s+/, 1)[0].split("@", 1)[0].toLowerCase();
  const admins = adminIds(env);
  const state = await loadSession(env.DB, userId);

  if (await processAdminMessage(env, state, text, command, userId, chatId, admins)) return;
  if (command === "/start") {
    const balance = await getBalance(env.DB, userId);
    await sendMessage(
      env,
      chatId,
      `Добро пожаловать в Рулетку!\n\nМонеты: ${balance.toLocaleString("ru-RU")}\n` +
      "Напиши «Рулетка», чтобы открыть игру. Всем новым игрокам начисляется 10 000 виртуальных монет.",
      menuKeyboard(userId, admins)
    );
    return;
  }
  if (command === "/balance" || text.toLowerCase() === "💰 баланс") {
    const balance = await getBalance(env.DB, userId);
    await sendMessage(env, chatId, `Баланс: ${balance.toLocaleString("ru-RU")} виртуальных монет.`);
    return;
  }
  if (command === "/help" || text.toLowerCase() === "📖 помощь") {
    await sendMessage(
      env,
      chatId,
      "Добавляй ставки кнопками или текстом: 1000 на красное, 1000 на чёрное, 5000 на 12, 1000 на 1–3.\n" +
      "Нажми «Крутить», чтобы запустить раунд. «Повторить» ставит прошлый набор, «Удвоить» удваивает текущий.\n" +
      "Выплаты: цвет ×2, диапазон ×4, число 1–12 ×12, число 0 ×13. Выплата включает ставку.\n" +
      "Монеты виртуальные: их нельзя купить или вывести."
    );
    return;
  }
  if (command === "/roulette" || text.toLowerCase() === "рулетка" || text.toLowerCase() === "🎰 рулетка") {
    await sendGame(env, state, chatId, userId);
    return;
  }

  let directBet;
  try {
    directBet = parseTextBet(text);
  } catch (error) {
    await sendMessage(env, chatId, error.message);
    return;
  }
  if (!directBet && command !== "/bet") return;
  try {
    const bet = directBet || parseTextBet(text);
    if (!bet) throw new TypeError("Формат: 1000 на красное, 5000 на 12 или /bet 1000 7.");
    await addBet(env, state, userId, bet);
    await refreshGame(env, state, chatId, userId);
  } catch (error) {
    await sendMessage(env, chatId, error.message);
  }
}

async function handleCallback(query, env) {
  const userId = query.from?.id;
  const chatId = query.message?.chat?.id;
  if (!userId || !chatId || typeof query.data !== "string") return;
  const state = await loadSession(env.DB, userId);
  const admins = adminIds(env);

  if (query.data.startsWith("admin:")) {
    if (!isAdmin(userId, admins)) {
      await answerCallback(env, query, "Нет доступа к панели администратора.");
      return;
    }
    const actions = {
      "grant-player": ["grant-player", "Отправь ID игрока и сумму, например: 123456789 1000000."],
      "grant-self": ["grant-self", "Сколько монет начислить тебе? Введи целое число."],
      balance: ["balance", "Отправь числовой Telegram ID игрока."]
    };
    const prompt = actions[query.data.slice("admin:".length)];
    if (!prompt) {
      await answerCallback(env, query, "Неизвестная команда панели.");
      return;
    }
    state.adminAction = prompt[0];
    await saveSession(env.DB, userId, state);
    await answerCallback(env, query);
    await sendMessage(env, chatId, `${prompt[1]}\nДля отмены напиши /cancel.`);
    return;
  }

  let errorMessage = "";
  try {
    const parts = query.data.split(":");
    if (parts[0] === "bet" && parts[1] === "range" && parts.length === 4) {
      await addBet(env, state, userId, { type: "range", from: Number(parts[2]), to: Number(parts[3]), amount: 1_000 });
    } else if (parts[0] === "bet" && parts[1] === "color" && parts.length === 3) {
      await addBet(env, state, userId, { type: "color", value: parts[2], amount: 1_000 });
    } else if (parts[0] === "bet" && parts[1] === "number" && parts.length === 3) {
      await addBet(env, state, userId, { type: "number", value: Number(parts[2]), amount: 1_000 });
    } else if (query.data === "repeat") {
      if (!state.lastBets.length) throw new TypeError("Сначала сыграй хотя бы один раунд.");
      const nextBets = state.lastBets.map((bet) => ({ ...bet }));
      const total = nextBets.reduce((sum, bet) => sum + bet.amount, 0);
      if (total > await getBalance(env.DB, userId)) throw new RangeError("На балансе недостаточно монет для повтора.");
      state.bets = nextBets;
    } else if (query.data === "double") {
      const sourceBets = state.bets.length ? state.bets : state.lastBets;
      if (!sourceBets.length) throw new TypeError("Сначала добавь ставку.");
      const nextBets = sourceBets.map((bet) => ({ ...bet, amount: bet.amount * 2 }));
      const total = nextBets.reduce((sum, bet) => sum + bet.amount, 0);
      if (!Number.isSafeInteger(total) || total > await getBalance(env.DB, userId)) {
        throw new RangeError("На балансе недостаточно монет для удвоения.");
      }
      state.bets = nextBets;
    } else if (query.data === "clear") {
      state.bets = [];
    } else if (query.data === "spin") {
      if (!state.bets.length) throw new TypeError("Сначала добавь ставку.");
      const round = await playBets(env.DB, userId, state.bets);
      state.lastBets = state.bets.map((bet) => ({ ...bet }));
      state.bets = [];
      state.lastRound = round;
    } else {
      throw new TypeError("Эта кнопка больше неактуальна. Открой игру заново.");
    }
  } catch (error) {
    errorMessage = error.message;
  }

  await answerCallback(env, query, errorMessage);
  if (!errorMessage) await refreshGame(env, state, chatId, userId);
}

async function processUpdate(update, env) {
  const updateId = update.update_id;
  if (!Number.isSafeInteger(updateId)) return;
  const claim = await env.DB.prepare(
    "INSERT OR IGNORE INTO processed_updates (update_id, processed_at) VALUES (?, ?)"
  ).bind(updateId, Date.now()).run();
  if (claim.meta.changes === 0) return;

  try {
    if (update.message) await handleMessage(update.message, env);
    if (update.callback_query) await handleCallback(update.callback_query, env);
  } catch (error) {
    await env.DB.prepare("DELETE FROM processed_updates WHERE update_id = ?").bind(updateId).run();
    throw error;
  }
}

export { isValidWebhookSecret };

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/") {
      return new Response("Arabian Roulette bot is online.", { status: 200 });
    }
    if (url.pathname !== "/telegram") return new Response("Not found.", { status: 404 });
    if (request.method !== "POST") return new Response("Method not allowed.", { status: 405 });
    if (!isValidWebhookSecret(request, env.WEBHOOK_SECRET)) {
      return new Response("Unauthorized.", { status: 401 });
    }
    if (!env.BOT_TOKEN || !env.DB) return new Response("Worker is not configured.", { status: 503 });

    try {
      const update = await request.json();
      await processUpdate(update, env);
      return new Response("OK", { status: 200 });
    } catch (error) {
      console.error("Telegram webhook update failed:", error);
      return new Response("Update failed.", { status: 500 });
    }
  }
};
