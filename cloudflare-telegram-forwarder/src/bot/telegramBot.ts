import { Bot, type Context, webhookCallback } from "grammy";
import type { Env } from "../types";
import { applyFilterPipeline, parsePipeline } from "../filters";
import type { ForwardRuleRow } from "../types";
import { listRules } from "../db/rules";

let botSingleton: Bot<Context> | null = null;
let botTokenBound: string | null = null;

function topicMatches(
  ruleThread: number | null | undefined,
  msgThread: number | undefined,
): boolean {
  if (ruleThread === null || ruleThread === undefined) return true;
  return (msgThread ?? null) === ruleThread;
}

function chatMatches(ruleSource: number, chatId: number): boolean {
  return ruleSource === chatId;
}

async function deliver(
  api: Bot["api"],
  rule: ForwardRuleRow,
  srcChatId: number,
  messageId: number,
  originalText: string | undefined,
  originalCaption: string | undefined,
): Promise<void> {
  const pipeline = parsePipeline(rule.filter_pipeline);
  const textBody = originalText ?? originalCaption;
  const { text: transformed, drop } = applyFilterPipeline(textBody, pipeline);
  if (drop) return;

  const opts = {
    message_thread_id: rule.dest_thread_id ?? undefined,
  } as const;

  if (rule.delivery_mode === "forward") {
    await api.forwardMessage(
      rule.dest_chat_id,
      srcChatId,
      messageId,
      opts,
    );
    return;
  }

  const hasText = typeof originalText === "string";
  const hasCap = typeof originalCaption === "string";

  if (hasText && typeof transformed === "string" && transformed !== originalText) {
    await api.sendMessage(rule.dest_chat_id, transformed, {
      ...opts,
      link_preview_options: { is_disabled: true },
    });
    return;
  }

  if (
    hasCap &&
    typeof transformed === "string" &&
    transformed !== originalCaption
  ) {
    const copied = await api.copyMessage(
      rule.dest_chat_id,
      srcChatId,
      messageId,
      { message_thread_id: opts.message_thread_id },
    );
    await api.editMessageCaption(
      rule.dest_chat_id,
      copied.message_id,
      { caption: transformed },
    );
    return;
  }

  await api.copyMessage(rule.dest_chat_id, srcChatId, messageId, opts);
}

async function handleIncoming(
  ctx: Context,
  env: Env,
  edited: boolean,
): Promise<void> {
  const msg = ctx.msg;
  if (!msg) return;
  const chatId = msg.chat.id;
  const threadId = msg.message_thread_id;
  const rules = await listRules(env.DB);
  for (const rule of rules) {
    if (!chatMatches(rule.source_chat_id, chatId)) continue;
    if (!topicMatches(rule.source_thread_id, threadId)) continue;
    if (edited && !rule.include_edited) continue;
    await deliver(
      ctx.api,
      rule,
      chatId,
      msg.message_id,
      msg.text,
      msg.caption,
    );
  }
}

export function getOrCreateBot(env: Env): Bot<Context> {
  if (botSingleton && botTokenBound === env.BOT_TOKEN) return botSingleton;

  const botInfo = env.BOT_INFO ? JSON.parse(env.BOT_INFO) : undefined;
  const bot = new Bot(env.BOT_TOKEN, { botInfo });

  bot.on("message", async (ctx) => {
    await handleIncoming(ctx, env, false);
  });
  bot.on("channel_post", async (ctx) => {
    await handleIncoming(ctx, env, false);
  });
  bot.on("edited_message", async (ctx) => {
    await handleIncoming(ctx, env, true);
  });
  bot.on("edited_channel_post", async (ctx) => {
    await handleIncoming(ctx, env, true);
  });

  bot.catch((err) => console.error("[bot]", err));

  botSingleton = bot;
  botTokenBound = env.BOT_TOKEN;
  return bot;
}

export function telegramWebhookHandler(env: Env) {
  const bot = getOrCreateBot(env);
  const secret = env.TELEGRAM_WEBHOOK_SECRET;
  return webhookCallback(
    bot,
    "cloudflare-mod",
    secret
      ? { secretToken: secret, timeoutMilliseconds: 25_000 }
      : { timeoutMilliseconds: 25_000 },
  );
}
