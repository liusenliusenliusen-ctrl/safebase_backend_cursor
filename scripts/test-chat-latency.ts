import { config } from "../src/config.js";
import { completeChatCompletion } from "../src/llm/openrouter.js";

const short =
  "你好，我是35岁男性，2024年遇到NPD，价值体系崩塌，2025年同事关系又触发茶饭不思。";

async function testStream(withReasoning: boolean): Promise<void> {
  const body: Record<string, unknown> = {
    model: config.openrouterChatModel,
    stream: true,
    messages: [
      {
        role: "system",
        content: "你是疗愈伙伴，用500字口语深度回复，串联NPD与2025经历",
      },
      { role: "user", content: short },
    ],
    max_tokens: 3072,
    temperature: 0.65,
  };
  if (withReasoning) {
    body.reasoning = { effort: "high", exclude: true };
  }
  const res = await fetch(`${config.openrouterBaseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.openrouterApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) {
    console.log("reasoning=" + withReasoning, "HTTP", res.status, await res.text());
    return;
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let full = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    for (const line of dec.decode(value).split("\n")) {
      if (!line.startsWith("data: ")) continue;
      const p = line.slice(6).trim();
      if (p === "[DONE]") continue;
      try {
        const j = JSON.parse(p) as {
          choices?: { delta?: { content?: string } }[];
        };
        const c = j.choices?.[0]?.delta?.content;
        if (c) full += c;
      } catch {
        /* skip */
      }
    }
  }
  console.log("reasoning=" + withReasoning, "len=" + full.length);
  console.log(full.slice(0, 400));
  console.log("---");
}

async function main(): Promise<void> {
  console.log("model", config.openrouterChatModel);

  const t0 = Date.now();
  try {
    const analysis = await completeChatCompletion(
      [
        { role: "system", content: "用100字分析用户痛点要点" },
        { role: "user", content: short },
      ],
      { maxTokens: 500, temperature: 0.4, reasoning: true }
    );
    console.log("analysis ok", Date.now() - t0, "ms", "len", analysis.length);
  } catch (e) {
    console.error(
      "analysis fail",
      Date.now() - t0,
      e instanceof Error ? e.message : e
    );
  }

  await testStream(false);
  await testStream(true);

  const { buildChatStreamRequestBody } = await import("../src/llm/openrouter.js");
  const streamBody = buildChatStreamRequestBody([
    { role: "system", content: "你是疗愈伙伴，用500字口语深度回复" },
    { role: "user", content: short },
  ]);
  console.log("stream body reasoning:", JSON.stringify(streamBody.reasoning));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
