import type { FastifyInstance } from "fastify";
import { getEmbedding } from "../llm/openrouter.js";
import { query, toVectorLiteral } from "../db.js";
import { requireUser } from "../auth/middleware.js";

async function indexDiaryEmbedding(userId: string, diaryId: number): Promise<void> {
  const { rows } = await query<{ title: string; content: string }>(
    `SELECT title, content FROM public.diaries WHERE id = $1 AND user_id = $2::uuid`,
    [diaryId, userId]
  );
  const row = rows[0];
  if (!row) return;
  const text = `${row.title ?? ""}\n${row.content ?? ""}`.trim() || " ";
  const embedding = await getEmbedding(text);
  await query(
    `UPDATE public.diaries SET embedding = $1::vector WHERE id = $2 AND user_id = $3::uuid`,
    [toVectorLiteral(embedding), diaryId, userId]
  );
}

export async function registerDiaryRoutes(app: FastifyInstance): Promise<void> {
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
      created_at: Date;
      updated_at: Date;
    }>(
      `SELECT id, title, content, created_at, updated_at
       FROM public.diaries
       WHERE user_id = $1::uuid
       ORDER BY updated_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, pageSize, offset]
    );

    return reply.send({
      items: rows.map((r) => ({
        id: r.id,
        title: r.title,
        content: r.content,
        created_at: r.created_at.toISOString(),
        updated_at: r.updated_at.toISOString(),
      })),
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
        created_at: Date;
        updated_at: Date;
      }>(
        `SELECT id, title, content, created_at, updated_at
         FROM public.diaries
         WHERE user_id = $1::uuid
         ORDER BY updated_at DESC
         LIMIT $2`,
        [userId, limit]
      );
      return reply.send({
        items: rows.map((r) => ({
          id: r.id,
          title: r.title,
          content: r.content,
          created_at: r.created_at.toISOString(),
          updated_at: r.updated_at.toISOString(),
        })),
      });
    }
  );

  app.post<{ Body: { title?: string; content?: string } }>(
    "/api/diaries",
    { preHandler: requireUser },
    async (request, reply) => {
      const userId = request.userId!;
      const title = request.body?.title ?? "";
      const content = request.body?.content ?? "";
      const { rows } = await query<{
        id: number;
        created_at: Date;
        updated_at: Date;
      }>(
        `INSERT INTO public.diaries (user_id, title, content)
         VALUES ($1::uuid, $2, $3)
         RETURNING id, created_at, updated_at`,
        [userId, title, content]
      );
      const row = rows[0];
      void indexDiaryEmbedding(userId, row.id).catch((e) => {
        request.log.warn({ err: e }, "diary embedding failed");
      });
      return reply.send({
        id: row.id,
        title,
        content,
        created_at: row.created_at.toISOString(),
        updated_at: row.updated_at.toISOString(),
      });
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
    const title = request.body?.title ?? "";
    const content = request.body?.content ?? "";
    const { rows } = await query<{
      id: number;
      created_at: Date;
      updated_at: Date;
    }>(
      `UPDATE public.diaries SET title = $1, content = $2
       WHERE id = $3 AND user_id = $4::uuid
       RETURNING id, created_at, updated_at`,
      [title, content, diaryId, userId]
    );
    if (!rows[0]) {
      return reply.code(404).send({ detail: "Diary not found" });
    }
    void indexDiaryEmbedding(userId, diaryId).catch((e) => {
      request.log.warn({ err: e }, "diary embedding failed");
    });
    const row = rows[0];
    return reply.send({
      id: row.id,
      title,
      content,
      created_at: row.created_at.toISOString(),
      updated_at: row.updated_at.toISOString(),
    });
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
