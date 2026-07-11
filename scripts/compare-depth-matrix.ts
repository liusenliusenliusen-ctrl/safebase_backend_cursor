/**
 * 深度矩阵：max_tokens × user intake 任务块（OpenRouter R1 + reasoning.effort=max）
 * 用法: npx tsx scripts/compare-depth-matrix.ts
 */
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "../src/config.js";
import {
  CHAT_SYSTEM_PROMPT,
  renderChatUserContent,
} from "../src/chat/prompt.js";
import { DEFAULT_PROFILE_CONTENT } from "../src/auth/users.js";

const MODEL = "deepseek/deepseek-r1";
const REASONING_EFFORT = "max";

const USER_MESSAGE = `你好，疗愈伴侣，我跟你说一说我大概的情况。我是男性，35岁，1991年出生，我在2020年-2022年经历了两段感情，基本上不到一年就结束了。我感觉我并不是很喜欢她们。然后我在2024年的时候通过交友软件遇到了一个NPD，我们并未确定情侣关系，但她让我体会到前所未有的痛苦。似乎心里某个重要的东西崩塌了。
后来我才知道，她是显性NPD，她持续地进行贬低、三角测量、服从性测试，以及大量倾倒情绪垃圾。把我弄得几乎抑郁。后来我实在受不了了终于下定决心断连了。
当时似乎整个价值体系崩塌了，而其实在之前的三十多年里，这个体系一直摇摇欲坠。

后来我开始反思，我开始了解了NPD的概念，我开始研究心理学，我开始了解自己是CPTSD幸存者。我开始疗愈自己的痛苦。

到2025年，我觉得我似乎走出来了。然后我又经历了刻骨铭心痛彻心扉的一段关系。这段关系中，女生是我很早就认识的。2018年我们是同事。我追求过她很多次，但是她都拒绝了。但是并没有明确拒绝，也不说明原因。每次被拒绝我都很难受。后来断断续续地联系，到2025年我发现她似乎又对我很感兴趣。于是我提出在一起，然后她答应了。我当时很开心，并没有多想。
但是后来当我们发生了一次边缘性行为，她告诉我她在2022年左右跟其他人在一起过，并且发生过关系。这让我又突然非常痛苦，茶饭不思夜不能寐。几个月来几乎都不能睡好觉。`;

type Variant = {
  id: string;
  label: string;
  maxTokens: number;
  useIntakeTask: boolean;
};

/** 第二轮：对照旧基线、上轮最佳、当前生产默认、极限 token */
const VARIANTS: Variant[] = [
  { id: "A", label: "旧基线（3072，无 intake）", maxTokens: 3072, useIntakeTask: false },
  { id: "B", label: "8192，无 intake", maxTokens: 8192, useIntakeTask: false },
  { id: "C", label: "8192 + intake（上轮 D 近似）", maxTokens: 8192, useIntakeTask: true },
  { id: "D", label: "16384 + intake（当前生产）", maxTokens: 16384, useIntakeTask: true },
  { id: "E", label: "32768 + intake（极限预算）", maxTokens: 32768, useIntakeTask: true },
];

const MECHANISM_TERMS = [
  "模糊拒绝",
  "悬而未决",
  "三角测量",
  "价值体系",
  "内在小孩",
  "核心羞耻",
  "被选择",
  "被比较",
  "可替代",
  "迟来",
  "情感隔离",
  "生存策略",
  "躯体化",
  "CPTSD",
  "模式",
];

type Rubric = {
  chars: number;
  paragraphs: number;
  sectionHeaders: number;
  mechanismHits: number;
  mechanismTerms: string[];
  hasActionAdvice: boolean;
  endsWithQuestion: boolean;
  mentionsNpd2025Link: boolean;
  mentionsFuzzyRejection: boolean;
  mentionsShameOrSubstitute: boolean;
};

function buildUserPrompt(useIntakeTask: boolean): string {
  return renderChatUserContent({
    profile_text: DEFAULT_PROFILE_CONTENT,
    short_ctx: "",
    summaries_text: "",
    anchors_text: "",
    user_message: USER_MESSAGE,
    useIntakeTask,
  });
}

