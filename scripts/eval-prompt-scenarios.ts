/**
 * 多场景泛化评测：经典自述 + 网页对话1/2 + 自建短/中/急性场景。
 * 用法: npx tsx scripts/eval-prompt-scenarios.ts
 * 可选: EVAL_TAG=r11 写入报告文件名
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { config } from "../src/config.js";
import { CHAT_SYSTEM_PROMPT } from "../src/chat/prompt.js";
import { resolveChatModel } from "../src/chat/model-router.js";

const BASE = process.env.API_BASE ?? "http://127.0.0.1:8000";
const USERNAME = process.env.SIM_USERNAME ?? "liusen";
const PASSWORD = process.env.SIM_PASSWORD ?? "lb6325515";
const TAG = process.env.EVAL_TAG ?? "eval";

type Turn = { user: string };
type Scenario = {
  id: string;
  label: string;
  /** fresh = 清空后单轮或多轮；continue 不支持，一律每场景清空 */
  turns: Turn[];
  expect: "short" | "medium" | "deep";
};

const CLASSIC_INTAKE = `你好，我跟你说一说我大概的情况。我是男性，35岁，1991年出生，我在2020年-2022年经历了两段感情，基本上不到一年就结束了。我感觉我并不是很喜欢她们。然后我在2024年的时候通过交友软件遇到了一个NPD，我们并未确定情侣关系，但她让我体会到前所未有的痛苦。似乎心里某个重要的东西崩塌了。
后来我才知道，她是显性NPD，她持续地进行贬低、三角测量、服从性测试，以及大量倾倒情绪垃圾。把我弄得几乎抑郁。后来我实在受不了了终于下定决心断连了。
当时似乎整个价值体系崩塌了，而其实在之前的三十多年里，这个体系一直摇摇欲坠。

后来我开始反思，我开始了解了NPD的概念，我开始研究心理学，我开始了解自己是CPTSD幸存者。我开始疗愈自己的痛苦。

到2025年，我觉得我似乎走出来了。然后我又经历了刻骨铭心痛彻心扉的一段关系。这段关系中，女生是我很早就认识的。2018年我们是同事。我追求过她很多次，但是她都拒绝了。但是并没有明确拒绝，也不说明原因。每次被拒绝我都很难受。后来断断续续地联系，到2025年我发现她似乎又对我很感兴趣。于是我提出在一起，然后她答应了。我当时很开心，并没有多想。
但是后来当我们发生了一次边缘性行为，她告诉我她在2022年左右跟其他人在一起过，并且发生过关系。这让我又突然非常痛苦，茶饭不思夜不能寐。几个月来几乎都不能睡好觉。`;

function loadWebRounds(file: string, n: number): Turn[] {
  const raw = JSON.parse(
    readFileSync(join(config.root, "scripts", "output", file), "utf8")
  ) as { user: string }[];
  return raw.slice(0, n).map((r) => ({ user: r.user }));
}

const SCENARIOS: Scenario[] = [
  {
    id: "classic-intake",
    label: "经典自述（NPD+2025同事）",
    expect: "deep",
    turns: [{ user: CLASSIC_INTAKE }],
  },
  {
    id: "web-d1",
    label: "网页对话1 前2轮（性焦虑）",
    expect: "deep",
    turns: loadWebRounds("web-deepseek对话1-r3.json", 2),
  },
  {
    id: "web-d2",
    label: "网页对话2 前2轮（关系创伤）",
    expect: "deep",
    turns: loadWebRounds("web-deepseek对话2-r3.json", 2),
  },
  {
    id: "short-checkin",
    label: "短句签到",
    expect: "short",
    turns: [{ user: "今天心情一般，没什么特别想说的，就想待一会儿。" }],
  },
  {
    id: "acute-short",
    label: "急性短句",
    expect: "short",
    turns: [{ user: "我现在胸口很紧，脑子里一直转，有点撑不住。" }],
  },
  {
    id: "medium-work",
    label: "中等职场触发",
    expect: "medium",
    turns: [
      {
        user: "今天下午开会被当众点名批评，我当时整个人僵住，回去一路上都在想是不是自己本来就不配待在这个团队。晚上躺着还在反复回放那几句话。",
      },
    ],
  },
  {
    id: "followup-fear",
    label: "短跟进-害怕被抛弃",
    expect: "medium",
    turns: [
      { user: CLASSIC_INTAKE },
      {
        user: "我现在总害怕。总是在揣测她的想法，总是怀疑她会不会因为我的脆弱而对我否定，并且选择离开我。",
      },
    ],
  },
];

