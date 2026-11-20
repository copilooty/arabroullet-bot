# Arabian Roulette Telegram Bot

Chat-only Telegram roulette bot with virtual coins. The Cloudflare version uses Telegram webhooks and D1, so it does not need a continuously running server or persistent disk.

## Rules

- Every new Telegram user receives 10,000 virtual coins.
- The server draws one result uniformly from 0–12.
- Numbers 1–12 alternate red and black; 0 is green.
- Exact number 1–12 pays 12×, exact 0 pays 13×, a three-number range pays 4×, and red/black pays 2×.
- A winning payout includes the stake. Losing stakes are deducted.
- No deposits, purchases, cash-outs, or real-money payments are implemented.

## Deploy to Cloudflare Workers + D1

The Cloudflare Workers Free plan currently includes up to 100,000 Worker requests per day. D1 has separate daily read/write and storage limits. The bot uses one incoming Worker request per Telegram update.

Requires Node.js and an account at Cloudflare. In a terminal opened in this project folder:

1. Log in to Cloudflare:

   ```sh
   npx wrangler login
   ```

2. Create the D1 database and copy the returned database ID:

   ```sh
   npx wrangler d1 create arabian-roulette-bot
   ```

3. Open `wrangler.jsonc` and replace `REPLACE_WITH_D1_DATABASE_ID` with that ID.
4. Create the tables in the remote D1 database:

   ```sh
   npx wrangler d1 migrations apply arabian-roulette-bot --remote
   ```

5. Add secrets. Wrangler prompts for each value; do not put secrets in this repository:

   ```sh
   npx wrangler secret put BOT_TOKEN
   npx wrangler secret put ADMIN_IDS
   npx wrangler secret put WEBHOOK_SECRET
   ```

   `BOT_TOKEN` comes from **@BotFather**. `ADMIN_IDS` is the admin's numeric Telegram ID. `WEBHOOK_SECRET` should be a private random string using only letters, numbers, `_`, or `-`.

6. Deploy the Worker:

   ```sh
   npx wrangler deploy
   ```

7. Register the Telegram webhook. Run the PowerShell helper and enter the Worker URL, bot token, and the same webhook secret when prompted:

   ```powershell
   .\deploy\register-webhook.ps1
   ```

The helper hides the token and secret while you type them. After deployment, `/start` opens the chat game; admins can use `/admin`.

## Local long-polling run

For local testing, add the token and admin ID to the ignored `bot-config.js` file, then run:

```powershell
npm.cmd start
```

Run tests with `npm.cmd test`.

## Security and storage

`bot-config.js` and local `data/` are excluded from Git. Cloudflare secrets are stored as Worker secrets; balances, game state, and processed Telegram update IDs are stored in D1. Do not commit bot tokens or share them in chat.
