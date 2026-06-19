import type { FastifyReply, FastifyRequest } from "fastify";
import { verifyAccessToken } from "./jwt.js";

declare module "fastify" {
  interface FastifyRequest {
    userId?: string;
    username?: string;
  }
}

export async function requireUser(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    reply.code(401).send({ detail: "Missing or invalid Authorization header" });
    return;
  }
  const token = header.slice("Bearer ".length).trim();
  if (!token) {
    reply.code(401).send({ detail: "Missing token" });
    return;
  }
  try {
    const payload = await verifyAccessToken(token);
    request.userId = payload.sub;
    request.username = payload.username;
  } catch {
    reply.code(401).send({ detail: "Invalid or expired token" });
  }
}
