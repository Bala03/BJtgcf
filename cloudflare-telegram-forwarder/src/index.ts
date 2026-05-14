import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env } from "./types";
import {
  COOKIE,
  clearSessionCookie,
  readCookie,
  requireAdmin,
  sessionCookie,
  signSession,
  timingSafeEqualStr,
  verifySession,
} from "./auth";
import {
  deleteRule,
  insertRule,
  listAllRulesAdmin,
  updateRule,
} from "./db/rules";
import { telegramWebhookHandler } from "./bot/telegramBot";
import { encryptString, importAesKeyFromBase64 } from "./crypto";

const app = new Hono<{ Bindings: Env }>();

app.use("/api/*", cors({ origin: "*", allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"] }));

app.get("/", (c) => c.redirect("/admin"));

function htmlResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

app.get("/admin/login", (c) => {
  const page = loginPageHtml(c.env.APP_NAME ?? "Telegram Forward Hub");
  return htmlResponse(page);
});

app.post("/admin/login", async (c) => {
  const password = (await c.req.parseBody())["password"];
  const admin = c.env.ADMIN_PASSWORD;
  if (!admin || typeof password !== "string" || !timingSafeEqualStr(password, admin)) {
    return htmlResponse(
      loginPageHtml(c.env.APP_NAME ?? "Telegram Forward Hub", "Invalid password"),
      401,
    );
  }
  const secret = c.env.SESSION_SECRET ?? admin;
  const token = await signSession(secret, Date.now() + 7 * 864e5);
  return new Response(null, {
    status: 302,
    headers: {
      Location: "/admin",
      "Set-Cookie": sessionCookie(token, 7 * 86400),
    },
  });
});

app.get("/admin/logout", () =>
  new Response(null, {
    status: 302,
    headers: { Location: "/admin/login", "Set-Cookie": clearSessionCookie() },
  }),
);

app.get("/admin", async (c) => {
  const gate = await requireAdmin(c.req.raw, c.env);
  if (gate) return gate;
  const rules = await listAllRulesAdmin(c.env.DB);
  return htmlResponse(dashboardHtml(c.env.APP_NAME ?? "Telegram Forward Hub", rules));
});

app.get("/admin/telegram-login", async (c) => {
  const gate = await requireAdmin(c.req.raw, c.env);
  if (gate) return gate;
  return c.redirect("/static/telegram-login.html");
});

/** Encrypted store for optional MTProto StringSession (future bridge) + API id/hash */
app.post("/api/credentials", async (c) => {
  const gate = await requireAdmin(c.req.raw, c.env);
  if (gate) return gate;
  const keyB64 = c.env.ENCRYPTION_KEY;
  if (!keyB64) return c.json({ error: "ENCRYPTION_KEY not set" }, 400);
  const key = await importAesKeyFromBase64(keyB64);
  if (!key) return c.json({ error: "ENCRYPTION_KEY must be 32 bytes base64" }, 400);
  const body = (await c.req.json()) as {
    apiId?: string;
    apiHash?: string;
    stringSession?: string;
  };
  const payload = JSON.stringify({
    apiId: body.apiId,
    apiHash: body.apiHash,
    stringSession: body.stringSession,
    savedAt: Date.now(),
  });
  const { ciphertext, iv } = await encryptString(key, payload);
  await c.env.DB.prepare(
    `INSERT INTO secure_store (key, ciphertext, iv, updated_at) VALUES ('telegram_user', ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET ciphertext = excluded.ciphertext, iv = excluded.iv, updated_at = excluded.updated_at`,
  )
    .bind(ciphertext, iv, Date.now())
    .run();
  return c.json({ ok: true });
});

app.get("/api/rules", async (c) => {
  const gate = await requireAdmin(c.req.raw, c.env);
  if (gate) return gate;
  const rules = await listAllRulesAdmin(c.env.DB);
  return c.json(rules);
});

app.post("/api/rules", async (c) => {
  const gate = await requireAdmin(c.req.raw, c.env);
  if (gate) return gate;
  const b = (await c.req.json()) as Record<string, unknown>;
  const now = Date.now();
  const id = await insertRule(c.env.DB, {
    name: String(b.name ?? "rule"),
    enabled: b.enabled === false ? 0 : 1,
    priority: Number(b.priority ?? 0),
    source_chat_id: Number(b.source_chat_id),
    source_thread_id:
      b.source_thread_id === null || b.source_thread_id === undefined
        ? null
        : Number(b.source_thread_id),
    dest_chat_id: Number(b.dest_chat_id),
    dest_thread_id:
      b.dest_thread_id === null || b.dest_thread_id === undefined
        ? null
        : Number(b.dest_thread_id),
    delivery_mode: (b.delivery_mode === "forward" ? "forward" : "copy") as
      | "copy"
      | "forward",
    filter_pipeline: typeof b.filter_pipeline === "string" ? b.filter_pipeline : JSON.stringify(b.filter_pipeline ?? []),
    include_edited: b.include_edited === false ? 0 : 1,
    created_at: now,
    updated_at: now,
  });
  return c.json({ id });
});

app.put("/api/rules/:id", async (c) => {
  const gate = await requireAdmin(c.req.raw, c.env);
  if (gate) return gate;
  const id = Number(c.req.param("id"));
  const b = (await c.req.json()) as Record<string, unknown>;
  await updateRule(c.env.DB, id, {
    name: b.name !== undefined ? String(b.name) : undefined,
    enabled: b.enabled === undefined ? undefined : b.enabled ? 1 : 0,
    priority: b.priority !== undefined ? Number(b.priority) : undefined,
    source_chat_id:
      b.source_chat_id !== undefined ? Number(b.source_chat_id) : undefined,
    source_thread_id:
      b.source_thread_id === undefined
        ? undefined
        : b.source_thread_id === null
          ? null
          : Number(b.source_thread_id),
    dest_chat_id:
      b.dest_chat_id !== undefined ? Number(b.dest_chat_id) : undefined,
    dest_thread_id:
      b.dest_thread_id === undefined
        ? undefined
        : b.dest_thread_id === null
          ? null
          : Number(b.dest_thread_id),
    delivery_mode:
      b.delivery_mode === "forward" || b.delivery_mode === "copy"
        ? (b.delivery_mode as "copy" | "forward")
        : undefined,
    filter_pipeline:
      b.filter_pipeline !== undefined
        ? typeof b.filter_pipeline === "string"
          ? String(b.filter_pipeline)
          : JSON.stringify(b.filter_pipeline)
        : undefined,
    include_edited:
      b.include_edited === undefined ? undefined : b.include_edited ? 1 : 0,
  });
  return c.json({ ok: true });
});

app.delete("/api/rules/:id", async (c) => {
  const gate = await requireAdmin(c.req.raw, c.env);
  if (gate) return gate;
  await deleteRule(c.env.DB, Number(c.req.param("id")));
  return c.json({ ok: true });
});

app.post("/api/telegram/set-webhook", async (c) => {
  const gate = await requireAdmin(c.req.raw, c.env);
  if (gate) return gate;
  const base = c.env.PUBLIC_BASE_URL?.replace(/\/$/, "");
  if (!base) return c.json({ error: "PUBLIC_BASE_URL not set" }, 400);
  const url = `${base}/telegram/webhook`;
  const secret = c.env.TELEGRAM_WEBHOOK_SECRET;
  const params = new URLSearchParams({ url });
  if (secret) params.set("secret_token", secret);
  params.set(
    "allowed_updates",
    JSON.stringify([
      "message",
      "edited_message",
      "channel_post",
      "edited_channel_post",
    ]),
  );
  const res = await fetch(
    `https://api.telegram.org/bot${c.env.BOT_TOKEN}/setWebhook?${params}`,
  );
  const data = (await res.json()) as { ok: boolean; description?: string };
  return c.json(data, data.ok ? 200 : 502);
});

app.get("/api/telegram/webhook-info", async (c) => {
  const gate = await requireAdmin(c.req.raw, c.env);
  if (gate) return gate;
  const res = await fetch(
    `https://api.telegram.org/bot${c.env.BOT_TOKEN}/getWebhookInfo`,
  );
  return c.json(await res.json());
});

app.get("/api/session/check", async (c) => {
  const secret = c.env.SESSION_SECRET ?? c.env.ADMIN_PASSWORD;
  if (!secret) return c.json({ ok: false });
  const ok = await verifySession(secret, readCookie(c.req.raw, COOKIE));
  return c.json({ ok });
});

app.get("/static/telegram-login.html", async (c) => {
  const gate = await requireAdmin(c.req.raw, c.env);
  if (gate) return gate;
  return new Response(telegramLoginHtml(), {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
});

app.post("/telegram/webhook", (c) => telegramWebhookHandler(c.env)(c.req.raw));

export default { fetch: app.fetch };

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function loginPageHtml(title: string, err?: string): string {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${escapeHtml(title)} — Admin</title>
<style>
body{font-family:system-ui,sans-serif;max-width:28rem;margin:4rem auto;padding:0 1rem;background:#0b1020;color:#e8ecff}
input{width:100%;padding:.65rem;border-radius:8px;border:1px solid #2a3358;background:#121a3a;color:inherit}
button{margin-top:1rem;width:100%;padding:.75rem;border-radius:8px;border:none;background:#5b8cff;font-weight:600;cursor:pointer}
.err{color:#ff8a8a;margin-top:.75rem;font-size:.9rem}
</style></head><body>
<h1>Admin login</h1>
${err ? `<p class="err">${escapeHtml(err)}</p>` : ""}
<form method="post" action="/admin/login">
<label>Password<br/><input type="password" name="password" autocomplete="current-password" required/></label>
<button type="submit">Sign in</button>
</form>
<p style="opacity:.7;font-size:.85rem;margin-top:2rem">Set <code>ADMIN_PASSWORD</code> and <code>SESSION_SECRET</code> as Worker secrets.</p>
</body></html>`;
}

function dashboardHtml(title: string, rules: { id: number }[]): string {
  const rulesJson = JSON.stringify(rules, null, 2);
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${escapeHtml(title)}</title>
<style>
body{font-family:system-ui,sans-serif;margin:0;background:#0b1020;color:#e8ecff}
header{padding:1rem 1.25rem;border-bottom:1px solid #1e2748;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:.5rem}
a{color:#8ab4ff} main{max-width:960px;margin:0 auto;padding:1.25rem}
pre{background:#121a3a;padding:1rem;border-radius:10px;overflow:auto;font-size:.8rem;border:1px solid #2a3358}
.card{background:#121a3a;border:1px solid #2a3358;border-radius:12px;padding:1rem;margin:1rem 0}
button,.btn{padding:.5rem .9rem;border-radius:8px;border:1px solid #3d4d8c;background:#1c274d;color:inherit;cursor:pointer;text-decoration:none;display:inline-block}
.btn-primary{background:#5b8cff;border-color:#5b8cff;color:#0b1020;font-weight:600}
label{display:block;margin:.35rem 0 .15rem;font-size:.85rem;opacity:.9}
input,textarea,select{width:100%;padding:.5rem;border-radius:8px;border:1px solid #2a3358;background:#0f1633;color:inherit;box-sizing:border-box}
textarea{min-height:6rem;font-family:ui-monospace,monospace;font-size:.8rem}
.grid{display:grid;gap:.75rem;grid-template-columns:repeat(auto-fit,minmax(160px,1fr))}
</style></head><body>
<header><strong>${escapeHtml(title)}</strong>
<div>
<a class="btn" href="/admin/telegram-login">Telegram login (browser)</a>
<a class="btn" href="/admin/logout">Logout</a>
</div></header>
<main>
<h2>Forward rules (${rules.length})</h2>
<p>Configure sources and destinations using numeric chat IDs. Forum topics use Telegram <code>message_thread_id</code> (see <a href="https://core.telegram.org/bots/api#message">Bot API: Message</a>).</p>
<div class="card">
<h3>Install webhook (24/7)</h3>
<p>Requires <code>PUBLIC_BASE_URL</code> and <code>BOT_TOKEN</code>. Optional <code>TELEGRAM_WEBHOOK_SECRET</code>.</p>
<button type="button" class="btn-primary" id="wh">POST /api/telegram/set-webhook</button>
<pre id="wh-out"></pre>
</div>
<div class="card">
<h3>Create rule</h3>
<form id="rule-form">
<label>Name<input name="name" value="default" required/></label>
<div class="grid">
<label>Priority<input name="priority" type="number" value="0"/></label>
<label>Source chat id<input name="source_chat_id" required placeholder="-100123"/></label>
<label>Source topic id (blank = any)<input name="source_thread_id" placeholder="optional"/></label>
<label>Dest chat id<input name="dest_chat_id" required/></label>
<label>Dest topic id (blank = general)<input name="dest_thread_id" placeholder="optional"/></label>
<label>Delivery<select name="delivery_mode"><option value="copy">copy (no 'forwarded from')</option><option value="forward">forward</option></select></label>
<label>Include edited<select name="include_edited"><option value="1" selected>yes</option><option value="0">no</option></select></label>
</div>
<label>Filter pipeline (JSON array)<textarea name="filter_pipeline">[]</textarea></label>
<button type="submit" class="btn-primary">Save rule</button>
</form>
<pre id="rule-out"></pre>
</div>
<h3>Current rules</h3>
<pre id="rules">${escapeHtml(rulesJson)}</pre>
</main>
<script>
document.getElementById('wh').onclick=async()=>{
  const r=await fetch('/api/telegram/set-webhook',{method:'POST'});
  document.getElementById('wh-out').textContent=JSON.stringify(await r.json(),null,2);
};
document.getElementById('rule-form').onsubmit=async(e)=>{
  e.preventDefault();
  const f=e.target;
  const body={
    name:f.name.value,
    priority:Number(f.priority.value||0),
    source_chat_id:Number(f.source_chat_id.value),
    source_thread_id:f.source_thread_id.value===''?null:Number(f.source_thread_id.value),
    dest_chat_id:Number(f.dest_chat_id.value),
    dest_thread_id:f.dest_thread_id.value===''?null:Number(f.dest_thread_id.value),
    delivery_mode:f.delivery_mode.value,
    include_edited:f.include_edited.value==='1',
    filter_pipeline:f.filter_pipeline.value
  };
  const r=await fetch('/api/rules',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  document.getElementById('rule-out').textContent=JSON.stringify(await r.json(),null,2);
  location.reload();
};
</script>
</body></html>`;
}

function telegramLoginHtml(): string {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/><title>Telegram credentials</title>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<style>
body{font-family:system-ui,sans-serif;background:#0b1020;color:#e8ecff;max-width:40rem;margin:2rem auto;padding:0 1rem;line-height:1.45}
textarea,input{width:100%;padding:.55rem;border-radius:8px;border:1px solid #2a3358;background:#121a3a;color:inherit;box-sizing:border-box}
button{margin-top:.75rem;padding:.65rem 1rem;border-radius:8px;border:none;background:#5b8cff;font-weight:600;cursor:pointer;color:#0b1020}
.warn{color:#ffb86b}
code{font-size:.85em}
</style></head><body>
<h1>MTProto session (optional)</h1>
<p>This Worker forwards messages using the <strong>Bot API</strong> webhook (see README). A <strong>StringSession</strong> from a user account is stored encrypted for a future MTProto sidecar (Node/GramJS, Telethon, or Cloudflare Containers) if you need chats the bot cannot join.</p>
<p class="warn">Never share your API hash or session string publicly.</p>
<h2>How to obtain a StringSession</h2>
<ul>
<li>Use official tools locally (e.g. Telethon / Pyrogram session generators) or GramJS in Node.</li>
<li>Or follow <a href="https://my.telegram.org">my.telegram.org</a> for API ID &amp; hash, then create a session with 2FA supported in your local script.</li>
</ul>
<label>API ID <input id="apiId" type="text" autocomplete="off"/></label>
<label>API Hash <input id="apiHash" type="password" autocomplete="off"/></label>
<label>String session <textarea id="sess" rows="4" placeholder="Paste StringSession here"></textarea></label>
<button type="button" id="save">Encrypt &amp; save to Worker</button>
<pre id="out"></pre>
<script>
document.getElementById('save').onclick=async()=>{
  const body={
    apiId:document.getElementById('apiId').value,
    apiHash:document.getElementById('apiHash').value,
    stringSession:document.getElementById('sess').value
  };
  const r=await fetch('/api/credentials',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  document.getElementById('out').textContent=JSON.stringify(await r.json(),null,2);
};
</script>
</body></html>`;
}