async function login(): Promise<{ token: string; userId: string }> {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: USERNAME, password: PASSWORD }),
  });
  if (!res.ok) throw new Error(`login ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { token: string; user: { id: string } };
  return { token: data.token, userId: data.user.id };
}

async function clearMessages(userId: string): Promise<void> {
  const { query } = await import("../src/db.js");
  await query(`DELETE FROM public.messages WHERE user_id = $1::uuid`, [userId]);
}

async function postUser(token: string, content: string): Promise<number> {
  const res = await fetch(`${BASE}/api/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ role: "user", content }),
  });
  if (!res.ok) throw new Error(`messages ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { id?: string | number };
  const id = Number(data.id);
  if (!Number.isFinite(id)) throw new Error(`bad id ${JSON.stringify(data)}`);
  return id;
}

async function streamChat(
  token: string,
  userMessageId: number,
  userMessage: string
): Promise<string> {
  const res = await fetch(`${BASE}/api/chat/stream`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      user_message_id: userMessageId,
      messages: [{ role: "user", content: userMessage }],
    }),
  });
  if (!res.ok || !res.body) {
    throw new Error(`stream ${res.status}: ${await res.text()}`);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let full = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const parts = buf.split("\n\n");
    buf = parts.pop() ?? "";
    for (const block of parts) {
      for (const line of block.split("\n")) {
        if (line.startsWith("data: ")) {
          const payload = line.slice(6);
          if (payload && payload !== "[DONE]") full += payload;
        }
      }
    }
  }
  return full.trim();
}

function score(text: string, expect: Scenario["expect"], user: string) {
  const meta = /我会先|先承接|再串联|先稳稳接住/.test(text);
  const warm = /谢谢|感谢|理解|感受到|听到|你/.test(text.slice(0, 60));
  const mechanismHits = [
    "模式",
    "触发",
    "创伤",
    "认可",
    "选择",
    "焦虑",
    "恐惧",
    "价值",
  ].filter((k) => text.includes(k)).length;
  const plotSplit =
    user.length >= 400
      ? ["追求", "拒绝", "答应", "边缘", "坦白", "2025", "NPD"].filter((k) =>
          text.includes(k)
        ).length
      : null;
  return {
    chars: text.length,
    meta,
    warm,
    mechanismHits,
    plotSplit,
    expect,
    lengthOk:
      expect === "short"
        ? text.length < 1200
        : expect === "medium"
          ? text.length >= 400 && text.length < 3500
          : text.length >= 1500,
  };
}

async function main(): Promise<void> {
  console.log("=== prompt eval ===");
  console.log("TAG:", TAG);
  console.log("system:\n", CHAT_SYSTEM_PROMPT, "\n");

  const { token, userId } = await login();
  const results: Record<string, unknown>[] = [];

  for (const sc of SCENARIOS) {
    console.log(`\n### ${sc.id} · ${sc.label}`);
    await clearMessages(userId);
    let lastReply = "";
    for (let i = 0; i < sc.turns.length; i++) {
      const user = sc.turns[i].user;
      const route = resolveChatModel(user);
      console.log(
        `  turn ${i + 1}: user=${user.length} → ${route.route}/${route.model} (${route.reason})`
      );
      const id = await postUser(token, user);
      const t0 = Date.now();
      const reply = await streamChat(token, id, user);
      const ms = Date.now() - t0;
      lastReply = reply;
      const s = score(reply, sc.expect, user);
      console.log(
        `    → ${s.chars}字 ${(ms / 1000).toFixed(1)}s warm=${s.warm} meta=${s.meta} mech=${s.mechanismHits} lenOk=${s.lengthOk}`
      );
      results.push({
        scenario: sc.id,
        label: sc.label,
        turn: i + 1,
        userChars: user.length,
        route: route.route,
        model: route.model,
        reason: route.reason,
        ms,
        reply,
        score: s,
      });
    }
    if (sc.id === "classic-intake") {
      const idx = lastReply.indexOf("2025");
      console.log(
        "  --- 2025 window ---\n",
        lastReply.slice(Math.max(0, idx - 80), idx + 900)
      );
    }
  }

  const outDir = join(config.root, "scripts", "output");
  mkdirSync(outDir, { recursive: true });
  const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const jsonPath = join(outDir, `scenario-eval-${TAG}-${ts}.json`);
  const mdPath = join(outDir, `scenario-eval-${TAG}-${ts}.md`);
  writeFileSync(jsonPath, JSON.stringify({ tag: TAG, system: CHAT_SYSTEM_PROMPT, results }, null, 2));

  let md = `# 场景评测 · ${TAG}\n\n`;
  md += `时间：${ts}\n\n## System\n\n\`\`\`\n${CHAT_SYSTEM_PROMPT}\n\`\`\`\n\n`;
  md += `| 场景 | 轮 | 路由 | 字数 | 耗时 | warm | meta | mech | lenOk |\n|------|----|------|------|------|------|------|------|-------|\n`;
  for (const r of results) {
    const s = r.score as ReturnType<typeof score>;
    md += `| ${r.scenario} | ${r.turn} | ${r.route} | ${s.chars} | ${((r.ms as number) / 1000).toFixed(0)}s | ${s.warm} | ${s.meta} | ${s.mechanismHits} | ${s.lengthOk} |\n`;
  }
  md += `\n## 回复摘录\n\n`;
  for (const r of results) {
    md += `### ${r.scenario} · turn ${r.turn}\n\n${(r.reply as string).slice(0, 1200)}\n\n---\n\n`;
  }
  writeFileSync(mdPath, md, "utf8");
  console.log("\n报告:", mdPath);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
