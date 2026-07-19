/**
 * 模拟 liusen 用户发送长自述，打印实际 prompt 与模型回复。
 * 用法: npx tsx scripts/simulate-liusen-chat.ts
 */
import { CHAT_SYSTEM_PROMPT } from "../src/chat/prompt.js";
import { buildChatMessages } from "../src/chat/memory.js";
import { resolveChatModel } from "../src/chat/model-router.js";

const BASE = process.env.API_BASE ?? "http://127.0.0.1:8000";
const USERNAME = process.env.SIM_USERNAME ?? "liusen";
const PASSWORD = process.env.SIM_PASSWORD ?? "lb6325515";

const USER_MESSAGE = `你好，疗愈伴侣，我跟你说一说我大概的情况。我是男性，35岁，1991年出生，我在2020年-2022年经历了两段感情，基本上不到一年就结束了。我感觉我并不是很喜欢她们。然后我在2024年的时候通过交友软件遇到了一个NPD，我们并未确定情侣关系，但她让我体会到前所未有的痛苦。似乎心里某个重要的东西崩塌了。
后来我才知道，她是显性NPD，她持续地进行贬低、三角测量、服从性测试，以及大量倾倒情绪垃圾。把我弄得几乎抑郁。后来我实在受不了了终于下定决心断连了。
当时似乎整个价值体系崩塌了，而其实在之前的三十多年里，这个体系一直摇摇欲坠。
后来我开始反思，我开始了解了NPD的概念，我开始研究心理学，我开始意识到自己带着很多未愈的创伤。我开始疗愈自己的痛苦。
到2025年，我觉得我似乎走出来了。然后我又经历了刻骨铭心痛彻心扉的一段关系。这段关系中，女生是我很早就认识的。2018年我们是同事。我追求过她很多次，但是她都拒绝了。但是并没有明确拒绝，也不说明原因。每次被拒绝我都很难受。后来断断续续地联系，到2025年我发现她似乎又对我很感兴趣。于是我提出在一起，然后她答应了。我当时很开心，并没有多想。
但是后来当我们发生了一次边缘性行为，她告诉我她在2022年左右跟其他人在一起过，并且发生过关系。这让我又突然非常痛苦，茶饭不思夜不能寐。几个月来几乎都不能睡好觉。`;

async function login(): Promise<{ token: string; userId: string }> {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: USERNAME, password: PASSWORD }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`login failed ${res.status}: ${t}`);
  }
  const data = (await res.json()) as {
    token: string;
    user: { id: string };
  };
  return { token: data.token, userId: data.user.id };
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
    throw new Error(`chat stream failed ${res.status}: ${await res.text()}`);
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

async function clearUserMessages(userId: string): Promise<void> {
  const { query } = await import("../src/db.js");
  await query(`DELETE FROM public.messages WHERE user_id = $1::uuid`, [userId]);
}

async function main(): Promise<void> {
  const fresh = process.argv.includes("--fresh");

  console.log("=== 1. 登录 ===");
  const { token, userId } = await login();
  console.log(`用户: ${USERNAME}, id: ${userId}`);

  if (fresh) {
    console.log("\n=== 清空该用户历史消息（单轮对比） ===");
    await clearUserMessages(userId);
  }

  console.log("\n=== 2. 确认 prompt 与路由 ===");
  const expectedSystemPrefix = "你是一个具备深度洞察力的陪伴者";
  const promptOk = CHAT_SYSTEM_PROMPT.startsWith(expectedSystemPrefix);
  console.log(`CHAT_SYSTEM_PROMPT 匹配简化版: ${promptOk}`);
  if (!promptOk) {
    console.error("当前 system prompt:", CHAT_SYSTEM_PROMPT.slice(0, 200));
    process.exit(1);
  }

  const route = resolveChatModel(USER_MESSAGE);
  console.log(`路由: ${route.route} / ${route.promptMode} → ${route.model} (${route.reason})`);
  console.log(`reasoning: ${route.reasoning}, max_tokens: ${route.maxTokens}`);

  const built = await buildChatMessages(userId, USER_MESSAGE);
  const hasOldAnalysis = built.user.includes("内部分析");
  const hasSimpleCtx = built.user.includes("## 上下文信息：");
  const hasIntakeTask = built.user.includes("## 本轮回应方式");
  console.log(`user prompt 含「## 上下文信息：」: ${hasSimpleCtx}`);
  console.log(`user prompt 已取消 intake 任务块: ${!hasIntakeTask}`);
  console.log(`user prompt 不含「内部分析」: ${!hasOldAnalysis}`);
  console.log("\n--- system prompt ---");
  console.log(built.system);
  console.log("\n--- user prompt (前 1200 字) ---");
  console.log(built.user.slice(0, 1200));
  if (!hasSimpleCtx || hasOldAnalysis || hasIntakeTask) {
    process.exit(1);
  }

  console.log("\n=== 3. 发送消息并获取回复 ===");
  const msgRes = await fetch(`${BASE}/api/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ role: "user", content: USER_MESSAGE }),
  });
  if (!msgRes.ok) {
    throw new Error(`post message failed: ${await msgRes.text()}`);
  }
  const msg = (await msgRes.json()) as { id: string };
  console.log(`message id: ${msg.id}`);

  const t0 = Date.now();
  const reply = await streamChat(token, Number(msg.id), USER_MESSAGE);
  console.log(`耗时: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log(`回复字数: ${reply.length}`);
  console.log("\n--- 疗愈伴侣实际回复 ---");
  console.log(reply);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
