import type { FastifyInstance } from "fastify";
import { query } from "../db.js";
import { requireUser } from "../auth/middleware.js";

export async function registerMessageRoutes(app: FastifyInstance): Promise<void> {
  app.get<{
    Querystring: { limit?: string; before?: string };
  }>("/api/messages", { preHandler: requireUser }, async (request, reply) => {
    const userId = request.userId!;
    const limit = Math.min(parseInt(request.query.limit ?? "20", 10) || 20, 100);
    const before = request.query.before;

    let beforeCreatedAt: string | null = null;
    if (before) {
      const pivot = await query<{ created_at: Date }>(
        `SELECT created_at FROM public.messages WHERE id = $1::bigint AND user_id = $2::uuid`,
        [before, userId]
      );
      beforeCreatedAt = pivot.rows[0]?.created_at?.toISOString() ?? null;
    }

    const { rows } = await query<{
      id: string;
      role: string;
      content: string;
      created_at: Date;
    }>(
      beforeCreatedAt
        ? `SELECT id::text, role, content, created_at
           FROM public.messages
           WHERE user_id = $1::uuid AND created_at < $2::timestamptz
           ORDER BY created_at DESC
           LIMIT $3`
        : `SELECT id::text, role, content, created_at
           FROM public.messages
           WHERE user_id = $1::uuid
           ORDER BY created_at DESC
           LIMIT $2`,
      beforeCreatedAt ? [userId, beforeCreatedAt, limit + 1] : [userId, limit + 1]
    );

    const hasMore = rows.length > limit;
    const slice = hasMore ? rows.slice(0, limit) : rows;
    const messages = slice.reverse().map((r) => ({
      id: r.id,
      role: r.role,
      content: r.content,
      created_at: r.created_at.toISOString(),
    }));

    return reply.send({ messages, has_more: hasMore });
  });

  app.post<{ Body: { role?: string; content?: string } }>(
    "/api/messages",
    { preHandler: requireUser },
    async (request, reply) => {
      const userId = request.userId!;
      const role = request.body?.role;
      const content = request.body?.content?.trim() ?? "";
      if (role !== "user" && role !== "assistant") {
        return reply.code(400).send({ detail: "Invalid role" });
      }
      if (!content) {
        return reply.code(400).send({ detail: "Empty content" });
      }

      const { rows } = await query<{
        id: string;
        role: string;
        content: string;
        created_at: Date;
      }>(
        `INSERT INTO public.messages (user_id, role, content)
         VALUES ($1::uuid, $2, $3)
         RETURNING id::text, role, content, created_at`,
        [userId, role, content]
      );
      const row = rows[0];
      return reply.send({
        id: row.id,
        role: row.role,
        content: row.content,
        created_at: row.created_at.toISOString(),
      });
    }
  );

  app.delete(
    "/api/messages/last-user",
    { preHandler: requireUser },
    async (request, reply) => {
      const userId = request.userId!;
      const last = await query<{ id: string; role: string }>(
        `SELECT id::text, role FROM public.messages
         WHERE user_id = $1::uuid
         ORDER BY created_at DESC
         LIMIT 1`,
        [userId]
      );
      const row = last.rows[0];
      if (!row || row.role !== "user") {
        return reply.send({ ok: true });
      }
      await query(
        `DELETE FROM public.messages WHERE id = $1::bigint AND user_id = $2::uuid`,
        [row.id, userId]
      );
      return reply.send({ ok: true });
    }
  );
}
