import type { Env } from "./types";

const COOKIE = "tfh_session";

export async function signSession(
  secret: string,
  expMs: number,
): Promise<string> {
  const payload = JSON.stringify({ exp: expMs, v: 1 });
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret.padEnd(32, "x").slice(0, 32)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payload),
  );
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig)));
  return `${btoa(payload)}.${sigB64}`;
}

export async function verifySession(
  secret: string,
  cookieValue: string | undefined,
): Promise<boolean> {
  if (!cookieValue) return false;
  const [payloadB64, sigB64] = cookieValue.split(".");
  if (!payloadB64 || !sigB64) return false;
  let payload: string;
  try {
    payload = atob(payloadB64);
  } catch {
    return false;
  }
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret.padEnd(32, "x").slice(0, 32)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const expected = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payload),
  );
  const expectedB64 = btoa(String.fromCharCode(...new Uint8Array(expected)));
  if (expectedB64.length !== sigB64.length) return false;
  let ok = 0;
  for (let i = 0; i < expectedB64.length; i++)
    ok |= expectedB64.charCodeAt(i) ^ sigB64.charCodeAt(i);
  if (ok !== 0) return false;
  try {
    const { exp } = JSON.parse(payload) as { exp: number };
    return typeof exp === "number" && Date.now() < exp;
  } catch {
    return false;
  }
}

export function readCookie(req: Request, name: string): string | undefined {
  const raw = req.headers.get("Cookie") ?? "";
  for (const part of raw.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

export function sessionCookie(value: string, maxAgeSec: number): string {
  const attrs = [
    `${COOKIE}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Strict",
    `Max-Age=${maxAgeSec}`,
  ];
  return attrs.join("; ");
}

export function clearSessionCookie(): string {
  return `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

export { COOKIE };

export async function requireAdmin(
  req: Request,
  env: Env,
): Promise<Response | null> {
  const secret = env.SESSION_SECRET ?? env.ADMIN_PASSWORD;
  if (!secret) {
    return new Response("SESSION_SECRET or ADMIN_PASSWORD must be set", {
      status: 500,
    });
  }
  const ok = await verifySession(secret, readCookie(req, COOKIE));
  if (!ok) return Response.redirect(new URL("/admin/login", req.url).href, 302);
  return null;
}

/** Constant-time-ish compare for admin password */
export function timingSafeEqualStr(a: string, b: string): boolean {
  const ae = new TextEncoder().encode(a);
  const be = new TextEncoder().encode(b);
  if (ae.length !== be.length) return false;
  let x = 0;
  for (let i = 0; i < ae.length; i++) x |= ae[i] ^ be[i];
  return x === 0;
}
