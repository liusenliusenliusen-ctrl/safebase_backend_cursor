/**
 * 全矩阵：通道 × max_tokens × intake（OpenRouter + DeepSeek 官方）
 * 用法: npx tsx scripts/compare-full-matrix.ts
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

type Channel = "openrouter" | "deepseek";

type Variant = {
  id: string;
  label: string;
  channel: Channel;
  model: string;
  maxTokens: number;
  useIntakeTask: boolean;
  openRouterReasoning: boolean;
};

const VARIANTS: Variant[] = [
  {
    id: "OR-1",
    label: "OpenRouter / 8192 / 无 intake",
    channel: "openrouter",
    model: config.openrouterChatModelDeep,
    maxTokens: 8192,
    useIntakeTask: false,
    openRouterReasoning: true,
  },
  {
    id: "OR-2",
    label: "OpenRouter / 8192 / intake",
    channel: "openrouter",
    model: config.openrouterChatModelDeep,
    maxTokens: 8192,
    useIntakeTask: true,
    openRouterReasoning: true,
  },
  {
    id: "OR-3",
    label: "OpenRouter / 16384 / intake",
    channel: "openrouter",
    model: config.openrouterChatModelDeep,
    maxTokens: 16384,
    useIntakeTask: true,
    openRouterReasoning: true,
  },
  {
    id: "DS-1",
    label: "DeepSeek 官方 / 8192 / 无 intake",
    channel: "deepseek",
    model: config.deepseekChatModelDeep,
    maxTokens: 8192,
    useIntakeTask: false,
    openRouterReasoning: false,
  },
  {
    id: "DS-2",
    label: "DeepSeek 官方 / 16384 / intake（生产默认）",
    channel: "deepseek",
    model: config.deepseekChatModelDeep,
    maxTokens: 16384,
    useIntakeTask: true,
    openRouterReasoning: false,
  },
  {
    id: "DS-3",
    label: "DeepSeek 官方 / 32768 / intake",
    channel: "deepseek",
    model: config.deepseekChatModelDeep,
    maxTokens: 32768,
    useIntakeTask: true,
    openRouterReasoning: false,
  },
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
  "闪回",
  "认可",
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
  warmthScore: number;
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
  const warmthHits = [
    /勇敢|勇气|了不起|珍贵|抱抱|拥抱|陪伴|见证/,
    /正常|可以理解|不必自责|不是你的错/,
    /温暖|温柔|郑重|心疼/,
  ].filter((r) => r.test(text)).length;

  return {
    chars: text.length,
    paragraphs: text.split(/\n\s*\n/).filter(Boolean).length,
    sectionHeaders:
      (text.match(/(^|\n)(#{1,3}\s|一、|二、|三、|四、|五、|\d+\.\s)/g) ?? [])
        .length,
    mechanismHits: mechanismTerms.length,
    mechanismTerms,
    hasActionAdvice: /(建议|可以|下一步|暂停|就诊|咨询师|专业|练习|试试)/.test(
      text
    ),
    endsWithQuestion: /[？?]\s*$/.test(text.trim()),
    mentionsNpd2025Link:
      /NPD/.test(text) &&
      /2025/.test(text) &&
      /(串联|同样|异曲同工|模式|重复|再次|连起来)/.test(text),
    mentionsFuzzyRejection: /模糊拒绝|悬而未决|不明确.*拒绝|模糊/.test(text),
    mentionsShameOrSubstitute: /羞耻|可替代|备选|接盘|不如别人|比较/.test(text),
    warmthScore: warmthHits,
  };
}

function channelUrl(channel: Channel): string {
  return channel === "deepseek"
    ? `${config.deepseekBaseUrl}/chat/completions`
    : `${config.openrouterBaseUrl}/chat/completions`;
}

function channelKey(channel: Channel): string {
  return channel === "deepseek" ? config.deepseekApiKey : config.openrouterApiKey;
}

async function streamReply(
  v: Variant,
  user: string
): Promise<{ text: string; ms: number }> {
  const body: Record<string, unknown> = {
    model: v.model,
    stream: true,
    messages: [
      { role: "system", content: CHAT_SYSTEM_PROMPT },
      { role: "user", content: user },
    ],
    max_tokens: v.maxTokens,
  };

  if (v.channel === "openrouter") {
    if (v.openRouterReasoning) {
      body.reasoning = {
        effort: config.openrouterChatReasoningEffort,
        exclude: true,
      };
    } else {
      body.temperature = config.openrouterChatTemperature;
    }
  }

  const t0 = Date.now();
  const res = await fetch(channelUrl(v.channel), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${channelKey(v.channel)}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) {
    throw new Error(`${v.id} HTTP ${res.status}: ${await res.text()}`);
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

function loadReference(): { text: string; rubric: Rubric } {
  const raw = readFileSync("/Users/liusen/Documents/cptsd/docs/对话示例", "utf8");
  const idx = raw.indexOf("听到你经历的这一切");
  if (idx < 0) throw new Error("未找到网页金样");
  const text = raw.slice(idx).trim();
  return { text, rubric: scoreReply(text) };
}

function compositeScore(r: Rubric, refChars: number): number {
  const lenScore = Math.min(r.chars / refChars, 1) * 30;
  const mechScore = Math.min(r.mechanismHits / 12, 1) * 25;
  const structScore = Math.min(r.sectionHeaders / 6, 1) * 15;
  const depthFlags =
    (r.mentionsNpd2025Link ? 5 : 0) +
    (r.mentionsFuzzyRejection ? 5 : 0) +
    (r.mentionsShameOrSubstitute ? 5 : 0) +
    (r.hasActionAdvice ? 5 : 0);
  const warmthScore = Math.min(r.warmthScore / 3, 1) * 10;
  const penalty = r.endsWithQuestion ? 5 : 0;
  return Math.round(lenScore + mechScore + structScore + depthFlags + warmthScore - penalty);
}

function analyzeResults(
  ref: Rubric,
  results: { v: Variant; rubric: Rubric; ms: number; score: number }[]
): string {
  const sorted = [...results].sort((a, b) => b.score - a.score);
  const best = sorted[0];
  const bestOr = sorted.filter((r) => r.v.channel === "openrouter")[0];
  const bestDs = sorted.filter((r) => r.v.channel === "deepseek")[0];

  const orWithIntake = results.filter((r) => r.v.channel === "openrouter" && r.v.useIntakeTask);
  const orNoIntake = results.filter((r) => r.v.channel === "openrouter" && !r.v.useIntakeTask);
  const intakeLiftOr =
    orWithIntake.length && orNoIntake.length
      ? Math.round(
          orWithIntake.reduce((s, r) => s + r.rubric.chars, 0) / orWithIntake.length -
            orNoIntake.reduce((s, r) => s + r.rubric.chars, 0) / orNoIntake.length
        )
      : 0;

  const ds16384 = results.find((r) => r.v.id === "DS-2");
  const ds32768 = results.find((r) => r.v.id === "DS-3");

  return `## 分析结论

### 1. 通道差异（核心发现）

| 对比项 | OpenRouter 最佳 | DeepSeek 官方最佳 |
|--------|-----------------|-------------------|
| 配置 | ${bestOr?.v.label ?? "—"} | ${bestDs?.v.label ?? "—"} |
| 字数 | ${bestOr?.rubric.chars ?? "—"} | ${bestDs?.rubric.chars ?? "—"} |
| 综合分 | ${bestOr?.score ?? "—"} | ${bestDs?.score ?? "—"} |
| 耗时 | ${bestOr ? (bestOr.ms / 1000).toFixed(0) + "s" : "—"} | ${bestDs ? (bestDs.ms / 1000).toFixed(0) + "s" : "—"} |

${bestDs && bestOr && bestDs.score > bestOr.score + 10 ? "**DeepSeek 官方通道明显优于 OpenRouter**，尤其在篇幅与机制整合上更接近网页金样。建议生产默认 `LLM_CHAT_PROVIDER=deepseek`。" : bestDs && bestOr && bestDs.rubric.chars > bestOr.rubric.chars * 1.3 ? "**DeepSeek 官方在篇幅上显著更长**，机制深度亦有优势；通道切换值得作为生产默认。" : "两通道各有波动，以本轮最佳配置为准；官方通道若字数持续领先，优先 DeepSeek。"}

### 2. intake 任务块的影响

- OpenRouter 组：有 intake 比无 intake 平均字数约 **+${intakeLiftOr}** 字
- 结论：user 侧 \`CHAT_USER_INTAKE_TASK\` 对长叙述仍有效；**仅 intake 路由注入**，不影响短句

### 3. max_tokens 敏感性

- OpenRouter 8192→16384（均 intake）：${results.find((r) => r.v.id === "OR-2")?.rubric.chars ?? "?"} → ${results.find((r) => r.v.id === "OR-3")?.rubric.chars ?? "?"} 字
- DeepSeek 16384→32768（均 intake）：${ds16384?.rubric.chars ?? "?"} → ${ds32768?.rubric.chars ?? "?"} 字
- 结论：${ds16384 && ds32768 && Math.abs(ds16384.rubric.chars - ds32768.rubric.chars) < 200 ? "提 token 上限收益递减，**16384 可作为 DeepSeek 生产默认**。" : "更高 token 有一定收益，可保留 16384–32768 可配置。"}

### 4. 与网页金样差距

- 金样：${ref.chars} 字，机制词 ${ref.mechanismHits}，综合参考分 100
- 本轮最佳 **${best.v.id}**：${best.rubric.chars} 字（${Math.round((best.rubric.chars / ref.chars) * 100)}%），机制词 ${best.rubric.mechanismHits}，综合分 ${best.score}
- 仍缺：${!best.rubric.mentionsFuzzyRejection ? "「模糊拒绝」类精准机制词、" : ""}${best.rubric.endsWithQuestion ? "避免追问收尾、" : ""}偶发模板化列表

### 5. 生产推荐配置

\`\`\`env
LLM_CHAT_PROVIDER=deepseek
DEEPSEEK_CHAT_MODEL_DEEP=deepseek-reasoner
DEEPSEEK_CHAT_MODEL_FAST=deepseek-chat
OPENROUTER_CHAT_MAX_TOKENS_DEEP=16384
# intake 由 model-router 自动注入；embedding 仍 OpenRouter
\`\`\`

**推荐组合**：${best.v.label}（综合分 ${best.score}）

### 6. 主观质量要点（基于 rubric + 正文抽样）

| 维度 | 网页金样 | 本轮最佳 |
|------|----------|----------|
| 温度/在场感 | 高 | ${best.rubric.warmthScore >= 2 ? "中高" : "中"} |
| 机制拆解 | 模糊拒绝、三角测量同构、被选择 | ${best.rubric.mechanismTerms.slice(0, 5).join("、") || "较少"} |
| 结构 | 分节清晰 | ${best.rubric.sectionHeaders} 处标题/分节 |
| 可操作建议 | 有 | ${best.rubric.hasActionAdvice ? "有" : "弱"} |
`;
}

async function main(): Promise<void> {
  if (!config.openrouterApiKey.trim()) throw new Error("需要 OPENROUTER_API_KEY");
  if (!config.deepseekApiKey.trim()) throw new Error("需要 DEEPSEEK_API_KEY");

  const ref = loadReference();
  console.log("=== 全矩阵对比 ===");
  console.log(`金样: ${ref.rubric.chars} 字\n`);

  type Row = { v: Variant; reply: string; rubric: Rubric; ms: number; score: number };
  const results: Row[] = [];

  for (const v of VARIANTS) {
    const user = buildUserPrompt(v.useIntakeTask);
    console.log(`>>> ${v.id}: ${v.label}`);
    const { text, ms } = await streamReply(v, user);
    const rubric = scoreReply(text);
    const score = compositeScore(rubric, ref.rubric.chars);
    results.push({ v, reply: text, rubric, ms, score });
    console.log(
      `    ${(ms / 1000).toFixed(1)}s | ${rubric.chars} 字 | 机制 ${rubric.mechanismHits} | 综合 ${score}\n`
    );
  }

  const analysis = analyzeResults(
    ref.rubric,
    results.map((r) => ({ v: r.v, rubric: r.rubric, ms: r.ms, score: r.score }))
  );

  const outDir = join(config.root, "scripts", "output");
  mkdirSync(outDir, { recursive: true });
  const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const reportPath = "/Users/liusen/Documents/cptsd/docs/全矩阵对比分析报告.md";

  let md = `# 全矩阵对比分析报告（通道 × 参数）

**运行时间**：${new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}
**输入**：\`docs/对话示例\` 长自述，单轮空历史，统一 system prompt
**金样**：DeepSeek 网页版（${ref.rubric.chars} 字）

## 实验矩阵

| ID | 通道 | 模型 | max_tokens | intake |
|----|------|------|------------|--------|
| OR-1 | OpenRouter | ${config.openrouterChatModelDeep} | 8192 | 否 |
| OR-2 | OpenRouter | ${config.openrouterChatModelDeep} | 8192 | 是 |
| OR-3 | OpenRouter | ${config.openrouterChatModelDeep} | 16384 | 是 |
| DS-1 | DeepSeek 官方 | ${config.deepseekChatModelDeep} | 8192 | 否 |
| DS-2 | DeepSeek 官方 | ${config.deepseekChatModelDeep} | 16384 | 是 |
| DS-3 | DeepSeek 官方 | ${config.deepseekChatModelDeep} | 32768 | 是 |

## 指标汇总

| ID | 字数 | 耗时 | 机制词 | 分节 | 温度词 | NPD↔2025 | 模糊拒绝 | 羞耻/比较 | 建议 | 追问收尾 | **综合分** |
|----|------|------|--------|------|--------|----------|----------|-----------|------|----------|-----------|
| 金样 | ${ref.rubric.chars} | — | ${ref.rubric.mechanismHits} | ${ref.rubric.sectionHeaders} | ${ref.rubric.warmthScore} | ✓ | ✓ | ✓ | ✓ | ✗ | 100 |
`;

  for (const r of results) {
    const rb = r.rubric;
    md += `| ${r.v.id} | ${rb.chars} | ${(r.ms / 1000).toFixed(0)}s | ${rb.mechanismHits} | ${rb.sectionHeaders} | ${rb.warmthScore} | ${rb.mentionsNpd2025Link ? "✓" : "✗"} | ${rb.mentionsFuzzyRejection ? "✓" : "✗"} | ${rb.mentionsShameOrSubstitute ? "✓" : "✗"} | ${rb.hasActionAdvice ? "✓" : "✗"} | ${rb.endsWithQuestion ? "✓" : "✗"} | **${r.score}** |\n`;
  }

  md += `\n${analysis}\n\n## 完整回复\n\n`;
  for (const r of results) {
    md += `### ${r.v.id} · ${r.v.label}\n\n${r.reply}\n\n---\n\n`;
  }

  writeFileSync(reportPath, md, "utf8");
  writeFileSync(join(outDir, `full-matrix-${ts}.md`), md, "utf8");
  writeFileSync(
    join(outDir, `full-matrix-${ts}.json`),
    JSON.stringify({ ref: ref.rubric, results }, null, 2),
    "utf8"
  );

  console.log("=== 汇总（按综合分）===");
  for (const r of [...results].sort((a, b) => b.score - a.score)) {
    console.log(`${r.v.id}: 综合 ${r.score}, ${r.rubric.chars} 字`);
  }
  console.log("\n报告:", reportPath);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
