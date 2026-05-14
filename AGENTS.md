# AGENTS.md

## Cursor Cloud specific instructions

### Telegram Forward Hub (`cloudflare-telegram-forwarder/`)

This repo includes a **Cloudflare Workers** Telegram forwarder (grammY + D1 + admin UI). Full setup and Telegram API details are in [`cloudflare-telegram-forwarder/README.md`](./cloudflare-telegram-forwarder/README.md).

### Secrets in the cloud agent environment

When **`BOT_TOKEN`**, **`API_ID`**, and **`API_HASH`** are provided as environment secrets, you can:

1. **Verify the bot (Telegram API)** — no Worker required:

   `curl -sS "https://api.telegram.org/bot${BOT_TOKEN}/getMe"`

2. **Run the Worker locally** — Wrangler does **not** read the shell environment for `BOT_TOKEN` by default; it reads **`cloudflare-telegram-forwarder/.dev.vars`** (gitignored). For a first run, copy [`.dev.vars.example`](./cloudflare-telegram-forwarder/.dev.vars.example) to `.dev.vars` and fill at least: `BOT_TOKEN`, `ADMIN_PASSWORD`, `SESSION_SECRET`, `PUBLIC_BASE_URL`, and optionally `BOT_INFO` (JSON from `getMe`), `ENCRYPTION_KEY` (32-byte base64), `TELEGRAM_WEBHOOK_SECRET`. You can sync values from the agent’s exported secrets into `.dev.vars` without committing that file.

3. **Hello world (core product behavior)** — with dev server on port 8787 and a valid `.dev.vars`: `POST /admin/login` with form field `password` → expect **302** to `/admin`; then `GET /api/session/check` with the session cookie → `{"ok":true}`; `GET /api/rules` → `[]` until rules exist.

### Non-obvious caveats

- **`setWebhook` / 24×7 delivery**: Telegram only calls HTTPS URLs reachable from the public internet. `PUBLIC_BASE_URL=http://127.0.0.1:8787` is fine for UI login tests; use a deployed Worker URL (or a tunnel) before calling **`POST /api/telegram/set-webhook`** so updates actually arrive.
- **D1**: Replace `database_id` in [`cloudflare-telegram-forwarder/wrangler.jsonc`](./cloudflare-telegram-forwarder/wrangler.jsonc) with the output of `wrangler d1 create telegram-forward-hub` before remote deploy.
- **Forwarding path** is **Bot API**–based (bot must have access to source chats). Encrypted **StringSession** in D1 is for a **future** MTProto sidecar, not consumed by the Worker yet (see README).

### Commands (reference only)

| Goal | Command |
|------|--------|
| Typecheck | `cd cloudflare-telegram-forwarder && npm run typecheck` |
| Local Worker | `cd cloudflare-telegram-forwarder && npm run dev` |
| D1 migrations (local) | `cd cloudflare-telegram-forwarder && npx wrangler d1 migrations apply DB --local` |

### Python `tgcf` (repo root)

The original **tgcf** CLI remains Poetry-based; see root [`README.md`](./README.md). Cloud agent setup for that stack is separate from the Worker app above.
