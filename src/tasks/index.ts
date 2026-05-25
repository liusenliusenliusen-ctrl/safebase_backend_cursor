import type pg from "pg";
import { pool, query, toVectorLiteral } from "../db.js";
import { getEmbedding, streamChatCompletion } from "../llm/openrouter.js";
import { renderPrompt } from "../prompts/index.js";

const DEFAULT_PROFILE_CONTENT = `# 核心画像
尚未生成

## 触发清单
尚未记录

## 资源库
尚未记录`;

function dateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function yesterdayRange(): { yesterday: string; today: string; yesterdayStart: Date; todayStart: Date } {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterdayStart = new Date(today);
  yesterdayStart.setDate(yesterdayStart.getDate() - 1);
  return {
    yesterday: dateOnly(yesterdayStart),
    today: dateOnly(today),
    yesterdayStart,
    todayStart: today,
  };
}

async function activeUserIds(): Promise<string[]> {
  const { rows } = await query<{ user_id: string }>(`
    SELECT user_id::text FROM public.profiles
    UNION
    SELECT DISTINCT user_id::text FROM public.messages
  `);
  return rows.map((r) => r.user_id);
}

async function fetchRecentDiariesText(
  uid: string,
  limit = 5,
  updatedSince?: Date | null,
  maxCharsPer = 600
): Promise<string> {
  const { rows } = updatedSince
    ? await query<{ title: string | null; content: string | null }>(
        `
        SELECT title, content FROM public.diaries
        WHERE user_id = $1::uuid AND updated_at >= $2
        ORDER BY updated_at DESC LIMIT $3
        `,
        [uid, updatedSince, limit]
      )
    : await query<{ title: string | null; content: string | null }>(
        `
        SELECT title, content FROM public.diaries
        WHERE user_id = $1::uuid
        ORDER BY updated_at DESC LIMIT $2
        `,
        [uid, limit]
      );
  if (rows.length === 0) return "";
  return rows
    .map((r) => {
      const t = (r.title ?? "无标题").trim();
      const c = (r.content ?? "").slice(0, maxCharsPer);
      return `- ${t}: ${c}`;
    })
    .join("\n");
}

async function ensureProfile(client: pg.PoolClient, uid: string): Promise<string> {
  const res = await client.query<{ content: string }>(
    `SELECT content FROM public.profiles WHERE user_id = $1::uuid`,
    [uid]
  );
  if (res.rows[0]?.content) return res.rows[0].content;
  await client.query(
    `INSERT INTO public.profiles (user_id, content) VALUES ($1::uuid, $2)
     ON CONFLICT (user_id) DO NOTHING`,
    [uid, DEFAULT_PROFILE_CONTENT]
  );
  return DEFAULT_PROFILE_CONTENT;
}

