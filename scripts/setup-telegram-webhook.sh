#!/usr/bin/env bash
# DL-402 — one-shot Telegram webhook registration.
#
# Run once after the first Worker deploy that includes the /webhook/telegram
# route. Telegram will POST every update to the URL with the secret_token
# echoed in the X-Telegram-Bot-Api-Secret-Token header.
#
# Usage:
#   source ~/Desktop/moshe/annual-reports/.env
#   bash scripts/setup-telegram-webhook.sh
#
# Required env vars:
#   TELEGRAM_BOT_TOKEN       — from @BotFather
#   TELEGRAM_WEBHOOK_SECRET  — must match the secret put in `wrangler secret put`
#   WORKER_PUBLIC_URL        — defaults to the prod Worker URL below

set -euo pipefail

WORKER_PUBLIC_URL="${WORKER_PUBLIC_URL:-https://annual-reports-api.liozshor1.workers.dev}"

if [[ -z "${TELEGRAM_BOT_TOKEN:-}" ]]; then
  echo "ERROR: TELEGRAM_BOT_TOKEN is not set. Source your .env first." >&2
  exit 1
fi

if [[ -z "${TELEGRAM_WEBHOOK_SECRET:-}" ]]; then
  echo "ERROR: TELEGRAM_WEBHOOK_SECRET is not set." >&2
  exit 1
fi

WEBHOOK_URL="${WORKER_PUBLIC_URL}/webhook/telegram"

echo "Registering webhook → ${WEBHOOK_URL}"

curl -fsSL -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \
  -H 'Content-Type: application/json' \
  -d "$(cat <<JSON
{
  "url": "${WEBHOOK_URL}",
  "secret_token": "${TELEGRAM_WEBHOOK_SECRET}",
  "allowed_updates": ["message", "edited_message", "callback_query"],
  "drop_pending_updates": true
}
JSON
)"

echo
echo "Verifying via getWebhookInfo:"
curl -fsSL "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getWebhookInfo"
echo
