import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { config } from "../config.js";
import { query } from "../db.js";

export interface AdminUserListItem {
  id: string;
  username: string;
  created_at: string;
  message_count: number;
  summary_count: number;
  anchor_count: number;
}

export interface MessageBase {
  id: number;
  role: "user" | "assistant";
  content: string;
  created_at: string;
}

export interface AdminUserDetail {
  user: { id: string; username: string; created_at: string };
  profile_content: string | null;
  profile_updated_at: string | null;
  message_count: number;
  summary_count: number;
  anchor_count: number;
  recent_messages: MessageBase[];
}

async function requireAdmin(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const key = request.headers["x-admin-key"];
  const secret = config.adminSecret;
  if (!secret || key !== secret) {
    reply.code(401).send({ detail: "Invalid or missing admin key" });
  }
}

export async function registerAdminRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/api/admin/users",
    { preHandler: requireAdmin },
    async (_request, reply) => {
      const { rows } = await query<{
        id: string;
        username: string;
        created_at: Date;
        message_count: string;
        summary_count: string;
        anchor_count: string;
      }>(`
        SELECT
          u.id::text AS id,
          COALESCE(
            u.raw_user_meta_data->>'username',
            split_part(u.email, '@', 1),
            '用户'
          ) AS username,
          u.created_at AS created_at,
          (SELECT count(*) FROM public.messages m WHERE m.user_id = u.id) AS message_count,
          (SELECT count(*) FROM public.summaries s WHERE s.user_id = u.id) AS summary_count,
          (SELECT count(*) FROM public.anchors a WHERE a.user_id = u.id) AS anchor_count
        FROM auth.users u
        ORDER BY u.created_at DESC
      `);
      const body: AdminUserListItem[] = rows.map((r) => ({
        id: r.id,
        username: r.username,
        created_at: r.created_at.toISOString(),
        message_count: parseInt(r.message_count, 10) || 0,
        summary_count: parseInt(r.summary_count, 10) || 0,
        anchor_count: parseInt(r.anchor_count, 10) || 0,
      }));
      return reply.send(body);
    }
  );

  app.get<{ Params: { userId: string }; Querystring: { messages_limit?: string } }>(
    "/api/admin/users/:userId",
    { preHandler: requireAdmin },
    async (request, reply) => {
      const { userId } = request.params;
      const messagesLimit = Math.min(
        parseInt(request.query.messages_limit ?? "50", 10) || 50,
        200
      );

      const userRes = await query<{
        id: string;
        username: string;
        created_at: Date;
      }>(
        `
        SELECT
          u.id::text AS id,
          COALESCE(
            u.raw_user_meta_data->>'username',
            split_part(u.email, '@', 1),
            '用户'
          ) AS username,
          u.created_at AS created_at
        FROM auth.users u
        WHERE u.id = $1::uuid
        `,
        [userId]
      );
      if (userRes.rows.length === 0) {
        return reply.code(404).send({ detail: "User not found" });
      }
      const userRow = userRes.rows[0];

      const profileRes = await query<{ content: string; updated_at: Date }>(
        `SELECT content, updated_at FROM public.profiles WHERE user_id = $1::uuid`,
        [userId]
      );
      const profile = profileRes.rows[0];

      const counts = await query<{
        msg: string;
        sum: string;
        anc: string;
      }>(
        `
        SELECT
          (SELECT count(*) FROM public.messages WHERE user_id = $1::uuid) AS msg,
          (SELECT count(*) FROM public.summaries WHERE user_id = $1::uuid) AS sum,
          (SELECT count(*) FROM public.anchors WHERE user_id = $1::uuid) AS anc
        `,
        [userId]
      );
      const c = counts.rows[0];

      const msgRes = await query<{
        id: number;
        role: string;
        content: string;
        created_at: Date;
      }>(
        `
        SELECT id, role, content, created_at
        FROM public.messages
        WHERE user_id = $1::uuid
        ORDER BY id DESC
        LIMIT $2
        `,
        [userId, messagesLimit]
      );
      const recent_messages: MessageBase[] = msgRes.rows.reverse().map((m) => ({
        id: m.id,
        role: m.role as "user" | "assistant",
        content: m.content,
        created_at:
          m.created_at instanceof Date
            ? m.created_at.toISOString()
            : String(m.created_at),
      }));

      const body: AdminUserDetail = {
        user: {
          id: userRow.id,
          username: userRow.username,
          created_at: userRow.created_at.toISOString(),
        },
        profile_content: profile?.content ?? null,
        profile_updated_at: profile?.updated_at?.toISOString() ?? null,
        message_count: parseInt(c?.msg ?? "0", 10) || 0,
        summary_count: parseInt(c?.sum ?? "0", 10) || 0,
        anchor_count: parseInt(c?.anc ?? "0", 10) || 0,
        recent_messages,
      };
      return reply.send(body);
    }
  );
}
