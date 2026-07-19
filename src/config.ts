import { config as loadEnv } from "dotenv";
import { existsSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Project root: src/ in dev, dist/../ in production (dist/src/config.js). */
function resolveProjectRoot(): string {
  let root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  if (basename(root) === "dist") {
    root = resolve(root, "..");
  }
  return root;
}

const root = resolveProjectRoot();
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

function envFloat(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : fallback;
}

function envBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) return fallback;
  if (raw === "0" || raw === "false" || raw === "no") return false;
  if (raw === "1" || raw === "true" || raw === "yes") return true;
  return fallback;
}

function normalizeChatProvider(raw: string | undefined): "openrouter" | "deepseek" {
  const v = raw?.trim().toLowerCase();
  if (v === "deepseek") return "deepseek";
  return "openrouter";
}

export const config = {
  root,
  appName: process.env.APP_NAME ?? "Trauma Healing Companion Backend",
  port: envInt("PORT", 8000),
  host: process.env.HOST ?? "0.0.0.0",
  databaseUrl: normalizeDatabaseUrl(
    process.env.DATABASE_URL ??
      "postgresql://postgres:postgres@127.0.0.1:5433/trauma_heal"
  ),
  jwtSecret: process.env.JWT_SECRET ?? "",
  adminSecret: process.env.ADMIN_SECRET ?? "",
  /** 对话通道：openrouter | deepseek（默认 deepseek；向量仍走 OpenRouter） */
  llmChatProvider: normalizeChatProvider(
    process.env.LLM_CHAT_PROVIDER ?? "deepseek"
  ),
  deepseekApiKey: process.env.DEEPSEEK_API_KEY ?? "",
  deepseekBaseUrl: (
    process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com"
  ).replace(/\/$/, ""),
  /** 官方 API 深度轮（thinking）：默认 deepseek-reasoner */
  deepseekChatModelDeep:
    process.env.DEEPSEEK_CHAT_MODEL_DEEP ?? "deepseek-reasoner",
  /** 官方 API 快轨：默认 deepseek-chat */
  deepseekChatModelFast:
    process.env.DEEPSEEK_CHAT_MODEL_FAST ?? "deepseek-chat",
  openrouterApiKey: process.env.OPENROUTER_API_KEY ?? "",
  openrouterBaseUrl: (
    process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1"
  ).replace(/\/$/, ""),
  openrouterChatModel:
    process.env.OPENROUTER_CHAT_MODEL ?? "deepseek/deepseek-r1",
  /** 深度轮（长自述 / 多信号）与快轨（日常短句） */
  openrouterChatRoutingEnabled: envBool("OPENROUTER_CHAT_ROUTING", true),
  openrouterChatModelDeep:
    process.env.OPENROUTER_CHAT_MODEL_DEEP ?? "deepseek/deepseek-r1",
  openrouterChatModelFast:
    process.env.OPENROUTER_CHAT_MODEL_FAST ?? "deepseek/deepseek-chat",
  openrouterChatDeepMinChars: envInt("OPENROUTER_CHAT_DEEP_MIN_CHARS", 300),
  /** @deprecated 已取消 user 侧 intake 任务块，保留 env 以免旧配置报错 */
  openrouterChatIntakeMinChars: envInt("OPENROUTER_CHAT_INTAKE_MIN_CHARS", 800),
  /** 深度轮 token 上限（含长叙述） */
  openrouterChatMaxTokens: envInt("OPENROUTER_CHAT_MAX_TOKENS", 8192),
  /** 深度轮实际使用的更大预算（路由 deep 时优先） */
  openrouterChatMaxTokensDeep: envInt("OPENROUTER_CHAT_MAX_TOKENS_DEEP", 16384),
  /** 快轨 Chat */
  openrouterChatMaxTokensFast: envInt("OPENROUTER_CHAT_MAX_TOKENS_FAST", 3072),
  openrouterChatTemperature: envFloat("OPENROUTER_CHAT_TEMPERATURE", 0.65),
  /** 流式对话是否启用 OpenRouter reasoning（exclude=true 时不返回思考链） */
  openrouterChatReasoningEnabled: envBool("OPENROUTER_CHAT_REASONING", true),
  openrouterChatReasoningEffort:
    process.env.OPENROUTER_CHAT_REASONING_EFFORT ?? "max",
  /** 回复前增加一次内部分析 API 调用 */
  openrouterChatTwoPassEnabled: envBool("OPENROUTER_CHAT_TWO_PASS", false),
  openrouterChatAnalysisMaxTokens: envInt(
    "OPENROUTER_CHAT_ANALYSIS_MAX_TOKENS",
    1200
  ),
  openrouterChatAnalysisTemperature: envFloat(
    "OPENROUTER_CHAT_ANALYSIS_TEMPERATURE",
    0.4
  ),
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