export async function generateDailySummaries(): Promise<void> {
  const { yesterday, yesterdayStart, todayStart } = yesterdayRange();
  const userIds = await activeUserIds();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const uid of userIds) {
      const exist = await client.query(
        `SELECT 1 FROM public.summaries
         WHERE user_id = $1::uuid AND type = 'daily' AND summary_date = $2::date`,
        [uid, yesterday]
      );
      if (exist.rows.length > 0) continue;

      const msgs = await client.query<{ role: string; content: string }>(
        `SELECT role, content FROM public.messages
         WHERE user_id = $1::uuid
           AND created_at >= $2 AND created_at < $3
         ORDER BY created_at ASC`,
        [uid, yesterdayStart, todayStart]
      );
      if (msgs.rows.length === 0) continue;

      const convoText = msgs.rows.map((m) => `${m.role}: ${m.content}`).join("\n");
      const diariesText = await fetchRecentDiariesText(uid, 3, yesterdayStart);
      const prompt = renderPrompt("daily_summary", {
        convo_text: convoText,
        diaries_text: diariesText || "（无）",
      });
      const full = await streamChatCompletion(prompt);
      const emb = await getEmbedding(full);
      await client.query(
        `INSERT INTO public.summaries (user_id, type, content, summary_date, embedding)
         VALUES ($1::uuid, 'daily', $2, $3::date, $4::vector)`,
        [uid, full, yesterday, toVectorLiteral(emb)]
      );
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

export async function updateProfiles(): Promise<void> {
  const userIds = await activeUserIds();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const uid of userIds) {
      const currentContent = await ensureProfile(client, uid);

      const sumRes = await client.query<{ summary_date: Date; content: string }>(
        `SELECT summary_date, content FROM public.summaries
         WHERE user_id = $1::uuid AND type = 'daily'
         ORDER BY summary_date DESC LIMIT 7`,
        [uid]
      );
      const summariesText = sumRes.rows
        .map((s) => `[${dateOnly(s.summary_date)}] ${s.content}`)
        .join("\n\n");

      const msgRes = await client.query<{ role: string; content: string }>(
        `SELECT role, content FROM public.messages
         WHERE user_id = $1::uuid ORDER BY created_at DESC LIMIT 50`,
        [uid]
      );
      const msgs = [...msgRes.rows].reverse();
      const convoText = msgs.length
        ? msgs.map((m) => `${m.role}: ${m.content}`).join("\n")
        : "（暂无对话）";

      const diariesText = await fetchRecentDiariesText(uid, 5);
      if (!summariesText && msgs.length === 0 && !diariesText) continue;

      const prompt = renderPrompt("profile_update", {
        current_content: currentContent,
        summaries_text: summariesText || "（暂无）",
        convo_text: convoText.slice(0, 8000),
        diaries_text: diariesText || "（暂无）",
      });
      const full = (await streamChatCompletion(prompt)).trim();
      if (!full || !full.includes("## 核心画像")) continue;

      await client.query(
        `UPDATE public.profiles SET content = $2, updated_at = now() WHERE user_id = $1::uuid`,
        [uid, full]
      );
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

export async function maintainAnchors(): Promise<void> {
  const userIds = await activeUserIds();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const uid of userIds) {
      const anchorRes = await client.query<{
        id: number;
        event_name: string;
        initial_thought: string | null;
        current_thought: string | null;
        updated_at: Date;
      }>(
        `SELECT id, event_name, initial_thought, current_thought, updated_at
         FROM public.anchors WHERE user_id = $1::uuid`,
        [uid]
      );
      const anchors = anchorRes.rows;

      for (const anchor of anchors) {
        const newMsgs = await client.query<{ role: string; content: string }>(
          `SELECT role, content FROM public.messages
           WHERE user_id = $1::uuid AND created_at > $2
           ORDER BY created_at ASC`,
          [uid, anchor.updated_at]
        );
        if (newMsgs.rows.length === 0) continue;

        const convoSince = newMsgs.rows
          .map((m) => `${m.role}: ${m.content}`)
          .join("\n")
          .slice(0, 6000);
        const diariesSince = await fetchRecentDiariesText(uid, 3, anchor.updated_at);

        const prompt = renderPrompt("anchor_update_current_thought", {
          event_name: anchor.event_name,
          initial_thought: anchor.initial_thought || "（无）",
          current_thought: anchor.current_thought || "（无）",
          convo_since: convoSince,
          diaries_text: diariesSince || "（无）",
        });
        const full = (await streamChatCompletion(prompt)).trim();
        if (!full) continue;

        const emb = await getEmbedding(
          `${anchor.event_name}\n${anchor.initial_thought ?? ""}\n${full}`
        );
        await client.query(
          `UPDATE public.anchors
           SET current_thought = $2, embedding = $3::vector, updated_at = now()
           WHERE id = $1`,
          [anchor.id, full, toVectorLiteral(emb)]
        );
      }

      const sumRes = await client.query<{ summary_date: Date; content: string }>(
        `SELECT summary_date, content FROM public.summaries
         WHERE user_id = $1::uuid AND type = 'daily'
         ORDER BY summary_date DESC LIMIT 5`,
        [uid]
      );
      const summariesText = sumRes.rows
        .map((s) => `[${dateOnly(s.summary_date)}] ${s.content}`)
        .join("\n\n");

      const msgRes = await client.query<{ role: string; content: string }>(
        `SELECT role, content FROM public.messages
         WHERE user_id = $1::uuid ORDER BY created_at DESC LIMIT 80`,
        [uid]
      );
      const msgs = [...msgRes.rows].reverse();
      const convoText = msgs.length
        ? msgs.map((m) => `${m.role}: ${m.content}`).join("\n").slice(0, 10000)
        : "";
      const diariesText = await fetchRecentDiariesText(uid, 5);

      if (!summariesText && !convoText && !diariesText) continue;

      const existingNames = new Set(
        anchors.map((a) => a.event_name.trim().toLowerCase())
      );

      const prompt2 = renderPrompt("anchor_extract", {
        summaries_text: summariesText || "（无）",
        convo_text: convoText,
        diaries_text: diariesText || "（无）",
      });
      const full2 = (await streamChatCompletion(prompt2)).trim();
      const lines = full2
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l && l.toLowerCase() !== "无");

      for (const eventName of lines.slice(0, 3)) {
        if (!eventName || existingNames.has(eventName.toLowerCase())) continue;

        const bootstrapPrompt = renderPrompt("anchor_update_current_thought", {
          event_name: eventName,
          initial_thought: "（无）",
          current_thought: "（无）",
          convo_since: (convoText || "").slice(0, 6000),
          diaries_text: diariesText || "（无）",
        });
        const firstView = (await streamChatCompletion(bootstrapPrompt)).trim() || null;
        const emb = await getEmbedding(`${eventName}\n${firstView ?? ""}`);
        await client.query(
          `INSERT INTO public.anchors
           (user_id, event_name, initial_thought, current_thought, evolution_history, embedding)
           VALUES ($1::uuid, $2, $3, $3, '[]'::jsonb, $4::vector)`,
          [uid, eventName, firstView, toVectorLiteral(emb)]
        );
        existingNames.add(eventName.toLowerCase());
      }
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
