import { config } from "../config.js";

export type ChatCompletionMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type LlmChatProvider = "openrouter" | "deepseek";

export function getLlmChatProvider(): LlmChatProvider {
  const raw = config.llmChatProvider.trim().toLowerCase();
  if (raw === "deepseek") return "deepseek";
  return "openrouter";
}

/** 当前对话通道的深度 / 快轨模型 ID（随 LLM_CHAT_PROVIDER 切换） */
export function getChatModelIds(): { deep: string; fast: string; default: string } {
  if (getLlmChatProvider() === "deepseek") {
    return {
      deep: config.deepseekChatModelDeep,
      fast: config.deepseekChatModelFast,
      default: config.deepseekChatModelDeep,
    };
  }
  return {
    deep: config.openrouterChatModelDeep,
    fast: config.openrouterChatModelFast,
    default: config.openrouterChatModel,
  };
}

export function assertChatProviderConfigured(): void {
  if (getLlmChatProvider() === "deepseek") {
    if (!config.deepseekApiKey.trim()) {
      throw new Error("请配置 DEEPSEEK_API_KEY（LLM_CHAT_PROVIDER=deepseek）。");
    }
    return;
  }
  if (!config.openrouterApiKey.trim()) {
    throw new Error("请配置 OPENROUTER_API_KEY（LLM_CHAT_PROVIDER=openrouter）。");
  }
}

export function assertEmbeddingConfigured(): void {
  if (!config.openrouterApiKey.trim()) {
    throw new Error("请配置 OPENROUTER_API_KEY 以使用向量接口。");
  }
}

export function getChatCompletionsUrl(): string {
  if (getLlmChatProvider() === "deepseek") {
    return `${config.deepseekBaseUrl}/chat/completions`;
  }
  return `${config.openrouterBaseUrl}/chat/completions`;
}

export function getChatStreamHeaders(): Record<string, string> {
  const apiKey =
    getLlmChatProvider() === "deepseek"
      ? config.deepseekApiKey
      : config.openrouterApiKey;
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
}

function attachOpenRouterReasoning(
  body: Record<string, unknown>,
  enabled: boolean,
  effort?: string
): void {
  if (!enabled) return;
  body.reasoning = {
    effort: effort ?? config.openrouterChatReasoningEffort,
    exclude: true,
  };
}

/**
 * 构建流式 chat/completions 请求体。
 * - openrouter：深度轮附加 reasoning.effort
 * - deepseek：深度轮用 deepseek-reasoner（thinking 内置于模型名），不传 temperature
 */
export function buildChatStreamRequestBody(
  messages: ChatCompletionMessage[],
  opts?: {
    model?: string;
    reasoning?: boolean;
    reasoningEffort?: string;
    maxTokens?: number;
  }
): Record<string, unknown> {
  const provider = getLlmChatProvider();
  const models = getChatModelIds();
  const reasoning = opts?.reasoning ?? false;
  const model = opts?.model ?? models.deep;

  const body: Record<string, unknown> = {
    model,
    stream: true,
    messages,
    max_tokens: opts?.maxTokens ?? config.openrouterChatMaxTokens,
  };

  if (provider === "openrouter") {
    if (!reasoning) {
      body.temperature = config.openrouterChatTemperature;
    }
    attachOpenRouterReasoning(body, reasoning, opts?.reasoningEffort);
  } else if (!reasoning) {
    body.temperature = config.openrouterChatTemperature;
  }

  return body;
}

/** 非流式补全（内部分析 pass 等） */
export async function completeChatCompletion(
  messages: ChatCompletionMessage[],
  opts?: {
    maxTokens?: number;
    temperature?: number;
    reasoning?: boolean;
    model?: string;
  }
): Promise<string> {
  assertChatProviderConfigured();
  const models = getChatModelIds();
  const reasoning = opts?.reasoning ?? false;
  const model =
    opts?.model ?? (reasoning ? models.deep : models.default);

  const body = buildChatStreamRequestBody(messages, {
    model,
    reasoning,
    maxTokens: opts?.maxTokens,
  });
  body.stream = false;
  if (opts?.temperature != null && !reasoning) {
    body.temperature = opts.temperature;
  }

  const res = await fetch(getChatCompletionsUrl(), {
    method: "POST",
    headers: getChatStreamHeaders(),
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  const label = getLlmChatProvider() === "deepseek" ? "DeepSeek" : "OpenRouter";
  if (res.status === 401) {
    throw new Error(`${label} API 鉴权失败（401）。请检查 API Key。`);
  }
  if (!res.ok) {
    throw new Error(`${label} chat HTTP ${res.status}: ${raw.slice(0, 400)}`);
  }
  let data: {
    choices?: { message?: { content?: string } }[];
    error?: { message?: string };
  };
  try {
    data = JSON.parse(raw) as typeof data;
  } catch {
    throw new Error(`${label} chat invalid JSON: ${raw.slice(0, 400)}`);
  }
  if (data.error?.message) {
    throw new Error(`${label} chat error: ${data.error.message.slice(0, 400)}`);
  }
  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) {
    throw new Error(`${label} chat returned empty content`);
  }
  return content;
}

export async function streamChatCompletion(prompt: string): Promise<string> {
  assertChatProviderConfigured();
  const models = getChatModelIds();
  const res = await fetch(getChatCompletionsUrl(), {
    method: "POST",
    headers: getChatStreamHeaders(),
    body: JSON.stringify({
      model: models.default,
      messages: [{ role: "user", content: prompt }],
      stream: true,
    }),
  });
  const label = getLlmChatProvider() === "deepseek" ? "DeepSeek" : "OpenRouter";
  if (res.status === 401) {
    throw new Error(`${label} API 鉴权失败（401）。请检查 API Key。`);
  }
  if (!res.ok || !res.body) {
    const t = await res.text();
    throw new Error(`${label} chat HTTP ${res.status}: ${t.slice(0, 400)}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed === "data: [DONE]") continue;
      if (!trimmed.startsWith("data: ")) continue;
      try {
        const json = JSON.parse(trimmed.slice(6)) as {
          choices?: { delta?: { content?: string } }[];
        };
        const piece = json.choices?.[0]?.delta?.content;
        if (piece) full += piece;
      } catch {
        /* skip */
      }
    }
  }
  return full;
}
