import test from "node:test";
import assert from "node:assert/strict";
import { isValidWebhookSecret } from "./worker.js";

test("Telegram webhook accepts only the configured secret header", () => {
  const valid = new Request("https://worker.example/telegram", {
    headers: { "X-Telegram-Bot-Api-Secret-Token": "secret-value" }
  });
  const invalid = new Request("https://worker.example/telegram", {
    headers: { "X-Telegram-Bot-Api-Secret-Token": "wrong-value" }
  });
  assert.equal(isValidWebhookSecret(valid, "secret-value"), true);
  assert.equal(isValidWebhookSecret(invalid, "secret-value"), false);
  assert.equal(isValidWebhookSecret(valid, ""), false);
});
