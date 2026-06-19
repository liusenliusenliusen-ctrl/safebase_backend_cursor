import type { FastifyInstance } from "fastify";
import { query } from "../db.js";
import { requireUser } from "./middleware.js";
import { hashPassword, verifyPassword } from "./password.js";
import { signAccessToken } from "./jwt.js";
import { DEFAULT_PROFILE_CONTENT, usernameToEmail } from "./users.js";

interface AuthBody {
  username?: string;
  password?: string;
}

function normalizeUsername(raw: string): string {
  return raw.trim();
}

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: AuthBody }>("/api/auth/register", async (request, reply) => {
    const username = normalizeUsername(request.body?.username ?? "");
    const password = request.body?.password ?? "";
    if (username.length < 3 || username.length > 64) {
      return reply.code(400).send({ detail: "用户名长度应为 3–64" });
    }
    if (password.length < 6 || password.length > 128) {
      return reply.code(400).send({ detail: "密码长度应为 6–128" });
    }

    const email = usernameToEmail(username);
    const passwordHash = await hashPassword(password);

    const client = await (await import("../db.js")).pool.connect();
    try {
      await client.query("BEGIN");
      const ins = await client.query<{
        id: string;
        username: string;
        email: string;
        created_at: Date;
      }>(
        `INSERT INTO public.users (username, email, password_hash)
         VALUES ($1, $2, $3)
         RETURNING id::text, username, email, created_at`,
        [username, email, passwordHash]
      );
      const user = ins.rows[0];
      await client.query(
        `INSERT INTO public.profiles (user_id, content) VALUES ($1::uuid, $2)
         ON CONFLICT (user_id) DO NOTHING`,
        [user.id, DEFAULT_PROFILE_CONTENT]
      );
      await client.query("COMMIT");

      const token = await signAccessToken({
        sub: user.id,
        username: user.username,
      });
      return reply.send({
        token,
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          created_at: user.created_at.toISOString(),
        },
      });
    } catch (e: unknown) {
      await client.query("ROLLBACK");
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("users_username_unique") || msg.includes("users_email_unique")) {
        return reply.code(409).send({ detail: "用户名已被使用" });
      }
      throw e;
    } finally {
      client.release();
    }
  });

  app.post<{ Body: AuthBody }>("/api/auth/login", async (request, reply) => {
    const username = normalizeUsername(request.body?.username ?? "");
    const password = request.body?.password ?? "";
    if (!username || !password) {
      return reply.code(400).send({ detail: "请输入用户名和密码" });
    }

    const { rows } = await query<{
      id: string;
      username: string;
      email: string;
      password_hash: string;
      created_at: Date;
    }>(
      `SELECT id::text, username, email, password_hash, created_at
       FROM public.users WHERE username = $1`,
      [username]
    );
    const row = rows[0];
    if (!row || !(await verifyPassword(password, row.password_hash))) {
      return reply.code(401).send({ detail: "Invalid login credentials" });
    }

    const token = await signAccessToken({ sub: row.id, username: row.username });
    return reply.send({
      token,
      user: {
        id: row.id,
        username: row.username,
        email: row.email,
        created_at: row.created_at.toISOString(),
      },
    });
  });

  app.get("/api/auth/me", { preHandler: requireUser }, async (request, reply) => {
    const { rows } = await query<{
      id: string;
      username: string;
      email: string;
      created_at: Date;
    }>(
      `SELECT id::text, username, email, created_at FROM public.users WHERE id = $1::uuid`,
      [request.userId]
    );
    const row = rows[0];
    if (!row) {
      return reply.code(404).send({ detail: "User not found" });
    }
    return reply.send({
      user: {
        id: row.id,
        username: row.username,
        email: row.email,
        created_at: row.created_at.toISOString(),
      },
    });
  });
}
