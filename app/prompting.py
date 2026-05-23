import logging
from pathlib import Path
from string import Template
from typing import Any, Mapping

from .config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()


DEFAULT_PROMPT_TEMPLATES: dict[str, str] = {
    # Tasks: generate_daily_summaries
    "daily_summary": """请为下面这一天的对话写一个温柔、简要的情绪与主题摘要：
$convo_text""",
    # Tasks: update_profiles
    "profile_update": """你是一位 CPTSD 疗愈方向的助理。请根据下面「近期日摘要」和「近期对话片段」，更新该用户的长期画像。

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
请直接输出更新后的完整 Markdown，不要其他解释。""",
    # Tasks: maintain_anchors — 既用于「已有锚点随对话更新 current_thought」，
    # 也用于「新建锚点」：在最初看法/当前看法均为（无）时，用同一段近期对话得到首次看法，
    # 该结果同时写入 initial_thought 与 current_thought（时间上最早的「当前看法」即初始看法）。
    "anchor_update_current_thought": """请根据用户「该锚点更新后的对话」，简要更新「当前看法」一两句话，体现认知或情绪的细微变化。不要重复事件名或最初看法。

事件名：$event_name
最初看法：$initial_thought
当前看法（旧）：$current_thought

该锚点更新后的对话：
---
$convo_since
---
请只输出更新后的「当前看法」内容（1–2 句），不要标题或引号。""",
    # Tasks: maintain_anchors -> extract new anchors
    "anchor_extract": """根据下面「近期日摘要」和「近期对话」，提取 0～3 个值得长期记录的「重要事件或触发情境」（例如：某次被否定、某次闪回、与某人的冲突、某个反复出现的念头）。每个事件用一句话命名即可。

若没有明显的新事件，请只输出：无

近期日摘要：
---
$summaries_text
---
近期对话：
---
$convo_text
---
请按行输出，每行一个事件名；若没有则只输出「无」。不要编号、不要解释。""",
}


_FILE_TEMPLATE_CACHE: dict[str, tuple[float, Template]] = {}


def _template_path(template_name: str) -> Path | None:
    base_dir = getattr(settings, "prompt_template_dir", None)
    if not base_dir:
        return None
    return Path(base_dir).expanduser().resolve() / f"{template_name}.txt"


def load_prompt_template(template_name: str, *, reload: bool = False) -> Template:
    if template_name not in DEFAULT_PROMPT_TEMPLATES:
        raise KeyError(f"Unknown prompt template: {template_name}")

    template_path = _template_path(template_name)
    if template_path and template_path.exists():
        mtime = template_path.stat().st_mtime
        cached = _FILE_TEMPLATE_CACHE.get(template_name)
        if reload or cached is None or cached[0] < mtime:
            text = template_path.read_text(encoding="utf-8")
            _FILE_TEMPLATE_CACHE[template_name] = (mtime, Template(text))
            logger.info("Loaded prompt template from file: %s", template_path)
        return _FILE_TEMPLATE_CACHE[template_name][1]

    # Fallback to embedded default (always available).
    return Template(DEFAULT_PROMPT_TEMPLATES[template_name])


def render_prompt(
    template_name: str,
    variables: Mapping[str, Any],
    *,
    reload: bool = False,
) -> str:
    tmpl = load_prompt_template(template_name, reload=reload)
    str_vars: dict[str, str] = {k: ("" if v is None else str(v)) for k, v in variables.items()}
    try:
        return tmpl.substitute(str_vars)
    except KeyError as e:
        missing = str(e).strip("'")
        logger.error(
            "Prompt template '%s' missing variable '%s'. Provided keys=%s",
            template_name,
            missing,
            sorted(str_vars.keys()),
        )
        raise


def list_prompt_templates() -> list[str]:
    return sorted(DEFAULT_PROMPT_TEMPLATES.keys())
