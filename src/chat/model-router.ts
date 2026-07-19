import { config } from "../config.js";
import { getChatModelIds } from "../llm/chat-provider.js";

export type ChatModelRoute = "deep" | "fast";
export type ChatPromptMode = "fast" | "deep";

export type ResolvedChatModel = {
  route: ChatModelRoute;
  promptMode: ChatPromptMode;
  model: string;
  /** OpenRouter 深度轮 reasoning；DeepSeek 深度轮为 reasoner 模型 */
  reasoning: boolean;
  maxTokens: number;
  /** @deprecated 已取消 user 侧 intake 任务；恒为 false，保留字段兼容日志 */
  useIntakeTask: boolean;
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

function deepReasoningEnabled(): boolean {
  if (config.llmChatProvider === "deepseek") {
    return true;
  }
  return config.openrouterChatReasoningEnabled;
}

/** 根据用户当轮消息选择深度 / 快轨（双模型路由；模型 ID 随 LLM_CHAT_PROVIDER 映射） */
export function resolveChatModel(userMessage: string): ResolvedChatModel {
  const { deep: modelDeep, fast: modelFast } = getChatModelIds();

  if (!config.openrouterChatRoutingEnabled) {
    return {
      route: "deep",
      promptMode: "deep",
      model: modelDeep,
      reasoning: deepReasoningEnabled(),
      maxTokens: config.openrouterChatMaxTokensDeep,
      useIntakeTask: false,
      reason: "routing_disabled",
    };
  }

  const text = userMessage.trim();
  const len = text.length;
  const signals = countDepthSignals(text);

  const longMessage = len >= config.openrouterChatDeepMinChars;
  const richTimeline = signals >= 2;
  const useDeep = longMessage || richTimeline;

  if (useDeep) {
    const parts: string[] = [];
    if (longMessage) parts.push(`length>=${config.openrouterChatDeepMinChars}`);
    if (richTimeline) parts.push(`signals=${signals}`);

    return {
      route: "deep",
      promptMode: "deep",
      model: modelDeep,
      reasoning: deepReasoningEnabled(),
      // 深度轮统一给足预算；篇幅由 system 按复杂度自然展开，不再靠 intake 任务块拉长
      maxTokens: config.openrouterChatMaxTokensDeep,
      useIntakeTask: false,
      reason: parts.join(","),
    };
  }

  return {
    route: "fast",
    promptMode: "fast",
    model: modelFast,
    reasoning: false,
    maxTokens: config.openrouterChatMaxTokensFast,
    useIntakeTask: false,
    reason: len < config.openrouterChatDeepMinChars ? "short_message" : "low_signals",
  };
}
