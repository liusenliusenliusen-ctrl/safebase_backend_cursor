import Fastify from "fastify";
import cors from "@fastify/cors";
import { config } from "./config.js";
import { registerAdminRoutes } from "./admin/routes.js";
import { pool } from "./db.js";

const app = Fastify({ logger: true });

await app.register(cors, { origin: true });

app.setErrorHandler((error, _request, reply) => {
  app.log.error(error);
  reply.code(500).send({ detail: "Internal Server Error" });
});

await registerAdminRoutes(app);

app.addHook("onReady", async () => {
  if (config.openrouterApiKey.trim()) {
    app.log.info(
      "LLM OpenRouter chat=%s embedding=%s",
      config.openrouterChatModel,
      config.openrouterEmbeddingModel
    );
  } else {
    app.log.warn("未配置 OPENROUTER_API_KEY：夜间批处理（npm run tasks）将不可用。");
  }
  app.log.info(
    "HTTP 仅暴露 /api/admin/*；主站对话与认证在 Supabase Edge + Auth。"
  );
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
