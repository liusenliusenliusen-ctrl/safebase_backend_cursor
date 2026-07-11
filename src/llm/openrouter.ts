import { config } from "../config.js";

/** OpenRouter 向量接口；对话见 chat-provider.ts */
function openRouterHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${config.openrouterApiKey}`,
    "Content-Type": "application/json",
  };
}

export type { ChatCompletionMessage } from "./chat-provider.js";
export {
  assertChatProviderConfigured,
  assertEmbeddingConfigured,
  buildChatStreamRequestBody,
  completeChatCompletion,
  getChatCompletionsUrl,
  getChatModelIds,
  getChatStreamHeaders,
  getLlmChatProvider,
  streamChatCompletion,
} from "./chat-provider.js";

export async function getEmbedding(text: string): Promise<number[]> {
  if (!config.openrouterApiKey.trim()) {
    throw new Error("请配置 OPENROUTER_API_KEY 以使用向量接口。");
  }
  const payload: Record<string, unknown> = {
    model: config.openrouterEmbeddingModel,
    input: text,
  };
  if (config.openrouterEmbeddingDimensions > 0) {
    payload.dimensions = config.openrouterEmbeddingDimensions;
  }
  const res = await fetch(`${config.openrouterBaseUrl}/embeddings`, {
    method: "POST",
    headers: openRouterHeaders(),
    body: JSON.stringify(payload),
  });
  const raw = await res.text();
  if (!res.ok) {
    throw new Error(`OpenRouter embeddings HTTP ${res.status}: ${raw.slice(0, 400)}`);
  }
  let data: { data?: { embedding?: number[] }[]; error?: { message?: string } };
  try {
    data = JSON.parse(raw) as typeof data;
  } catch {
    throw new Error(`OpenRouter embeddings invalid JSON: ${raw.slice(0, 400)}`);
  }
  if (data.error?.message) {
    throw new Error(`OpenRouter embeddings error: ${data.error.message.slice(0, 400)}`);
  }
  const emb = data.data?.[0]?.embedding;
  if (!emb?.length) {
    throw new Error("OpenRouter embeddings returned empty vector");
  }
  return emb;
}
