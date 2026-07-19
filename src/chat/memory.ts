import { getEmbedding } from "../llm/openrouter.js";
import { query, toVectorLiteral } from "../db.js";
import { renderChatMessages } from "./prompt.js";
import { DEFAULT_PROFILE_CONTENT } from "../auth/users.js";

export function extractLastUserMessage(
  messages: { role: string; content: string }[]
): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user" && messages[i].content?.trim()) {
      return messages[i].content.trim();
    }
  }
  return "";
}

/** 单篇日记注入上限，避免撑爆上下文 */
const DIARY_SNIPPET_MAX_CHARS = 900;
const DIARY_MATCH_COUNT = 2;

function formatShortCtx(rows: { role: string; content: string }[]): string {
  return rows
    .map((m) => `${m.role === "user" ? "用户" : "AI"}: ${m.content}`)
    .join("\n");
}

function truncateDiaryContent(content: string, maxChars: number): string {
  const t = content.trim();
  if (t.length <= maxChars) return t;
  return `${t.slice(0, maxChars)}…`;
}

function formatMatchedDiaries(
  rows: { title: string | null; content: string; updated_at: Date }[]
): string {
  if (!rows.length) return "";
  return rows
    .map((r, i) => {
      const date = r.updated_at.toISOString().slice(0, 10);
      const title = (r.title ?? "").trim() || "无标题";
      const body = truncateDiaryContent(r.content ?? "", DIARY_SNIPPET_MAX_CHARS);
      return `--- 日记 ${i + 1}（${date} · ${title}）---\n${body}`;
    })
    .join("\n\n");
}

export async function buildChatMessages(
  userId: string,
  userMessage: string,
  opts?: { useIntakeTask?: boolean }
): Promise<{ system: string; user: string }> {
  const profileRes = await query<{ content: string }>(
    `SELECT content FROM public.profiles WHERE user_id = $1::uuid`,
    [userId]
  );
  const profile_text = profileRes.rows[0]?.content ?? DEFAULT_PROFILE_CONTENT;

  const memRes = await query<{ role: string; content: string }>(
    `SELECT role, content FROM public.get_recent_memory_messages($1::uuid, $2)`,
    [userId, 30]
  );
  const short_ctx = formatShortCtx(memRes.rows);

  const emb = await getEmbedding(userMessage);
  const embLit = toVectorLiteral(emb);

  let summaries_text = "";
  let anchors_text = "";
  let diaries_text = "";

  const sums = await query<{ summary_date: Date; content: string }>(
    `SELECT summary_date, content FROM public.match_summaries_daily($1::uuid, $2::vector, $3)`,
    [userId, embLit, 2]
  );
  const anchorsPromise = query<{
    event_name: string;
    initial_thought: string | null;
    current_thought: string | null;
  }>(
    `SELECT event_name, initial_thought, current_thought
     FROM public.match_anchors($1::uuid, $2::vector, $3)`,
    [userId, embLit, 1]
  );
  const diariesPromise = query<{
    id: number;
    title: string | null;
    content: string;
    updated_at: Date;
  }>(
    `SELECT id, title, content, updated_at
     FROM public.match_diaries($1::uuid, $2::vector, $3)`,
    [userId, embLit, DIARY_MATCH_COUNT]
  );

  if (sums.rows.length) {
    summaries_text = sums.rows
      .map((r) => `- ${r.summary_date.toISOString().slice(0, 10)}: ${r.content}`)
      .join("\n");
  }

  const [anchors, diaries] = await Promise.all([anchorsPromise, diariesPromise]);
  if (anchors.rows[0]) {
    const a = anchors.rows[0];
    anchors_text =
      `事件：${a.event_name}\n` +
      `最初看法：${a.initial_thought ?? ""}\n` +
      `当前看法：${a.current_thought ?? ""}\n`;
  }
  diaries_text = formatMatchedDiaries(diaries.rows);

  return renderChatMessages({
    profile_text,
    short_ctx,
    summaries_text,
    anchors_text,
    diaries_text,
    user_message: userMessage,
    useIntakeTask: opts?.useIntakeTask ?? false,
  });
}

/** @deprecated 使用 buildChatMessages */
export async function buildMemoryPrompt(
  userId: string,
  userMessage: string
): Promise<string> {
  const { system, user } = await buildChatMessages(userId, userMessage);
  return `${system}\n\n${user}`;
}

export async function updateUserMessageEmbedding(
  userId: string,
  messageId: number,
  content: string
): Promise<boolean> {
  const embedding = await getEmbedding(content);
  const res = await query(
    `UPDATE public.messages SET embedding = $1::vector
     WHERE id = $2 AND user_id = $3::uuid AND role = 'user'`,
    [toVectorLiteral(embedding), messageId, userId]
  );
  return (res.rowCount ?? 0) > 0;
}

export async function insertAssistantMessage(
  userId: string,
  content: string
): Promise<void> {
  const embedding = await getEmbedding(content);
  await query(
    `INSERT INTO public.messages (user_id, role, content, embedding)
     VALUES ($1::uuid, 'assistant', $2, $3::vector)`,
    [userId, content, toVectorLiteral(embedding)]
  );
}

export async function ensureDefaultProfile(userId: string): Promise<void> {
  await query(
    `INSERT INTO public.profiles (user_id, content) VALUES ($1::uuid, $2)
     ON CONFLICT (user_id) DO NOTHING`,
    [userId, DEFAULT_PROFILE_CONTENT]
  );
}
