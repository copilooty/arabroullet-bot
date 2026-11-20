CREATE TABLE IF NOT EXISTS wallets (
  user_id TEXT PRIMARY KEY,
  balance INTEGER NOT NULL CHECK (balance >= 0)
);

CREATE TABLE IF NOT EXISTS sessions (
  user_id TEXT PRIMARY KEY,
  bets_json TEXT NOT NULL DEFAULT '[]',
  last_bets_json TEXT NOT NULL DEFAULT '[]',
  last_round_json TEXT,
  chat_id TEXT,
  message_id INTEGER,
  admin_action TEXT
);

CREATE TABLE IF NOT EXISTS processed_updates (
  update_id INTEGER PRIMARY KEY,
  processed_at INTEGER NOT NULL
);
