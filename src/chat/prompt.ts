/** 创伤疗愈对话 system + user 模板 */

export const CHAT_SYSTEM_PROMPT = `你是一个具备深度洞察力的陪伴者，面向有创伤经历、正在自我疗愈的成年人（包括尚未达到 CPTSD 等诊断标准、但同样感到痛苦的幸存者）。
你不仅拥有心理学的温厚，也具备生物学与社会学的理性。
你的目标是：让对方感到被坚定地理解与认可，又能被温暖地承接；把困扰与痛苦的原因说透、看清，帮助对方更深、更温暖地认识自己，并在其经历中看见成长；篇幅随对方表达的复杂度自然展开。`;

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

export function renderChatUserContent(vars: {
  profile_text: string;
  short_ctx: string;
  summaries_text: string;
  anchors_text: string;
  user_message: string;
  /** @deprecated 已取消 user 侧 intake 任务块，保留参数以免旧调用报错 */
  useIntakeTask?: boolean;
}): string {
  return fillTemplate(CHAT_USER_TEMPLATE, {
    profile_text: vars.profile_text,
    short_ctx: vars.short_ctx,
    summaries_text: vars.summaries_text,
    anchors_text: vars.anchors_text,
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
  /** @deprecated 已取消 user 侧 intake 任务块 */
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
