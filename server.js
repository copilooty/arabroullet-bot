import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createWalletStore } from "./wallet-store.js";
import { startTelegramBot } from "./telegram-bot.js";

const projectDirectory = fileURLToPath(new URL(".", import.meta.url));
let localConfig = { BOT_TOKEN: "", ADMIN_IDS: [] };
try {
  localConfig = await import("./bot-config.js");
} catch (error) {
  if (error.code !== "ERR_MODULE_NOT_FOUND") throw error;
}

const botToken = (process.env.BOT_TOKEN || localConfig.BOT_TOKEN || "").trim();
if (!botToken || botToken === "PASTE_TOKEN_HERE") {
  throw new Error("Укажи BOT_TOKEN в переменных окружения или в bot-config.js.");
}

const dataDirectory = process.env.DATA_DIR || resolve(projectDirectory, "data");
const adminIds = process.env.ADMIN_IDS === undefined
  ? localConfig.ADMIN_IDS || []
  : process.env.ADMIN_IDS.split(",").map((id) => id.trim()).filter(Boolean);
const wallets = createWalletStore(resolve(dataDirectory, "wallets.json"));
console.log("Arabian Roulette Telegram bot is starting.");
startTelegramBot({ token: botToken, adminIds, wallets });
