import type { FastifyInstance } from "fastify";
import { getEmbedding } from "../llm/openrouter.js";
import { query, toVectorLiteral } from "../db.js";
import { requireUser } from "../auth/middleware.js";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidEntryDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

function formatDiaryRow(r: {
  id: number;
  title: string;
  content: string;
  entry_date: Date | string;
  created_at: Date;
  updated_at: Date;
}) {
  const entryDate =
    typeof r.entry_date === "string"
      ? r.entry_date.slice(0, 10)
      : r.entry_date.toISOString().slice(0, 10);
  return {
    id: r.id,
    title: r.title,
    content: r.content,
    entry_date: entryDate,
    created_at: r.created_at.toISOString(),
    updated_at: r.updated_at.toISOString(),
  };
}

async function indexDiaryEmbedding(userId: string, diaryId: number): Promise<void> {
  const { rows } = await query<{
    title: string;
    content: string;
    entry_date: Date;
  }>(
    `SELECT title, content, entry_date FROM public.diaries WHERE id = $1 AND user_id = $2::uuid`,
    [diaryId, userId]
  );
  const row = rows[0];
  if (!row) return;
  const dateStr = row.entry_date.toISOString().slice(0, 10);
  const text = `${dateStr}\n${row.content ?? ""}`.trim() || dateStr;
  const embedding = await getEmbedding(text);
  await query(
    `UPDATE public.diaries SET embedding = $1::vector WHERE id = $2 AND user_id = $3::uuid`,
    [toVectorLiteral(embedding), diaryId, userId]
  );
}

