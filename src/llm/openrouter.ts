import { config } from "../config.js";

export type ChatCompletionMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

function openRouterHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${config.openrouterApiKey}`,
    "Content-Type": "application/json",
  };
}

function attachReasoning(
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

export function buildChatStreamRequestBody(
  messages: ChatCompletionMessage[],
  opts?: {
    model?: string;
    reasoning?: boolean;
    reasoningEffort?: string;
  }
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: opts?.model ?? config.openrouterChatModelDeep,
    stream: true,
    messages,
    max_tokens: config.openrouterChatMaxTokens,
    temperature: config.openrouterChatTemperature,
  };
  attachReasoning(body, opts?.reasoning ?? false, opts?.reasoningEffort);
  return body;
}

/** 非流式补全（用于内部分析 pass） */
export async function completeChatCompletion(
  messages: ChatCompletionMessage[],
  opts?: {
    maxTokens?: number;
    temperature?: number;
    reasoning?: boolean;
  }
): Promise<string> {
  if (!config.openrouterApiKey.trim()) {
    throw new Error("请配置 OPENROUTER_API_KEY 以使用对话接口。");
  }
  const body: Record<string, unknown> = {
    model: config.openrouterChatModel,
    stream: false,
    messages,
    max_tokens: opts?.maxTokens ?? config.openrouterChatMaxTokens,
    temperature: opts?.temperature ?? config.openrouterChatTemperature,
  };
  attachReasoning(body, opts?.reasoning ?? false);

  const res = await fetch(`${config.openrouterBaseUrl}/chat/completions`, {
    method: "POST",
    headers: openRouterHeaders(),
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  if (res.status === 401) {
    throw new Error("OpenRouter API 鉴权失败（401）。请检查 OPENROUTER_API_KEY。");
  }
  if (!res.ok) {
    throw new Error(`OpenRouter chat HTTP ${res.status}: ${raw.slice(0, 400)}`);
  }
  let data: {
    choices?: { message?: { content?: string } }[];
    error?: { message?: string };
  };
  try {
    data = JSON.parse(raw) as typeof data;
  } catch {
    throw new Error(`OpenRouter chat invalid JSON: ${raw.slice(0, 400)}`);
  }
  if (data.error?.message) {
    throw new Error(`OpenRouter chat error: ${data.error.message.slice(0, 400)}`);
  }
  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) {
    throw new Error("OpenRouter chat returned empty content");
  }
  return content;
}

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

export async function streamChatCompletion(prompt: string): Promise<string> {
  if (!config.openrouterApiKey.trim()) {
    throw new Error("请配置 OPENROUTER_API_KEY 以使用对话接口。");
  }
  const res = await fetch(`${config.openrouterBaseUrl}/chat/completions`, {
    method: "POST",
    headers: openRouterHeaders(),
    body: JSON.stringify({
      model: config.openrouterChatModel,
      messages: [{ role: "user", content: prompt }],
      stream: true,
    }),
  });
  if (res.status === 401) {
    throw new Error("OpenRouter API 鉴权失败（401）。请检查 OPENROUTER_API_KEY。");
  }
  if (!res.ok || !res.body) {
    const t = await res.text();
    throw new Error(
      `OpenRouter chat HTTP ${res.status}: ${t.slice(0, 400)}`
    );
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
