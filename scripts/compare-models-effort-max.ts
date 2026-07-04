/**
 * 对比 deepseek-chat vs deepseek-r1（reasoning.effort=max，其余不变）
 * 用法: npx tsx scripts/compare-models-effort-max.ts
 */
import { config } from "../src/config.js";
import { buildChatMessages } from "../src/chat/memory.js";
import { buildChatStreamRequestBody } from "../src/llm/openrouter.js";
import { query } from "../src/db.js";

const MODELS = ["deepseek/deepseek-chat", "deepseek/deepseek-r1"] as const;

const USER_MESSAGE = `你好，疗愈伴侣，我跟你说一说我大概的情况。我是男性，35岁，1991年出生，我在2020年-2022年经历了两段感情，基本上不到一年就结束了。我感觉我并不是很喜欢她们。然后我在2024年的时候通过交友软件遇到了一个NPD，我们并未确定情侣关系，但她让我体会到前所未有的痛苦。似乎心里某个重要的东西崩塌了。
后来我才知道，她是显性NPD，她持续地进行贬低、三角测量、服从性测试，以及大量倾倒情绪垃圾。把我弄得几乎抑郁。后来我实在受不了了终于下定决心断连了。
当时似乎整个价值体系崩塌了，而其实在之前的三十多年里，这个体系一直摇摇欲坠。
后来我开始反思，我开始了解了NPD的概念，我开始研究心理学，我开始意识到自己带着很多未愈的创伤。我开始疗愈自己的痛苦。
到2025年，我觉得我似乎走出来了。然后我又经历了刻骨铭心痛彻心扉的一段关系。这段关系中，女生是我很早就认识的。2018年我们是同事。我追求过她很多次，但是她都拒绝了。但是并没有明确拒绝，也不说明原因。每次被拒绝我都很难受。后来断断续续地联系，到2025年我发现她似乎又对我很感兴趣。于是我提出在一起，然后她答应了。我当时很开心，并没有多想。
但是后来当我们发生了一次边缘性行为，她告诉我她在2022年左右跟其他人在一起过，并且发生过关系。这让我又突然非常痛苦，茶饭不思夜不能寐。几个月来几乎都不能睡好觉。`;

async function streamReply(
  model: string,
  system: string,
  user: string
): Promise<{ text: string; ms: number; reasoning: unknown }> {
  const body = buildChatStreamRequestBody([
    { role: "system", content: system },
    { role: "user", content: user },
  ]);
  body.model = model;

  const t0 = Date.now();
  const res = await fetch(`${config.openrouterBaseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.openrouterApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) {
    throw new Error(`${model} HTTP ${res.status}: ${await res.text()}`);
  }

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let full = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const blocks = buf.split("\n\n");
    buf = blocks.pop() ?? "";
    for (const block of blocks) {
      for (const line of block.split("\n")) {
        if (!line.startsWith("data: ")) continue;
        const payload = line.slice(6).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          const j = JSON.parse(payload) as {
            choices?: { delta?: { content?: string } }[];
          };
          const piece = j.choices?.[0]?.delta?.content;
          if (piece) full += piece;
        } catch {
          /* skip */
        }
      }
    }
  }
  return {
    text: full.trim(),
    ms: Date.now() - t0,
    reasoning: body.reasoning,
  };
}

async function main(): Promise<void> {
  console.log("reasoning.effort:", config.openrouterChatReasoningEffort);
  console.log("reasoning enabled:", config.openrouterChatReasoningEnabled);
  console.log("temperature:", config.openrouterChatTemperature);
  console.log("max_tokens:", config.openrouterChatMaxTokens);

  const userRow = await query<{ id: string }>(
    `SELECT id::text FROM public.users WHERE username = $1 LIMIT 1`,
    ["liusen"]
  );
  const userId = userRow.rows[0]?.id;
  if (!userId) throw new Error("liusen 用户不存在");

  const { system, user } = await buildChatMessages(userId, USER_MESSAGE);

  for (const model of MODELS) {
    console.log("\n" + "=".repeat(60));
    console.log("MODEL:", model);
    const { text, ms, reasoning } = await streamReply(model, system, user);
    console.log("reasoning param:", JSON.stringify(reasoning));
    console.log("耗时:", (ms / 1000).toFixed(1), "s");
    console.log("字数:", text.length);
    console.log("\n--- 回复 ---\n");
    console.log(text);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
