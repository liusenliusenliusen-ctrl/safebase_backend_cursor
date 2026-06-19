import type { FastifyInstance } from "fastify";
import { pool } from "../db.js";
import { requireUser } from "../auth/middleware.js";

export async function registerAccountRoutes(app: FastifyInstance): Promise<void> {
  app.delete("/api/account", { preHandler: requireUser }, async (request, reply) => {
    const userId = request.userId!;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`DELETE FROM public.messages WHERE user_id = $1::uuid`, [userId]);
      await client.query(`DELETE FROM public.diaries WHERE user_id = $1::uuid`, [userId]);
      await client.query(`DELETE FROM public.summaries WHERE user_id = $1::uuid`, [userId]);
      await client.query(`DELETE FROM public.anchors WHERE user_id = $1::uuid`, [userId]);
      await client.query(`DELETE FROM public.profiles WHERE user_id = $1::uuid`, [userId]);
      await client.query(
        `DELETE FROM public.data_access_audit
         WHERE subject_user_id = $1::uuid OR actor_id = $1::uuid`,
        [userId]
      );
      await client.query(`DELETE FROM public.users WHERE id = $1::uuid`, [userId]);
      await client.query("COMMIT");
      return reply.send({ ok: true });
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  });
}
