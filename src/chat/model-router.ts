import { config } from "../config.js";

export type ChatModelRoute = "deep" | "fast";

export type ResolvedChatModel = {
  route: ChatModelRoute;
  model: string;
  /** 流式请求是否附带 OpenRouter reasoning */
  reasoning: boolean;
  reason: string;
};

/** 深度轮关键词：长自述、关系/创伤时间线 */
const DEPTH_SIGNALS = [
  "NPD",
  "创伤",
  "闪回",
  "解离",
  "躯体化",
  "依恋",
  "原生家庭",
  "价值体系",
  "茶饭不思",
  "夜不能寐",
  "2018",
  "2019",
  "2020",
  "2021",
  "2022",
  "2023",
  "2024",
  "2025",
];

function countDepthSignals(text: string): number {
  return DEPTH_SIGNALS.filter((s) => text.includes(s)).length;
}

/** 根据用户当轮消息选择 deepseek-r1（深度）或 deepseek-chat（快轨） */
export function resolveChatModel(userMessage: string): ResolvedChatModel {
  if (!config.openrouterChatRoutingEnabled) {
    return {
      route: "deep",
      model: config.openrouterChatModelDeep,
      reasoning: config.openrouterChatReasoningEnabled,
      reason: "routing_disabled",
    };
  }

  const text = userMessage.trim();
  const len = text.length;
  const signals = countDepthSignals(text);

  const longIntake = len >= config.openrouterChatDeepMinChars;
  const richTimeline = signals >= 2;
  const useDeep = longIntake || richTimeline;

  if (useDeep) {
    const parts: string[] = [];
    if (longIntake) parts.push(`length>=${config.openrouterChatDeepMinChars}`);
    if (richTimeline) parts.push(`signals=${signals}`);
    return {
      route: "deep",
      model: config.openrouterChatModelDeep,
      reasoning: config.openrouterChatReasoningEnabled,
      reason: parts.join(","),
    };
  }

  return {
    route: "fast",
    model: config.openrouterChatModelFast,
    reasoning: false,
    reason: len < config.openrouterChatDeepMinChars ? "short_message" : "low_signals",
  };
}
