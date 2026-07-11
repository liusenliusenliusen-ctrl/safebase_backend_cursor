import { config } from "../config.js";
import { getChatModelIds } from "../llm/chat-provider.js";

export type ChatModelRoute = "deep" | "fast";
export type ChatPromptMode = "fast" | "deep" | "intake";

export type ResolvedChatModel = {
  route: ChatModelRoute;
  promptMode: ChatPromptMode;
  model: string;
  /** OpenRouter 深度轮 reasoning；DeepSeek 深度轮为 reasoner 模型 */
  reasoning: boolean;
  maxTokens: number;
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

/** 急性 distress：走 deep 模型但不用长文 intake 模板 */
const ACUTE_DISTRESS_SIGNALS = [
  "闪回",
  "喘不上",
  "想死",
  "自杀",
  "自残",
  "割腕",
  "活不下去",
  "撑不住",
  "马上崩溃",
  "现在就要",
  "此刻",
  "当下",
];

function countDepthSignals(text: string): number {
  return DEPTH_SIGNALS.filter((s) => text.includes(s)).length;
}

function isAcuteDistress(text: string): boolean {
  return ACUTE_DISTRESS_SIGNALS.some((s) => text.includes(s));
}

function isNarrativeIntake(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < config.openrouterChatDeepMinChars) return false;
  if (isAcuteDistress(trimmed)) return false;

  const sentences = trimmed
    .split(/[。！？\n]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 8);
  const richTimeline = countDepthSignals(trimmed) >= 2;

  return sentences.length >= 3 || richTimeline;
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
    const intake = isNarrativeIntake(userMessage);
    return {
      route: "deep",
      promptMode: intake ? "intake" : "deep",
      model: modelDeep,
      reasoning: deepReasoningEnabled(),
      maxTokens: intake
        ? config.openrouterChatMaxTokensDeep
        : config.openrouterChatMaxTokens,
      useIntakeTask: intake,
      reason: intake ? "routing_disabled,intake" : "routing_disabled",
    };
  }

  const text = userMessage.trim();
  const len = text.length;
  const signals = countDepthSignals(text);

  const longIntake = len >= config.openrouterChatDeepMinChars;
  const richTimeline = signals >= 2;
  const useDeep = longIntake || richTimeline;
  const intake = useDeep && isNarrativeIntake(text);

  if (useDeep) {
    const parts: string[] = [];
    if (longIntake) parts.push(`length>=${config.openrouterChatDeepMinChars}`);
    if (richTimeline) parts.push(`signals=${signals}`);
    if (intake) parts.push("intake");
    if (isAcuteDistress(text)) parts.push("acute");

    return {
      route: "deep",
      promptMode: intake ? "intake" : "deep",
      model: modelDeep,
      reasoning: deepReasoningEnabled(),
      maxTokens: intake
        ? config.openrouterChatMaxTokensDeep
        : config.openrouterChatMaxTokens,
      useIntakeTask: intake,
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
