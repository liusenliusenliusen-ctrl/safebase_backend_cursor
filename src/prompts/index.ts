import { readFileSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { config } from "../config.js";

const DEFAULT_PROMPT_TEMPLATES: Record<string, string> = {
  daily_summary: `请为下面这一天的对话写一个温柔、简要的情绪与主题摘要：
$convo_text`,
  profile_update: `你是一位创伤疗愈方向的助理。请根据下面「近期日摘要」和「近期对话片段」，更新该用户的长期画像。

要求：输出一份 Markdown，且必须包含以下三个二级标题（顺序不可变）：
## 核心画像
（简要描述：性格特点、常见情绪模式、成长主题，2–4 句即可）

## 触发清单
（易引发情绪波动的人、事、情境，用短条列示）

## 资源库
（对用户有帮助的认知、句子、或资源建议，短条列示）

若信息不足以推断某一块，该块下可写「尚未充分信息」或保留原有要点。
当前画像（供参考、可在此基础上增删改）：
---
$current_content
---
近期日摘要：
---
$summaries_text
---
近期对话片段：
---
$convo_text
---
请直接输出更新后的完整 Markdown，不要其他解释。`,
  anchor_update_current_thought: `请根据用户「该锚点更新后的对话」，简要更新「当前看法」一两句话，体现认知或情绪的细微变化。不要重复事件名或最初看法。

事件名：$event_name
最初看法：$initial_thought
当前看法（旧）：$current_thought

该锚点更新后的对话：
---
$convo_since
---
该时段相关日记（如有）：
---
$diaries_text
---
请只输出更新后的「当前看法」内容（1–2 句），不要标题或引号。`,
  anchor_extract: `根据下面「近期日摘要」和「近期对话」，提取 0～3 个值得长期记录的「重要事件或触发情境」（例如：某次被否定、某次闪回、与某人的冲突、某个反复出现的念头）。每个事件用一句话命名即可。

若没有明显的新事件，请只输出：无

近期日摘要：
---
$summaries_text
---
近期对话：
---
$convo_text
---
请按行输出，每行一个事件名；若没有则只输出「无」。不要编号、不要解释。`,
};

const fileCache = new Map<string, { mtime: number; text: string }>();

function templatePath(name: string): string | null {
  if (!config.promptTemplateDir) return null;
  return join(config.promptTemplateDir, `${name}.txt`);
}

function loadTemplateText(name: string): string {
  if (!(name in DEFAULT_PROMPT_TEMPLATES)) {
    throw new Error(`Unknown prompt template: ${name}`);
  }
  const path = templatePath(name);
  if (path && existsSync(path)) {
    const mtime = statSync(path).mtimeMs;
    const cached = fileCache.get(name);
    if (!cached || cached.mtime < mtime) {
      const text = readFileSync(path, "utf-8");
      fileCache.set(name, { mtime, text });
    }
    return fileCache.get(name)!.text;
  }
  return DEFAULT_PROMPT_TEMPLATES[name];
}

export function renderPrompt(
  name: string,
  variables: Record<string, string | null | undefined>
): string {
  let out = loadTemplateText(name);
  for (const [key, value] of Object.entries(variables)) {
    out = out.split(`$${key}`).join(value ?? "");
  }
  return out;
}
