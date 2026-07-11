/** 创伤疗愈对话 system + user 模板 */

export const CHAT_SYSTEM_PROMPT = `你是一个具备深度洞察力的陪伴者，面向有创伤经历、正在自我疗愈的成年人（包括尚未达到 CPTSD 等诊断标准、但同样感到痛苦的幸存者）。
你不仅拥有心理学的温厚，也具备生物学与社会学的理性。
你的目标是：**在情感上承接用户：温情的关怀与坚定的认可；在逻辑上解构困扰；在历史中见证成长。**`;

/**
 * 仅用于「长叙述 intake」轮次，注入 user 侧（非 system）。
 * 提炼自 DeepSeek 网页版对长自述的回应模式：承接 → 串联模式 → 深层需求 → 可执行方向。
 * 不写死具体案例词，避免泛化性下降。
 */
export const CHAT_USER_INTAKE_TASK = `## 本轮回应方式
用户正在做较完整的经历叙述，往往没有提出单一明确问题，但隐含「想被理解、看清背后模式、知道如何走下去」。请：
1. **先承接**：真诚理解其痛苦，肯定其坦诚与勇气，正常化感受；
2. **再串联**：若叙述含多段经历或时间线，尝试把它们连起来，指出可能重复出现的心理模式（概念用到时再精准命名，不必堆砌术语）；
3. **看深层**：区分表面困扰与更深处的不安、需求或恐惧；
4. **给方向**：提供少量具体、可执行的建议或下一步；若涉及当下急性痛苦，优先稳定与安全，篇幅从简；
5. **结构**：可清晰分节，便于阅读；不要以一个敷衍的追问作为全文收尾。`;

export const CHAT_USER_TEMPLATE = `## 上下文信息：
[用户画像]: $profile_text
[近期对话]: $short_ctx
[历史摘要]: $summaries_text
[重要锚点]: $anchors_text
$depth_task
## 当前输入：
$user_message`;

function fillTemplate(template: string, vars: Record<string, string>): string {
  let out = template;
  for (const [key, value] of Object.entries(vars)) {
    out = out.split(`$${key}`).join(value ?? "");
  }
  return out;
}

export function renderChatUserContent(vars: {
  profile_text: string;
  short_ctx: string;
  summaries_text: string;
  anchors_text: string;
  user_message: string;
  useIntakeTask?: boolean;
}): string {
  const depth_task = vars.useIntakeTask
    ? `\n${CHAT_USER_INTAKE_TASK}\n`
    : "";
  return fillTemplate(CHAT_USER_TEMPLATE, {
    profile_text: vars.profile_text,
    short_ctx: vars.short_ctx,
    summaries_text: vars.summaries_text,
    anchors_text: vars.anchors_text,
    depth_task,
    user_message: vars.user_message,
  });
}

/** @deprecated 使用 renderChatUserContent + CHAT_SYSTEM_PROMPT */
export function renderChatPrompt(vars: Record<string, string>): string {
  return `${CHAT_SYSTEM_PROMPT}\n\n${renderChatUserContent({
    profile_text: vars.profile_text ?? "",
    short_ctx: vars.short_ctx ?? "",
    summaries_text: vars.summaries_text ?? "",
    anchors_text: vars.anchors_text ?? "",
    user_message: vars.user_message ?? "",
  })}`;
}

export function renderChatMessages(vars: {
  profile_text: string;
  short_ctx: string;
  summaries_text: string;
  anchors_text: string;
  user_message: string;
  useIntakeTask?: boolean;
}): {
  system: string;
  user: string;
} {
  return {
    system: CHAT_SYSTEM_PROMPT,
    user: renderChatUserContent(vars),
  };
}
