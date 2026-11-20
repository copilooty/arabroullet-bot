import { colorFor, validateBet } from "./game-rules.js";

const QUICK_STAKE = 1_000;
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export function parseTextBet(text) {
  const match = text.trim().match(/^(?:(?:\/bet(?:@\w+)?\s+))?(\d+)(к|k)?\s+(?:на\s+)?(.+)$/iu);
  if (!match) return null;

  const amount = Number(match[1]) * (match[2] ? 1_000 : 1);
  if (!Number.isSafeInteger(amount)) throw new TypeError("Сумма ставки слишком большая.");
  const selection = match[3].trim().toLowerCase().replace(/ё/g, "е");
  if (/^красн[а-я]*$/u.test(selection) || selection === "red") {
    return validateBet({ type: "color", value: "red", amount });
  }
  if (/^черн[а-я]*$/u.test(selection) || selection === "black") {
    return validateBet({ type: "color", value: "black", amount });
  }
  if (/^(?:[0-9]|[1-2][0-9]|3[0-6])$/u.test(selection)) {
    return validateBet({ type: "number", value: Number(selection), amount });
  }
  throw new TypeError("Ставь на красное, чёрное или число от 0 до 36.");
}

export function startTelegramBot({ token, adminIds = [], wallets }) {
  const gameStates = new Map();
  const pendingAdminActions = new Map();
  const admins = new Set(adminIds.map(String).filter((id) => /^\d{1,20}$/.test(id)));

  function isAdmin(userId) {
    return admins.has(String(userId));
  }

  async function callTelegram(method, body) {
    const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });
    const result = await response.json();
    if (!response.ok || !result.ok) {
      throw new Error(`Telegram ${method} failed: ${result.description || response.statusText}`);
    }
    return result.result;
  }

  function getState(userId) {
    const key = String(userId);
    if (!gameStates.has(key)) {
      gameStates.set(key, { bets: [], lastBets: [], lastRound: null, chatId: null, messageId: null });
    }
    return gameStates.get(key);
  }

  function colorName(color) {
    if (color === "red") return "красное 🔴";
    if (color === "black") return "чёрное ⚫";
    return "зелёное 💚";
  }

  function describeBet(bet) {
    if (bet.type === "number") {
      return bet.value === 0 ? "зелёное / 0" : `число ${bet.value}`;
    }
    return colorName(bet.value);
  }

  function formatGame(state, balance, playerName) {
    const numberLines = [];
    for (let first = 0; first <= 36; first += 13) {
      const last = Math.min(first + 12, 36);
      const entries = [];
      for (let number = first; number <= last; number += 1) {
        const color = colorFor(number) === "red" ? "🔴" : colorFor(number) === "black" ? "⚫" : "💚";
        entries.push(`${number}${color}`);
      }
      numberLines.push(entries.join("  "));
    }
    const lines = [
      "🎰 Минирулетка",
      "Европейская рулетка · числа 0–36",
      ...numberLines,
      "",
      "Ставки можно написать текстом:",
      "1000 на красное  |  5000 на 12",
      "",
      state.bets.length
        ? `Текущая ставка:\n${state.bets.map((bet) => `• ${bet.amount.toLocaleString("ru-RU")} на ${describeBet(bet)}`).join("\n")}\nВсего: ${state.bets.reduce((sum, bet) => sum + bet.amount, 0).toLocaleString("ru-RU")}`
        : "Сделайте ставку кнопкой или сообщением."
    ];

    if (state.lastRound) {
      const { result, color, payout, totalStake, balance: updatedBalance } = state.lastRound;
      const won = payout > 0;
      lines.push(
        "",
        `Последний результат: ${result} ${colorName(color)}.`,
        won
          ? `Выплата: ${payout.toLocaleString("ru-RU")} монет (ставки: ${totalStake.toLocaleString("ru-RU")}).`
          : `Ставка ${totalStake.toLocaleString("ru-RU")} монет не сыграла.`,
        `Баланс ${playerName}: ${updatedBalance.toLocaleString("ru-RU")} монет.`
      );
    } else {
      lines.push("", `Баланс ${playerName}: ${balance.toLocaleString("ru-RU")} монет.`);
    }

    lines.push("", "Выплаты: точное число ×36, красное/чёрное ×2. Ноль зелёный; цвет на ноль не выигрывает.");
    return lines.join("\n");
  }

  function gameKeyboard() {
    const rows = [
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
    ];
    return { inline_keyboard: rows };
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

  function menuKeyboard(userId) {
    const keyboard = [[{ text: "🎰 Рулетка" }], [{ text: "💰 Баланс" }, { text: "📖 Помощь" }]];
    if (isAdmin(userId)) keyboard.push([{ text: "⚙️ Админ" }]);
    return { keyboard, resize_keyboard: true };
  }

  async function sendGame(chatId, userId, playerName) {
    const state = getState(userId);
    const balance = wallets.getBalance(userId);
    const message = await callTelegram("sendMessage", {
      chat_id: chatId,
      text: formatGame(state, balance, playerName),
      reply_markup: gameKeyboard()
    });
    state.chatId = chatId;
    state.messageId = message.message_id;
  }

  async function refreshGame(chatId, userId, playerName) {
    const state = getState(userId);
    const balance = wallets.getBalance(userId);
    const text = formatGame(state, balance, playerName);
    if (state.chatId === chatId && state.messageId) {
      await callTelegram("editMessageText", {
        chat_id: chatId,
        message_id: state.messageId,
        text,
        reply_markup: gameKeyboard()
      });
      return;
    }
    await sendGame(chatId, userId, playerName);
  }

  function addBet(userId, inputBet) {
    const state = getState(userId);
    const bet = validateBet(inputBet);
    const total = state.bets.reduce((sum, current) => sum + current.amount, 0) + bet.amount;
    if (!Number.isSafeInteger(total)) throw new RangeError("Общая сумма ставок слишком большая.");
    if (total > wallets.getBalance(userId)) {
      throw new RangeError("Недостаточно монет. Уменьши ставку или нажми «Очистить ставки».");
    }
    state.bets.push(bet);
    return state;
  }

  async function sendMessage(chatId, text, replyMarkup) {
    await callTelegram("sendMessage", {
      chat_id: chatId,
      text,
      ...(replyMarkup ? { reply_markup: replyMarkup } : {})
    });
  }

  function parseAdminAmount(value) {
    if (!/^\d+$/.test(value)) throw new TypeError("Введи целое число монет больше нуля.");
    const amount = Number(value);
    if (!Number.isSafeInteger(amount) || amount < 1) {
      throw new TypeError("Сумма должна быть целым числом больше нуля.");
    }
    return amount;
  }

  async function showAdminPanel(chatId) {
    await sendMessage(
      chatId,
      "⚙️ Панель администратора\n\n" +
      "Выдавай виртуальные монеты игрокам без игрового лимита. Для хранения используется целое безопасное число.",
      adminKeyboard()
    );
  }

  async function processAdminMessage(message, text, command, userId, chatId) {
    const admin = isAdmin(userId);
    if (command === "/admin" || text.toLowerCase() === "⚙️ админ") {
      if (!admin) {
        await sendMessage(chatId, "Нет доступа к панели администратора.");
        return true;
      }
      pendingAdminActions.delete(String(userId));
      await showAdminPanel(chatId);
      return true;
    }

    if (command === "/give") {
      if (!admin) {
        await sendMessage(chatId, "Команда доступна только администратору.");
        return true;
      }
      const args = text.replace(/^\/give(?:@\w+)?\s*/i, "").trim().split(/\s+/);
      try {
        if (args.length === 1 && args[0]) {
          const amount = parseAdminAmount(args[0]);
          const balance = wallets.grant(userId, amount);
          await sendMessage(chatId, `Начислено тебе ${amount.toLocaleString("ru-RU")} монет.\nБаланс: ${balance.toLocaleString("ru-RU")}.`);
        } else if (args.length === 2 && /^\d{1,20}$/.test(args[0])) {
          const amount = parseAdminAmount(args[1]);
          const balance = wallets.grant(args[0], amount);
          await sendMessage(chatId, `Игроку ${args[0]} начислено ${amount.toLocaleString("ru-RU")} монет.\nБаланс: ${balance.toLocaleString("ru-RU")}.`);
        } else {
          await sendMessage(chatId, "Формат: /give ID_ИГРОКА СУММА или /give СУММА (себе).");
        }
      } catch (error) {
        await sendMessage(chatId, error.message);
      }
      return true;
    }

    if (!admin) return false;
    const action = pendingAdminActions.get(String(userId));
    if (!action || (text.startsWith("/") && command !== "/cancel")) return false;
    if (command === "/cancel") {
      pendingAdminActions.delete(String(userId));
      await sendMessage(chatId, "Действие отменено.");
      return true;
    }

    try {
      if (action === "grant-self") {
        const amount = parseAdminAmount(text);
        const balance = wallets.grant(userId, amount);
        pendingAdminActions.delete(String(userId));
        await sendMessage(chatId, `Начислено тебе ${amount.toLocaleString("ru-RU")} монет.\nБаланс: ${balance.toLocaleString("ru-RU")}.`);
        return true;
      }

      if (action === "grant-player") {
        const match = text.match(/^(\d{1,20})\s+(\d+)$/);
        if (!match) throw new TypeError("Отправь ID игрока и сумму, например: 123456789 1000000.");
        const amount = parseAdminAmount(match[2]);
        const balance = wallets.grant(match[1], amount);
        pendingAdminActions.delete(String(userId));
        await sendMessage(chatId, `Игроку ${match[1]} начислено ${amount.toLocaleString("ru-RU")} монет.\nБаланс: ${balance.toLocaleString("ru-RU")}.`);
        return true;
      }

      if (action === "balance") {
        if (!/^\d{1,20}$/.test(text)) throw new TypeError("Отправь числовой Telegram ID игрока.");
        const balance = wallets.getBalance(text);
        pendingAdminActions.delete(String(userId));
        await sendMessage(chatId, `Баланс игрока ${text}: ${balance.toLocaleString("ru-RU")} монет.`);
        return true;
      }
    } catch (error) {
      await sendMessage(chatId, error.message);
      return true;
    }
    return false;
  }

  function displayName(user) {
    const name = user.username ? `@${user.username}` : user.first_name || "Игрок";
    return String(name).replace(/[\r\n\u0000-\u001f]/g, " ").slice(0, 64);
  }

  async function handleMessage(message) {
    const userId = message.from?.id;
    const chatId = message.chat?.id;
    if (!userId || !chatId || typeof message.text !== "string") return;

    const text = message.text.trim();
    const command = text.split(/\s+/, 1)[0].split("@", 1)[0].toLowerCase();
    const playerName = displayName(message.from);
    if (await processAdminMessage(message, text, command, userId, chatId)) return;

    if (command === "/start") {
      const balance = wallets.getBalance(userId);
      await sendMessage(
        chatId,
        `Добро пожаловать, ${playerName}!\n\nБаланс ${playerName}: ${balance.toLocaleString("ru-RU")} виртуальных монет.\n` +
        "Напиши «Рулетка», чтобы открыть игру. Всем новым игрокам начисляется 10 000 виртуальных монет.",
        menuKeyboard(userId)
      );
      return;
    }

    if (command === "/balance" || text.toLowerCase() === "💰 баланс") {
      await sendMessage(chatId, `Баланс ${playerName}: ${wallets.getBalance(userId).toLocaleString("ru-RU")} виртуальных монет.`);
      return;
    }

    if (command === "/help" || text.toLowerCase() === "📖 помощь") {
      await sendMessage(
        chatId,
        "Добавляй ставки кнопками или текстом: 1000 на красное или 5000 на 12. Также доступны чёрное и числа 0–36.\n" +
        "Нажми «Крутить», чтобы запустить раунд. «Повторить» ставит прошлый набор, «Удвоить» удваивает текущий.\n" +
        "Выплаты: красное/чёрное ×2, точное число ×36 (включая 0). Выплата включает ставку.\n" +
        "Монеты виртуальные: их нельзя купить или вывести."
      );
      return;
    }

    if (command === "/roulette" || text.toLowerCase() === "рулетка" || text.toLowerCase() === "🎰 рулетка") {
      await sendGame(chatId, userId, playerName);
      return;
    }

    const directBet = parseTextBet(text);
    const slashBet = command === "/bet";
    if (directBet || slashBet) {
      try {
        const bet = directBet || parseTextBet(text);
        if (!bet) throw new TypeError("Формат: 1000 на красное, 5000 на 12 или /bet 1000 7.");
        addBet(userId, bet);
        await refreshGame(chatId, userId, playerName);
      } catch (error) {
        await sendMessage(chatId, error.message);
      }
    }
  }

  async function answerCallback(query, text, showAlert = false) {
    await callTelegram("answerCallbackQuery", {
      callback_query_id: query.id,
      ...(text ? { text, show_alert: showAlert } : {})
    });
  }

  async function handleCallback(query) {
    const userId = query.from?.id;
    const chatId = query.message?.chat?.id;
    if (!userId || !chatId || typeof query.data !== "string") return;

    if (query.data.startsWith("admin:")) {
      if (!isAdmin(userId)) {
        await answerCallback(query, "Нет доступа к панели администратора.");
        return;
      }
      const action = query.data.slice("admin:".length);
      const prompts = {
        "grant-player": ["grant-player", "Отправь ID игрока и сумму, например: 123456789 1000000."],
        "grant-self": ["grant-self", "Сколько монет начислить тебе? Введи целое число."],
        balance: ["balance", "Отправь числовой Telegram ID игрока."]
      };
      const prompt = prompts[action];
      if (!prompt) {
        await answerCallback(query, "Неизвестная команда панели.");
        return;
      }
      pendingAdminActions.set(String(userId), prompt[0]);
      await answerCallback(query);
      await sendMessage(chatId, `${prompt[1]}\nДля отмены напиши /cancel.`);
      return;
    }

    const state = getState(userId);
    const parts = query.data.split(":");
    let responseText = "";
    try {
      if (parts[0] === "bet" && parts[1] === "color" && parts.length === 3) {
        addBet(userId, { type: "color", value: parts[2], amount: QUICK_STAKE });
      } else if (parts[0] === "bet" && parts[1] === "number" && parts.length === 3) {
        addBet(userId, { type: "number", value: Number(parts[2]), amount: QUICK_STAKE });
      } else if (query.data === "repeat") {
        if (!state.lastBets.length) throw new TypeError("Сначала сыграй хотя бы один раунд.");
        const nextBets = state.lastBets.map((bet) => ({ ...bet }));
        const total = nextBets.reduce((sum, bet) => sum + bet.amount, 0);
        if (total > wallets.getBalance(userId)) throw new RangeError("На балансе недостаточно монет для повтора.");
        state.bets = nextBets;
      } else if (query.data === "double") {
        const sourceBets = state.bets.length ? state.bets : state.lastBets;
        if (!sourceBets.length) throw new TypeError("Сначала добавь ставку.");
        const nextBets = sourceBets.map((bet) => ({ ...bet, amount: bet.amount * 2 }));
        const total = nextBets.reduce((sum, bet) => sum + bet.amount, 0);
        if (!Number.isSafeInteger(total) || total > wallets.getBalance(userId)) {
          throw new RangeError("На балансе недостаточно монет для удвоения.");
        }
        state.bets = nextBets;
      } else if (query.data === "clear") {
        state.bets = [];
      } else if (query.data === "spin") {
        if (!state.bets.length) throw new TypeError("Сначала добавь ставку.");
        const round = wallets.playBets(userId, state.bets);
        state.lastBets = state.bets.map((bet) => ({ ...bet }));
        state.bets = [];
        state.lastRound = round;
      } else {
        throw new TypeError("Эта кнопка больше неактуальна. Открой игру заново.");
      }
    } catch (error) {
      responseText = error.message;
    }

    await answerCallback(query, responseText);
    if (!responseText) await refreshGame(chatId, userId, displayName(query.from));
  }

  async function handleUpdate(update) {
    if (update.message) await handleMessage(update.message);
    if (update.callback_query) await handleCallback(update.callback_query);
  }

  async function poll() {
    let offset = 0;
    while (true) {
      try {
        const updates = await callTelegram("getUpdates", {
          offset,
          timeout: 30,
          allowed_updates: ["message", "callback_query"]
        });
        for (const update of updates) {
          offset = update.update_id + 1;
          try {
            await handleUpdate(update);
          } catch (error) {
            console.error("Could not process Telegram update:", error);
          }
        }
      } catch (error) {
        console.error("Telegram bot polling failed; retrying:", error);
        await delay(5000);
      }
    }
  }

  void poll();
}
