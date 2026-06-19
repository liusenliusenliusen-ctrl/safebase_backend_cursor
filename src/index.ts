import Fastify from "fastify";
import cors from "@fastify/cors";
import { config } from "./config.js";
import { registerAdminRoutes } from "./admin/routes.js";
import { registerAuthRoutes } from "./auth/routes.js";
import { registerChatRoutes } from "./chat/routes.js";
import { registerDiaryRoutes } from "./diaries/routes.js";
import { registerMessageRoutes } from "./messages/routes.js";
import { registerAccountRoutes } from "./account/routes.js";
import { pool } from "./db.js";

const app = Fastify({ logger: true });

await app.register(cors, { origin: true });

app.setErrorHandler((error, _request, reply) => {
  app.log.error(error);
  reply.code(500).send({ detail: "Internal Server Error" });
});

app.get("/api/health", async () => ({ ok: true }));

await registerAuthRoutes(app);
await registerMessageRoutes(app);
await registerChatRoutes(app);
await registerDiaryRoutes(app);
await registerAccountRoutes(app);
await registerAdminRoutes(app);

app.addHook("onReady", async () => {
  if (config.openrouterApiKey.trim()) {
    app.log.info(
      "LLM OpenRouter chat=%s embedding=%s",
      config.openrouterChatModel,
      config.openrouterEmbeddingModel
    );
  } else {
    app.log.warn("未配置 OPENROUTER_API_KEY：对话与夜间批处理将不可用。");
  }
  app.log.info("API: /api/auth, /api/messages, /api/chat/stream, /api/diaries, /api/account, /api/admin");
});

try {
  await app.listen({ port: config.port, host: config.host });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

const shutdown = async () => {
  await app.close();
  await pool.end();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