export async function registerDiaryRoutes(app: FastifyInstance): Promise<void> {
  /** 连续日记流：按 entry_date 升序 */
  app.get<{
    Querystring: { limit?: string; q?: string };
  }>("/api/diaries/journal", { preHandler: requireUser }, async (request, reply) => {
    const userId = request.userId!;
    const limit = Math.min(parseInt(request.query.limit ?? "365", 10) || 365, 1000);
    const q = (request.query.q ?? "").trim();

    const { rows } = await query<{
      id: number;
      title: string;
      content: string;
      entry_date: Date;
      created_at: Date;
      updated_at: Date;
    }>(
      q
        ? `SELECT id, title, content, entry_date, created_at, updated_at
           FROM public.diaries
           WHERE user_id = $1::uuid
             AND (content ILIKE $3 OR title ILIKE $3)
           ORDER BY entry_date ASC
           LIMIT $2`
        : `SELECT id, title, content, entry_date, created_at, updated_at
           FROM public.diaries
           WHERE user_id = $1::uuid
           ORDER BY entry_date ASC
           LIMIT $2`,
      q ? [userId, limit, `%${q}%`] : [userId, limit]
    );

    return reply.send({ items: rows.map(formatDiaryRow) });
  });

  /** 有内容的日期列表（侧栏），新→旧 */
  app.get("/api/diaries/dates", { preHandler: requireUser }, async (request, reply) => {
    const userId = request.userId!;
    const { rows } = await query<{ entry_date: Date; excerpt: string }>(
      `SELECT entry_date,
              left(regexp_replace(content, '\\s+', ' ', 'g'), 48) AS excerpt
       FROM public.diaries
       WHERE user_id = $1::uuid
         AND length(trim(content)) > 0
       ORDER BY entry_date DESC
       LIMIT 400`,
      [userId]
    );
    return reply.send({
      items: rows.map((r) => ({
        entry_date: r.entry_date.toISOString().slice(0, 10),
        excerpt: r.excerpt ?? "",
      })),
    });
  });

  /** 按日写入：空内容则删除该日 */
  app.put<{
    Params: { date: string };
    Body: { content?: string; title?: string };
  }>("/api/diaries/by-date/:date", { preHandler: requireUser }, async (request, reply) => {
    const userId = request.userId!;
    const entryDate = request.params.date;
    if (!isValidEntryDate(entryDate)) {
      return reply.code(400).send({ detail: "Invalid date, expect YYYY-MM-DD" });
    }
    const content = request.body?.content ?? "";
    const title =
      (request.body?.title ?? "").trim() || entryDate;

    if (!content.trim()) {
      await query(
        `DELETE FROM public.diaries WHERE user_id = $1::uuid AND entry_date = $2::date`,
        [userId, entryDate]
      );
      return reply.send({ ok: true, deleted: true, entry_date: entryDate });
    }

    const { rows } = await query<{
      id: number;
      title: string;
      content: string;
      entry_date: Date;
      created_at: Date;
      updated_at: Date;
    }>(
      `INSERT INTO public.diaries (user_id, title, content, entry_date)
       VALUES ($1::uuid, $2, $3, $4::date)
       ON CONFLICT (user_id, entry_date) DO UPDATE
         SET title = EXCLUDED.title,
             content = EXCLUDED.content,
             updated_at = now()
       RETURNING id, title, content, entry_date, created_at, updated_at`,
      [userId, title, content, entryDate]
    );
    const row = rows[0];
    void indexDiaryEmbedding(userId, row.id).catch((e) => {
      request.log.warn({ err: e }, "diary embedding failed");
    });
    return reply.send(formatDiaryRow(row));
  });

  app.get<{
    Querystring: { page?: string; page_size?: string };
  }>("/api/diaries", { preHandler: requireUser }, async (request, reply) => {
    const userId = request.userId!;
    const page = Math.max(parseInt(request.query.page ?? "1", 10) || 1, 1);
    const pageSize = Math.min(
      parseInt(request.query.page_size ?? "10", 10) || 10,
      100
    );
    const offset = (page - 1) * pageSize;

    const countRes = await query<{ count: string }>(
      `SELECT count(*)::text AS count FROM public.diaries WHERE user_id = $1::uuid`,
      [userId]
    );
    const total = parseInt(countRes.rows[0]?.count ?? "0", 10) || 0;

    const { rows } = await query<{
      id: number;
      title: string;
      content: string;
      entry_date: Date;
      created_at: Date;
      updated_at: Date;
    }>(
      `SELECT id, title, content, entry_date, created_at, updated_at
       FROM public.diaries
       WHERE user_id = $1::uuid
       ORDER BY entry_date DESC
       LIMIT $2 OFFSET $3`,
      [userId, pageSize, offset]
    );

    return reply.send({
      items: rows.map(formatDiaryRow),
      total,
    });
  });

  app.get<{ Querystring: { limit?: string } }>(
    "/api/diaries/batch",
    { preHandler: requireUser },
    async (request, reply) => {
      const userId = request.userId!;
      const limit = Math.min(parseInt(request.query.limit ?? "500", 10) || 500, 1000);
      const { rows } = await query<{
        id: number;
        title: string;
        content: string;
        entry_date: Date;
        created_at: Date;
        updated_at: Date;
      }>(
        `SELECT id, title, content, entry_date, created_at, updated_at
         FROM public.diaries
         WHERE user_id = $1::uuid
         ORDER BY entry_date DESC
         LIMIT $2`,
        [userId, limit]
      );
      return reply.send({
        items: rows.map(formatDiaryRow),
      });
    }
  );

  app.post<{ Body: { title?: string; content?: string; entry_date?: string } }>(
    "/api/diaries",
    { preHandler: requireUser },
    async (request, reply) => {
      const userId = request.userId!;
      const content = request.body?.content ?? "";
      const entryDate =
        request.body?.entry_date && isValidEntryDate(request.body.entry_date)
          ? request.body.entry_date
          : new Date().toISOString().slice(0, 10);
      const title = (request.body?.title ?? "").trim() || entryDate;

      if (!content.trim()) {
        return reply.code(400).send({ detail: "Content required" });
      }

      const { rows } = await query<{
        id: number;
        title: string;
        content: string;
        entry_date: Date;
        created_at: Date;
        updated_at: Date;
      }>(
        `INSERT INTO public.diaries (user_id, title, content, entry_date)
         VALUES ($1::uuid, $2, $3, $4::date)
         ON CONFLICT (user_id, entry_date) DO UPDATE
           SET title = EXCLUDED.title,
               content = EXCLUDED.content,
               updated_at = now()
         RETURNING id, title, content, entry_date, created_at, updated_at`,
        [userId, title, content, entryDate]
      );
      const row = rows[0];
      void indexDiaryEmbedding(userId, row.id).catch((e) => {
        request.log.warn({ err: e }, "diary embedding failed");
      });
      return reply.send(formatDiaryRow(row));
    }
  );

  app.patch<{
    Params: { id: string };
    Body: { title?: string; content?: string };
  }>("/api/diaries/:id", { preHandler: requireUser }, async (request, reply) => {
    const userId = request.userId!;
    const diaryId = parseInt(request.params.id, 10);
    if (!Number.isFinite(diaryId)) {
      return reply.code(400).send({ detail: "Invalid diary id" });
    }
    const title = request.body?.title;
    const content = request.body?.content;
    if (content !== undefined && !String(content).trim()) {
      const del = await query(
        `DELETE FROM public.diaries WHERE id = $1 AND user_id = $2::uuid RETURNING entry_date`,
        [diaryId, userId]
      );
      if (del.rowCount === 0) {
        return reply.code(404).send({ detail: "Diary not found" });
      }
      return reply.send({ ok: true, deleted: true });
    }

    const { rows } = await query<{
      id: number;
      title: string;
      content: string;
      entry_date: Date;
      created_at: Date;
      updated_at: Date;
    }>(
      `UPDATE public.diaries
       SET title = COALESCE($1, title),
           content = COALESCE($2, content)
       WHERE id = $3 AND user_id = $4::uuid
       RETURNING id, title, content, entry_date, created_at, updated_at`,
      [title ?? null, content ?? null, diaryId, userId]
    );
    if (!rows[0]) {
      return reply.code(404).send({ detail: "Diary not found" });
    }
    void indexDiaryEmbedding(userId, diaryId).catch((e) => {
      request.log.warn({ err: e }, "diary embedding failed");
    });
    return reply.send(formatDiaryRow(rows[0]));
  });

  app.delete<{ Params: { id: string } }>(
    "/api/diaries/:id",
    { preHandler: requireUser },
    async (request, reply) => {
      const userId = request.userId!;
      const diaryId = parseInt(request.params.id, 10);
      if (!Number.isFinite(diaryId)) {
        return reply.code(400).send({ detail: "Invalid diary id" });
      }
      const res = await query(
        `DELETE FROM public.diaries WHERE id = $1 AND user_id = $2::uuid`,
        [diaryId, userId]
      );
      if (res.rowCount === 0) {
        return reply.code(404).send({ detail: "Diary not found" });
      }
      return reply.send({ ok: true });
    }
  );
}
