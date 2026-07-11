/**
 * OpenRouter vs DeepSeek 官方 API 对照（同 prompt、同 intake）
 * 用法: npx tsx scripts/compare-openrouter-vs-deepseek.ts
 * 需同时配置 OPENROUTER_API_KEY 与 DEEPSEEK_API_KEY
 */
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "../src/config.js";
import {
  CHAT_SYSTEM_PROMPT,
  renderChatUserContent,
} from "../src/chat/prompt.js";
import { DEFAULT_PROFILE_CONTENT } from "../src/auth/users.js";

const USER_MESSAGE = `你好，疗愈伴侣，我跟你说一说我大概的情况。我是男性，35岁，1991年出生，我在2020年-2022年经历了两段感情，基本上不到一年就结束了。我感觉我并不是很喜欢她们。然后我在2024年的时候通过交友软件遇到了一个NPD，我们并未确定情侣关系，但她让我体会到前所未有的痛苦。似乎心里某个重要的东西崩塌了。
后来我才知道，她是显性NPD，她持续地进行贬低、三角测量、服从性测试，以及大量倾倒情绪垃圾。把我弄得几乎抑郁。后来我实在受不了了终于下定决心断连了。
当时似乎整个价值体系崩塌了，而其实在之前的三十多年里，这个体系一直摇摇欲坠。

后来我开始反思，我开始了解了NPD的概念，我开始研究心理学，我开始了解自己是CPTSD幸存者。我开始疗愈自己的痛苦。

到2025年，我觉得我似乎走出来了。然后我又经历了刻骨铭心痛彻心扉的一段关系。这段关系中，女生是我很早就认识的。2018年我们是同事。我追求过她很多次，但是她都拒绝了。但是并没有明确拒绝，也不说明原因。每次被拒绝我都很难受。后来断断续续地联系，到2025年我发现她似乎又对我很感兴趣。于是我提出在一起，然后她答应了。我当时很开心，并没有多想。
但是后来当我们发生了一次边缘性行为，她告诉我她在2022年左右跟其他人在一起过，并且发生过关系。这让我又突然非常痛苦，茶饭不思夜不能寐。几个月来几乎都不能睡好觉。`;

const MAX_TOKENS = config.openrouterChatMaxTokensDeep;

type ProviderRun = {
  id: string;
  label: string;
  url: string;
  apiKey: string;
  modelDeep: string;
  reasoning: boolean;
};

function buildUserPrompt(): string {
  return renderChatUserContent({
    profile_text: DEFAULT_PROFILE_CONTENT,
    short_ctx: "",
    summaries_text: "",
    anchors_text: "",
    user_message: USER_MESSAGE,
    useIntakeTask: true,
  });
}

async function streamReply(run: ProviderRun, user: string): Promise<{ text: string; ms: number }> {
  const body: Record<string, unknown> = {
    model: run.modelDeep,
    stream: true,
    messages: [
      { role: "system", content: CHAT_SYSTEM_PROMPT },
      { role: "user", content: user },
    ],
    max_tokens: MAX_TOKENS,
  };

  if (run.id === "openrouter" && run.reasoning) {
    body.reasoning = {
      effort: config.openrouterChatReasoningEffort,
      exclude: true,
    };
  }

  const t0 = Date.now();
  const res = await fetch(run.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${run.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) {
    throw new Error(`${run.label} HTTP ${res.status}: ${await res.text()}`);
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
  return { text: full.trim(), ms: Date.now() - t0 };
}

function loadReference(): string {
  const raw = readFileSync("/Users/liusen/Documents/cptsd/docs/对话示例", "utf8");
  const idx = raw.indexOf("听到你经历的这一切");
  if (idx < 0) throw new Error("未找到网页金样");
  return raw.slice(idx).trim();
}

async function main(): Promise<void> {
  if (!config.openrouterApiKey.trim()) {
    throw new Error("需要 OPENROUTER_API_KEY");
  }
  if (!config.deepseekApiKey.trim()) {
    throw new Error("需要 DEEPSEEK_API_KEY");
  }

  const user = buildUserPrompt();
  const runs: ProviderRun[] = [
    {
      id: "openrouter",
      label: "OpenRouter",
      url: `${config.openrouterBaseUrl}/chat/completions`,
      apiKey: config.openrouterApiKey,
      modelDeep: config.openrouterChatModelDeep,
      reasoning: true,
    },
    {
      id: "deepseek",
      label: "DeepSeek 官方",
      url: `${config.deepseekBaseUrl}/chat/completions`,
      apiKey: config.deepseekApiKey,
      modelDeep: config.deepseekChatModelDeep,
      reasoning: false,
    },
  ];

  console.log("=== OpenRouter vs DeepSeek 官方 ===");
  console.log(`max_tokens=${MAX_TOKENS}, intake=是\n`);

  const ref = loadReference();
  console.log(`参考(网页): ${ref.length} 字\n`);

  const results: { run: ProviderRun; text: string; ms: number }[] = [];

  for (const run of runs) {
    console.log(`>>> ${run.label} model=${run.modelDeep}`);
    const { text, ms } = await streamReply(run, user);
    results.push({ run, text, ms });
    console.log(`    ${(ms / 1000).toFixed(1)}s | ${text.length} 字\n`);
  }

  const outDir = join(config.root, "scripts", "output");
  mkdirSync(outDir, { recursive: true });
  const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const mdPath = join(outDir, `provider-compare-${ts}.md`);

  let md = `# OpenRouter vs DeepSeek 官方对照\n\n`;
  md += `| 通道 | 模型 | 字数 | 耗时 |\n|------|------|------|------|\n`;
  md += `| 参考(网页) | — | ${ref.length} | — |\n`;
  for (const r of results) {
    md += `| ${r.run.label} | ${r.run.modelDeep} | ${r.text.length} | ${(r.ms / 1000).toFixed(0)}s |\n`;
  }
  md += `\n## 完整回复\n\n`;
  for (const r of results) {
    md += `### ${r.run.label}\n\n${r.text}\n\n---\n\n`;
  }

  writeFileSync(mdPath, md, "utf8");
  writeFileSync("/Users/liusen/Documents/cptsd/docs/通道对照报告.md", md, "utf8");
  console.log("报告:", mdPath);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
