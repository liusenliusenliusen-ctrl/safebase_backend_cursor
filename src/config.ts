import { config as loadEnv } from "dotenv";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** 含 package.json 的目录（dev: 仓库根；prod: dist/src → 上两级） */
function findProjectRoot(start: string): string {
  let dir = resolve(start);
  for (;;) {
    if (existsSync(join(dir, "package.json"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return resolve(start);
    dir = parent;
  }
}

const root = findProjectRoot(dirname(fileURLToPath(import.meta.url)));
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
      "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
  ),
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
