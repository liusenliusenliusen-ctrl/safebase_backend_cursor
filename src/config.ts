import { config as loadEnv } from "dotenv";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = join(root, ".env");
if (existsSync(envPath)) {
  loadEnv({ path: envPath });
}

const defaultPromptsDir = join(root, "prompts");

function envInt(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export const config = {
  root,
  appName: process.env.APP_NAME ?? "CPTSD Healing Companion Backend",
  port: envInt("PORT", 8000),
  host: process.env.HOST ?? "0.0.0.0",
  databaseUrl: normalizeDatabaseUrl(
    process.env.DATABASE_URL ??
      "postgresql://postgres:postgres@127.0.0.1:5432/safebase"
  ),
  jwtSecret: process.env.JWT_SECRET ?? "",
  adminSecret: process.env.ADMIN_SECRET ?? "",
  openrouterApiKey: process.env.OPENROUTER_API_KEY ?? "",
  openrouterBaseUrl: (
    process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1"
  ).replace(/\/$/, ""),
  openrouterChatModel:
    process.env.OPENROUTER_CHAT_MODEL ?? "deepseek/deepseek-chat",
  openrouterEmbeddingModel:
    process.env.OPENROUTER_EMBEDDING_MODEL ?? "openai/text-embedding-3-large",
  openrouterEmbeddingDimensions: envInt("OPENROUTER_EMBEDDING_DIMENSIONS", 2048),
  promptTemplateDir:
    process.env.PROMPT_TEMPLATE_DIR?.trim() ||
    (existsSync(defaultPromptsDir) ? defaultPromptsDir : null),
};

function normalizeDatabaseUrl(url: string): string {
  return url.replace(/^postgresql\+asyncpg:\/\//, "postgresql://");
}
