import type { ForwardRuleRow } from "../types";

export async function listRules(db: D1Database): Promise<ForwardRuleRow[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM forward_rules WHERE enabled = 1 ORDER BY priority DESC, id ASC`,
    )
    .all<ForwardRuleRow>();
  return results ?? [];
}

export async function listAllRulesAdmin(
  db: D1Database,
): Promise<ForwardRuleRow[]> {
  const { results } = await db
    .prepare(`SELECT * FROM forward_rules ORDER BY priority DESC, id ASC`)
    .all<ForwardRuleRow>();
  return results ?? [];
}

export type NewForwardRule = Omit<ForwardRuleRow, "id">;

export async function insertRule(
  db: D1Database,
  row: NewForwardRule,
): Promise<number> {
  const now = Date.now();
  const res = await db
    .prepare(
      `INSERT INTO forward_rules (
        name, enabled, priority, source_chat_id, source_thread_id,
        dest_chat_id, dest_thread_id, delivery_mode, filter_pipeline,
        include_edited, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      row.name,
      row.enabled,
      row.priority,
      row.source_chat_id,
      row.source_thread_id,
      row.dest_chat_id,
      row.dest_thread_id,
      row.delivery_mode,
      row.filter_pipeline,
      row.include_edited,
      now,
      now,
    )
    .run();
  return res.meta.last_row_id as number;
}

export async function updateRule(
  db: D1Database,
  id: number,
  patch: Partial<ForwardRuleRow>,
): Promise<void> {
  const now = Date.now();
  const fields: string[] = [];
  const values: unknown[] = [];
  const add = (k: string, v: unknown) => {
    fields.push(`${k} = ?`);
    values.push(v);
  };
  if (patch.name !== undefined) add("name", patch.name);
  if (patch.enabled !== undefined) add("enabled", patch.enabled);
  if (patch.priority !== undefined) add("priority", patch.priority);
  if (patch.source_chat_id !== undefined) add("source_chat_id", patch.source_chat_id);
  if (patch.source_thread_id !== undefined) add("source_thread_id", patch.source_thread_id);
  if (patch.dest_chat_id !== undefined) add("dest_chat_id", patch.dest_chat_id);
  if (patch.dest_thread_id !== undefined) add("dest_thread_id", patch.dest_thread_id);
  if (patch.delivery_mode !== undefined) add("delivery_mode", patch.delivery_mode);
  if (patch.filter_pipeline !== undefined) add("filter_pipeline", patch.filter_pipeline);
  if (patch.include_edited !== undefined) add("include_edited", patch.include_edited);
  fields.push("updated_at = ?");
  values.push(now);
  values.push(id);
  await db
    .prepare(`UPDATE forward_rules SET ${fields.join(", ")} WHERE id = ?`)
    .bind(...values)
    .run();
}

export async function deleteRule(db: D1Database, id: number): Promise<void> {
  await db.prepare(`DELETE FROM forward_rules WHERE id = ?`).bind(id).run();
}
