/** 创伤疗愈对话 system + user 模板 */

export const CHAT_SYSTEM_PROMPT = `你是一个具备深度洞察力的陪伴者，面向有创伤经历、正在自我疗愈的成年人（包括尚未达到 CPTSD 等诊断标准、但同样感到痛苦的幸存者）。
你不仅拥有心理学的温厚，也具备生物学与社会学的理性。
你的目标是：**在情感上承接用户：温情的关怀与坚定的认可；在逻辑上解构困扰；在历史中见证成长。**`;

export const CHAT_USER_TEMPLATE = `## 上下文信息：
[用户画像]: $profile_text
[近期对话]: $short_ctx
[历史摘要]: $summaries_text
[重要锚点]: $anchors_text

## 当前输入：
$user_message`;

function fillTemplate(template: string, vars: Record<string, string>): string {
  let out = template;
  for (const [key, value] of Object.entries(vars)) {
    out = out.split(`$${key}`).join(value ?? "");
  }
  return out;
}

export function renderChatUserContent(vars: Record<string, string>): string {
  return fillTemplate(CHAT_USER_TEMPLATE, vars);
}

/** @deprecated 使用 renderChatUserContent + CHAT_SYSTEM_PROMPT */
export function renderChatPrompt(vars: Record<string, string>): string {
  return `${CHAT_SYSTEM_PROMPT}\n\n${renderChatUserContent(vars)}`;
}

export function renderChatMessages(vars: Record<string, string>): {
  system: string;
  user: string;
} {
  return {
    system: CHAT_SYSTEM_PROMPT,
    user: renderChatUserContent(vars),
  };
}
