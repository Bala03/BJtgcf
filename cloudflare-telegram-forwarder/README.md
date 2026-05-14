# Telegram Forward Hub (Cloudflare Workers)

Production-oriented Telegram message forwarding inspired by [tgcf](https://github.com/aahnik/tgcf) concepts, redesigned for **Cloudflare Workers**: **grammY** + **HTTPS webhooks** (true push, suitable for “always on” delivery), **D1** for rules, **AES-GCM** for optional MTProto credential blobs, and a small **admin UI**.

## What runs on Cloudflare today

| Capability | Implementation |
|------------|----------------|
| Receive new/edited messages 24/7 | [Telegram Bot API `setWebhook`](https://core.telegram.org/bots/api#setwebhook) → Worker `POST /telegram/webhook` |
| Supergroups, channels, private chats | Same Bot API model; bot must be allowed to **see** source messages ([privacy mode](https://core.telegram.org/bots/features#privacy-mode), admin in channels, member in groups) |
| Forum topics | Match / target [`message_thread_id`](https://core.telegram.org/bots/api#message) on source and destination |
| Copy vs forward | Rule `delivery_mode`: `copy` (no “forwarded from”) or `forward` |
| Text transforms | JSON **filter pipeline** (regex, replace, blocklist, allowlist, truncate, …) |

## Honest platform limits (read before relying on “user account” features)

- **MTProto user clients** (Telethon / GramJS with phone + OTP + 2FA) need a **long-lived TCP/WebSocket** session to Telegram data centers. Cloudflare **Workers** are HTTP-first; running a full user client *inside* a Worker is not officially supported the way Node is.
- This project’s **forwarding path is Bot API–based**: add your bot to source and destination chats/channels (with appropriate rights). That matches how most production Telegram automation works on serverless.
- The admin UI can **store an encrypted StringSession + api_id/hash** (D1 `secure_store`) for a **future** or **external** MTProto sidecar (small Node process, Fly.io, or [Cloudflare Containers](https://developers.cloudflare.com/containers/)) if you must read chats the bot cannot join.

## Quick start

```bash
cd cloudflare-telegram-forwarder
npm install
# Create D1 + paste id into wrangler.jsonc
npx wrangler d1 create telegram-forward-hub
npx wrangler d1 migrations apply DB --local
cp .dev.vars.example .dev.vars   # fill in secrets
npm run dev
```

1. Set secrets in Cloudflare (or `.dev.vars` locally): `BOT_TOKEN`, `ADMIN_PASSWORD`, `SESSION_SECRET`, `PUBLIC_BASE_URL`, optional `TELEGRAM_WEBHOOK_SECRET`, optional `ENCRYPTION_KEY` (32-byte base64).
2. Open `/admin`, log in, click **Install webhook**.
3. Add **forward rules** (numeric chat IDs). Use [@userinfobot](https://t.me/userinfobot) or Telegram clients to discover IDs.
4. **Disable privacy mode** or make the bot admin if it must read all group messages ([FAQ](https://core.telegram.org/bots/faq#what-messages-will-my-bot-get)).

## Filter pipeline (JSON)

Array of steps applied in order to `text` or `caption` (caption path rewrites after `copyMessage` + `editMessageCaption`).

Examples:

```json
[
  { "type": "drop_if_not_regex", "pattern": "^ANN:", "flags": "" },
  { "type": "replace_regex", "pattern": "^ANN:\\s*", "replacement": "", "flags": "" },
  { "type": "blocklist", "terms": ["spam", "scam"], "caseInsensitive": true }
]
```

Supported `type` values: `drop_if_text_missing`, `drop_if_not_regex`, `drop_if_regex`, `replace_literal`, `replace_regex`, `prefix`, `suffix`, `truncate`, `lowercase`, `uppercase`, `blocklist`, `allowlist`.

## Security

- Admin: single password (`ADMIN_PASSWORD`) + signed cookie (`SESSION_SECRET` or password-derived fallback). For stronger isolation use [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/policies/access/) in front of `/admin`.
- Webhook: set `TELEGRAM_WEBHOOK_SECRET` and verify Telegram sends `X-Telegram-Bot-Api-Secret-Token` (grammY handles this).
- Optional credentials: `ENCRYPTION_KEY` (32 bytes, base64) for AES-GCM at rest in D1.

## References

- [Bot API — copyMessage](https://core.telegram.org/bots/api#copymessage), [forwardMessage](https://core.telegram.org/bots/api#forwardmessage)
- [Forum topics / message_thread_id](https://telegram.org/blog/topics-in-groups-collectible-usernames)
- [grammY on Cloudflare Workers (Node)](https://grammy.dev/hosting/cloudflare-workers-nodejs)

## License

Same as parent repository unless you choose otherwise.
