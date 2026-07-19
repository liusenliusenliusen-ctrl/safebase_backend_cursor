/**
 * 用 DeepSeek 网页对话前几轮回放本地 API，对比网页金样。
 * 用法: npx tsx scripts/compare-web-dialogues.ts
 * 依赖: 后端 :8000，账号 SIM_USERNAME/SIM_PASSWORD（默认 liusen / lb6325515）
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { config } from "../src/config.js";

const BASE = process.env.API_BASE ?? "http://127.0.0.1:8000";
const USERNAME = process.env.SIM_USERNAME ?? "liusen";
const PASSWORD = process.env.SIM_PASSWORD ?? "lb6325515";
const ROUNDS = Number(process.env.COMPARE_ROUNDS ?? "2");

type Round = { user: string; assistant_web: string };
type Fixture = { id: string; rounds: Round[] };

function loadFixtures(): Fixture[] {
  const dir = join(config.root, "scripts", "output");
  return [
    {
      id: "对话1-性焦虑",
      rounds: JSON.parse(
        readFileSync(join(dir, "web-deepseek对话1-r3.json"), "utf8")
      ).slice(0, ROUNDS),
    },
    {
      id: "对话2-关系创伤",
      rounds: JSON.parse(
        readFileSync(join(dir, "web-deepseek对话2-r3.json"), "utf8")
      ).slice(0, ROUNDS),
    },
  ];
}

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

async function postUserMessage(token: string, content: string): Promise<number> {
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
  if (!Number.isFinite(id)) {
    throw new Error(`messages response missing id: ${JSON.stringify(data)}`);
  }
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

function rubric(local: string, web: string): {
  localChars: number;
  webChars: number;
  ratio: number;
  hasMetaAnnounce: boolean;
  hasWarmOpen: boolean;
} {
  return {
    localChars: local.length,
    webChars: web.length,
    ratio: web.length ? local.length / web.length : 0,
    hasMetaAnnounce: /我会先|先承接|再串联|先稳稳接住/.test(local),
    hasWarmOpen: /感谢|理解|听到|感受到|你的|这/.test(local.slice(0, 40)),
  };
}

async function main(): Promise<void> {
  const fixtures = loadFixtures();
  const { token, userId } = await login();
  console.log(`login ok user=${USERNAME}`);

  const results: {
    fixture: string;
    round: number;
    userChars: number;
    web: string;
    local: string;
    ms: number;
    rubric: ReturnType<typeof rubric>;
  }[] = [];

  for (const fix of fixtures) {
    console.log(`\n=== ${fix.id} · clear & replay ${fix.rounds.length} rounds ===`);
    await clearMessages(userId);
    for (let i = 0; i < fix.rounds.length; i++) {
      const r = fix.rounds[i];
      console.log(`>>> round ${i + 1} user=${r.user.length}字 web=${r.assistant_web.length}字`);
      const id = await postUserMessage(token, r.user);
      const t0 = Date.now();
      const local = await streamChat(token, id, r.user);
      const ms = Date.now() - t0;
      const rb = rubric(local, r.assistant_web);
      console.log(
        `    local=${rb.localChars}字 ratio=${(rb.ratio * 100).toFixed(0)}% ${ (ms / 1000).toFixed(1)}s meta=${rb.hasMetaAnnounce}`
      );
      results.push({
        fixture: fix.id,
        round: i + 1,
        userChars: r.user.length,
        web: r.assistant_web,
        local,
        ms,
        rubric: rb,
      });
    }
  }

  const outDir = join(config.root, "scripts", "output");
  mkdirSync(outDir, { recursive: true });
  const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const jsonPath = join(outDir, `web-compare-${ts}.json`);
  const mdPath = join(outDir, `web-compare-${ts}.md`);
  writeFileSync(jsonPath, JSON.stringify(results, null, 2), "utf8");

  let md = `# DeepSeek 网页对话对照\n\n`;
  md += `时间：${ts}\n\n`;
  md += `| 对话 | 轮次 | 用户字数 | 网页字数 | 本地字数 | 比例 | 耗时 | 报幕 |\n|------|------|----------|----------|----------|------|------|------|\n`;
  for (const r of results) {
    md += `| ${r.fixture} | ${r.round} | ${r.userChars} | ${r.rubric.webChars} | ${r.rubric.localChars} | ${(r.rubric.ratio * 100).toFixed(0)}% | ${(r.ms / 1000).toFixed(0)}s | ${r.rubric.hasMetaAnnounce ? "Y" : "N"} |\n`;
  }
  md += `\n## 全文对照\n\n`;
  for (const r of results) {
    md += `### ${r.fixture} · 第 ${r.round} 轮\n\n`;
    md += `**用户**（${r.userChars} 字）\n\n`;
    md += `<details><summary>展开用户输入</summary>\n\n${results.find((x) => x === r) ? "" : ""}\n\n</details>\n\n`;
    // include user from fixture via local search - store user in results
  }
  // rebuild md with user text
  md = `# DeepSeek 网页对话对照\n\n时间：${ts}\n\n`;
  md += `| 对话 | 轮次 | 用户字数 | 网页字数 | 本地字数 | 比例 | 耗时 | 报幕 |\n|------|------|----------|----------|----------|------|------|------|\n`;
  for (const r of results) {
    md += `| ${r.fixture} | ${r.round} | ${r.userChars} | ${r.rubric.webChars} | ${r.rubric.localChars} | ${(r.rubric.ratio * 100).toFixed(0)}% | ${(r.ms / 1000).toFixed(0)}s | ${r.rubric.hasMetaAnnounce ? "Y" : "N"} |\n`;
  }
  for (const r of results) {
    md += `\n---\n\n## ${r.fixture} · 第 ${r.round} 轮\n\n`;
    md += `### 网页金样（${r.rubric.webChars} 字）\n\n${r.web}\n\n`;
    md += `### 本地回复（${r.rubric.localChars} 字）\n\n${r.local}\n\n`;
  }
  writeFileSync(mdPath, md, "utf8");
  console.log("\n报告:", mdPath);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
