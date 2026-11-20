# Arabian Roulette Telegram Bot

Chat-only Telegram roulette bot. It uses virtual coins that cannot be purchased or withdrawn.

## Rules

- Every new Telegram user receives 10,000 virtual coins.
- The server draws one result uniformly from 0–12.
- Numbers 1–12 alternate red and black; 0 is green.
- Exact number 1–12 pays 12×, exact 0 pays 13×, a three-number range pays 4×, and red/black pays 2×.
- A winning payout includes the stake. Losing stakes are deducted.
- No deposits, purchases, cash-outs, or real-money payments are implemented.

## Run on Windows

Requires Node.js 18 or newer.

```powershell
cd "C:\it\arabian roullet"
npm.cmd start
```

Before starting, open `bot-config.js` in the project folder and paste the token from **@BotFather** between the quotes. Add your numeric Telegram account ID to `ADMIN_IDS` in the same file:

```js
export const BOT_TOKEN = "PASTE_TOKEN_HERE";
export const ADMIN_IDS = ["YOUR_TELEGRAM_ID"];
```

Replace both placeholders with your values and save the file. Only IDs in `ADMIN_IDS` can open `/admin`. The panel can grant coins to you or a player, and check a player's balance. There is no configured grant cap; balances must stay within JavaScript's safe integer range. Keep the token secret. The file is excluded from Git so it is not accidentally committed. Keep the terminal open while the bot is running. Then send `/start` to your bot in Telegram and tap **🎰 Рулетка**.

## Play

Use the inline buttons to add 1,000-coin bets on ranges, colors, or zero. Then choose **Крутить**, **Повторить**, or **Удвоить**. Text bets are supported too: `1000 на красное`, `5000 на 12`, `1к на чёрное`, or `/bet 1000 7`. Use `/balance` for your wallet and `/help` for instructions. Admins can use `/admin` or `/give ID SUM` (`/give SUM` grants to themselves).

Run tests with:

```powershell
npm.cmd test
```

Wallets are stored in `data/wallets.json`. The JSON store is intended for a single-instance prototype. Keep your bot token secret.

## Deploy to Render

The project includes `render.yaml` for a single background worker and a persistent disk for wallet data. Push this folder to a GitHub repository, then in Render choose **New → Blueprint** and connect that repository. When prompted, set:

- `BOT_TOKEN` to the token from @BotFather.
- `ADMIN_IDS` to your numeric Telegram user ID.

Render's background worker and persistent disk require a paid service plan. The disk keeps player balances across restarts and deploys. Do not upload `bot-config.js`; it is excluded from Git.