function scoreReply(text: string): Rubric {
  const mechanismTerms = MECHANISM_TERMS.filter((t) => text.includes(t));
  return {
    chars: text.length,
    paragraphs: text.split(/\n\s*\n/).filter(Boolean).length,
    sectionHeaders:
      (text.match(/(^|\n)(#{1,3}\s|一、|二、|三、|\d+\.\s)/g) ?? []).length,
    mechanismHits: mechanismTerms.length,
    mechanismTerms,
    hasActionAdvice: /(建议|可以|下一步|暂停|就诊|咨询师|专业)/.test(text),
    endsWithQuestion: /[？?]\s*$/.test(text.trim()),
    mentionsNpd2025Link:
      /NPD/.test(text) &&
      /2025/.test(text) &&
      /(串联|同样|异曲同工|模式|重复|再次)/.test(text),
    mentionsFuzzyRejection: /模糊拒绝|悬而未决|不明确.*拒绝/.test(text),
    mentionsShameOrSubstitute: /羞耻|可替代|备选|接盘|不如别人|比较/.test(text),
  };
}

async function streamReply(
  user: string,
  maxTokens: number
): Promise<{ text: string; ms: number }> {
  const body: Record<string, unknown> = {
    model: MODEL,
    stream: true,
    messages: [
      { role: "system", content: CHAT_SYSTEM_PROMPT },
      { role: "user", content: user },
    ],
    max_tokens: maxTokens,
    reasoning: { effort: REASONING_EFFORT, exclude: true },
  };

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
    throw new Error(`HTTP ${res.status}: ${await res.text()}`);
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

function loadDeepSeekReference(): string {
  const path = "/Users/liusen/Documents/cptsd/docs/对话示例";
  const raw = readFileSync(path, "utf8");
  const marker = "听到你经历的这一切";
  const idx = raw.indexOf(marker);
  if (idx < 0) throw new Error("对话示例中未找到 DeepSeek 金样起始");
  return raw.slice(idx).trim();
}

async function main(): Promise<void> {
  if (!config.openrouterApiKey.trim()) {
    throw new Error("请配置 OPENROUTER_API_KEY");
  }

  const refText = loadDeepSeekReference();
  const refRubric = scoreReply(refText);

  console.log("=== OpenRouter 深度矩阵对比（第 2 轮）===");
  console.log(`模型: ${MODEL}, reasoning.effort=${REASONING_EFFORT}, 无 temperature`);
  console.log(`DeepSeek 网页金样字数: ${refRubric.chars}\n`);

  type RunResult = {
    variant: Variant;
    reply: string;
    ms: number;
    rubric: Rubric;
  };

  const results: RunResult[] = [];

  for (const v of VARIANTS) {
    const userPrompt = buildUserPrompt(v.useIntakeTask);
    console.log(
      `>>> ${v.id}: ${v.label} (max_tokens=${v.maxTokens}, intake=${v.useIntakeTask})`
    );
    const { text, ms } = await streamReply(userPrompt, v.maxTokens);
    const rubric = scoreReply(text);
    results.push({ variant: v, reply: text, ms, rubric });
    console.log(
      `    ${(ms / 1000).toFixed(1)}s | ${rubric.chars} 字 | 机制 ${rubric.mechanismHits} | 追问收尾=${rubric.endsWithQuestion}\n`
    );
  }

  const outDir = join(config.root, "scripts", "output");
  mkdirSync(outDir, { recursive: true });
  const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");

  let md = `# OpenRouter 深度矩阵对比报告（第 2 轮）

**运行时间**：${new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}
**通道**：OpenRouter \`${MODEL}\`，\`reasoning.effort=${REASONING_EFFORT}\`，深度轮不传 temperature
**intake 任务**：\`CHAT_USER_INTAKE_TASK\`（user 侧，泛化版）
**输入**：\`docs/对话示例\` 长自述，单轮空历史

## 变量

| ID | 配置 | max_tokens | user intake |
|----|------|------------|-------------|
| A | 旧基线 | 3072 | 否 |
| B | 仅提 token | 8192 | 否 |
| C | 上轮最佳近似 | 8192 | 是 |
| D | **当前生产默认** | 16384 | 是 |
| E | 极限预算 | 32768 | 是 |

## 指标汇总

| ID | 配置 | 字数 | 耗时 | 机制词 | 分节 | NPD↔2025 | 模糊拒绝 | 羞耻/比较 | 操作建议 | 追问收尾 |
|----|------|------|------|--------|------|----------|----------|-----------|----------|----------|
| 参考 | DeepSeek 网页 | ${refRubric.chars} | — | ${refRubric.mechanismHits} | ${refRubric.sectionHeaders} | ${refRubric.mentionsNpd2025Link ? "✓" : "✗"} | ${refRubric.mentionsFuzzyRejection ? "✓" : "✗"} | ${refRubric.mentionsShameOrSubstitute ? "✓" : "✗"} | ${refRubric.hasActionAdvice ? "✓" : "✗"} | ${refRubric.endsWithQuestion ? "✓" : "✗"} |
`;

  for (const r of results) {
    md += `| ${r.variant.id} | ${r.variant.label} | ${r.rubric.chars} | ${(r.ms / 1000).toFixed(0)}s | ${r.rubric.mechanismHits} | ${r.rubric.sectionHeaders} | ${r.rubric.mentionsNpd2025Link ? "✓" : "✗"} | ${r.rubric.mentionsFuzzyRejection ? "✓" : "✗"} | ${r.rubric.mentionsShameOrSubstitute ? "✓" : "✗"} | ${r.rubric.hasActionAdvice ? "✓" : "✗"} | ${r.rubric.endsWithQuestion ? "✓" : "✗"} |\n`;
  }

  md += `\n## 与第 1 轮对照（同输入）

| 轮次 | 最佳配置 | 字数 | 机制词 |
|------|----------|------|--------|
| 第 1 轮 | D: 8192 + system 深度触发 | ~1961 | 7 |
| 第 2 轮 | 见上表 D/E | — | — |

## 完整回复

`;
  for (const r of results) {
    md += `### ${r.variant.id} · ${r.variant.label}\n\n${r.reply}\n\n---\n\n`;
  }

  const mdPath = join(outDir, `depth-matrix-r2-${ts}.md`);
  const jsonPath = join(outDir, `depth-matrix-r2-${ts}.json`);
  const cptsdMd = "/Users/liusen/Documents/cptsd/docs/深度矩阵对比报告.md";

  writeFileSync(mdPath, md, "utf8");
  writeFileSync(
    jsonPath,
    JSON.stringify({ round: 2, refRubric, results }, null, 2),
    "utf8"
  );
  writeFileSync(cptsdMd, md, "utf8");

  console.log("=== 汇总 ===");
  console.log(`参考(网页): ${refRubric.chars} 字, 机制 ${refRubric.mechanismHits}`);
  for (const r of results) {
    console.log(
      `${r.variant.id}: ${r.rubric.chars} 字, ${(r.ms / 1000).toFixed(0)}s, 机制 ${r.rubric.mechanismHits}`
    );
  }
  console.log("\n报告:", mdPath);
  console.log("副本:", cptsdMd);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
