/**
 * Typed filter pipeline steps (JSON in D1 `forward_rules.filter_pipeline`).
 * @see https://core.telegram.org/bots/api#message — message_thread_id for forum topics
 */
export type FilterStep =
  | { type: "drop_if_text_missing" }
  | { type: "drop_if_not_regex"; pattern: string; flags?: string }
  | { type: "drop_if_regex"; pattern: string; flags?: string }
  | { type: "replace_literal"; from: string; to: string }
  | { type: "replace_regex"; pattern: string; replacement: string; flags?: string }
  | { type: "prefix"; value: string }
  | { type: "suffix"; value: string }
  | { type: "truncate"; max: number }
  | { type: "lowercase" }
  | { type: "uppercase" }
  | { type: "blocklist"; terms: string[]; caseInsensitive?: boolean }
  | { type: "allowlist"; terms: string[]; caseInsensitive?: boolean; mode?: "any" | "all" };

export interface ForwardRuleRow {
  id: number;
  name: string;
  enabled: number;
  priority: number;
  source_chat_id: number;
  source_thread_id: number | null;
  dest_chat_id: number;
  dest_thread_id: number | null;
  delivery_mode: "copy" | "forward";
  filter_pipeline: string;
  include_edited: number;
  created_at: number;
  updated_at: number;
}

export interface Env {
  DB: D1Database;
  BOT_TOKEN: string;
  /** Optional JSON string from getMe — speeds cold start */
  BOT_INFO?: string;
  /** Webhook secret_token (1–256 chars A-Za-z0-9_-) */
  TELEGRAM_WEBHOOK_SECRET?: string;
  /** Public base URL of this worker, e.g. https://telegram-forward-hub.x.workers.dev */
  PUBLIC_BASE_URL?: string;
  /** Single admin password (use a long random value) */
  ADMIN_PASSWORD?: string;
  /** HMAC key for session cookies (random 32+ bytes hex/base64) */
  SESSION_SECRET?: string;
  /** 32-byte key base64 for AES-GCM storing optional credentials */
  ENCRYPTION_KEY?: string;
  APP_NAME?: string;
}
