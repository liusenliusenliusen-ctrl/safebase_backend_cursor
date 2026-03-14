from datetime import date, datetime, timedelta

from celery import Celery
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .config import get_settings
from .database import AsyncSessionLocal
from .llm import get_embedding, stream_chat_completion
from .models import Anchor, Message, Profile, Summary, User


settings = get_settings()

app = Celery(
    "cptsd_tasks",
    broker="redis://localhost:6379/0",
    backend="redis://localhost:6379/1",
)


async def _get_session() -> AsyncSession:
    return AsyncSessionLocal()


@app.task
def generate_daily_summaries():
    """
    总结当天对话：每天 23:30 调用。
    简化实现：同步封装异步逻辑（生产中建议更精细的错误处理）。
    """
    import asyncio

    async def _run():
        async with AsyncSessionLocal() as db:
            today = date.today()
            yesterday = today - timedelta(days=1)
            # 对每个用户生成昨天的日摘要（若不存在）
            stmt_users = select(User.id)
            res_users = await db.execute(stmt_users)
            user_ids = [row[0] for row in res_users.fetchall()]
            for uid in user_ids:
                stmt_exist = select(Summary).where(
                    Summary.user_id == uid,
                    Summary.type == "daily",
                    Summary.summary_date == yesterday,
                )
                res_exist = await db.execute(stmt_exist)
                if res_exist.scalar_one_or_none() is not None:
                    continue

                stmt_msgs = select(Message).where(
                    Message.user_id == uid,
                    Message.created_at >= datetime.combine(yesterday, datetime.min.time()),
                    Message.created_at < datetime.combine(today, datetime.min.time()),
                )
                res_msgs = await db.execute(stmt_msgs)
                msgs = res_msgs.scalars().all()
                if not msgs:
                    continue
                convo_text = "\n".join(f"{m.role}: {m.content}" for m in msgs)
                # 使用对话模型生成摘要
                prompt = f"请为下面这一天的对话写一个温柔、简要的情绪与主题摘要：\n{convo_text}"
                full = ""
                async for part in stream_chat_completion(prompt):
                    full += part

                emb = await get_embedding(full)
                summary = Summary(
                    user_id=uid,
                    type="daily",
                    content=full,
                    summary_date=yesterday,
                    embedding=emb,
                )
                db.add(summary)
            await db.commit()

    asyncio.run(_run())


@app.task
def generate_weekly_summaries():
    # 留空实现骨架，具体聚合逻辑可以按需扩展
    return "weekly summary task executed"


@app.task
def generate_monthly_summaries():
    return "monthly summary task executed"


@app.task
def generate_yearly_summaries():
    return "yearly summary task executed"


@app.task
def update_profiles():
    """
    根据近期日摘要与对话，为每个用户刷新长期画像（核心画像、触发清单、资源库）。
    建议每日在日摘要生成之后定时执行（如 0:10）。
    """
    import asyncio

    async def _run():
        async with AsyncSessionLocal() as db:
            stmt_users = select(User.id)
            res_users = await db.execute(stmt_users)
            user_ids = [row[0] for row in res_users.fetchall()]

            for uid in user_ids:
                # 当前画像
                stmt_profile = select(Profile).where(Profile.user_id == uid)
                res_profile = await db.execute(stmt_profile)
                profile = res_profile.scalar_one_or_none()
                if not profile:
                    continue
                current_content = profile.content or ""

                # 近期日摘要（最近 7 条）
                stmt_sum = (
                    select(Summary)
                    .where(Summary.user_id == uid, Summary.type == "daily")
                    .order_by(Summary.summary_date.desc())
                    .limit(7)
                )
                res_sum = await db.execute(stmt_sum)
                summaries = res_sum.scalars().all()
                summaries_text = "\n\n".join(
                    f"[{s.summary_date}] {s.content}" for s in summaries
                )

                # 近期对话（最近 50 条）
                stmt_msgs = (
                    select(Message)
                    .where(Message.user_id == uid)
                    .order_by(Message.created_at.desc())
                    .limit(50)
                )
                res_msgs = await db.execute(stmt_msgs)
                msgs = list(reversed(res_msgs.scalars().all()))
                convo_text = "\n".join(
                    f"{m.role}: {m.content}" for m in msgs
                ) if msgs else "（暂无对话）"

                if not summaries_text and not msgs:
                    continue

                prompt = f"""你是一位 CPTSD 疗愈方向的助理。请根据下面「近期日摘要」和「近期对话片段」，更新该用户的长期画像。

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
{current_content}
---

近期日摘要：
---
{summaries_text or '（暂无）'}
---

近期对话片段：
---
{convo_text[:8000]}
---

请直接输出更新后的完整 Markdown，不要其他解释。"""

                full = ""
                async for part in stream_chat_completion(prompt):
                    full += part
                full = full.strip()
                if not full or "## 核心画像" not in full:
                    continue
                profile.content = full
                # updated_at 由 onupdate 自动更新
            await db.commit()

    asyncio.run(_run())
    return "profile update task executed"


@app.task
def maintain_anchors():
    """
    1）刷新已有锚点：用近期对话更新 current_thought 并更新向量；
    2）从近期日摘要与对话中抽取新锚点（重要事件/触发情境）并写入。
    建议在 update_profiles 之后定时执行（如 0:30）。
    """
    import asyncio

    async def _run():
        async with AsyncSessionLocal() as db:
            stmt_users = select(User.id)
            res_users = await db.execute(stmt_users)
            user_ids = [row[0] for row in res_users.fetchall()]

            for uid in user_ids:
                # ---------- 1. 刷新已有锚点的 current_thought 与 embedding ----------
                stmt_anchors = select(Anchor).where(Anchor.user_id == uid)
                res_anchors = await db.execute(stmt_anchors)
                anchors = res_anchors.scalars().all()

                for anchor in anchors:
                    # 该锚点更新之后产生的消息
                    stmt_msgs = (
                        select(Message)
                        .where(
                            Message.user_id == uid,
                            Message.created_at > anchor.updated_at,
                        )
                        .order_by(Message.created_at.asc())
                    )
                    res_msgs = await db.execute(stmt_msgs)
                    new_msgs = res_msgs.scalars().all()
                    if not new_msgs:
                        continue
                    convo_since = "\n".join(
                        f"{m.role}: {m.content}" for m in new_msgs
                    )[:6000]

                    prompt = f"""请根据用户「该锚点更新后的对话」，简要更新「当前看法」一两句话，体现认知或情绪的细微变化。不要重复事件名或最初看法。

事件名：{anchor.event_name}
最初看法：{anchor.initial_thought or '（无）'}
当前看法（旧）：{anchor.current_thought or '（无）'}

该锚点更新后的对话：
---
{convo_since}
---

请只输出更新后的「当前看法」内容（1–2 句），不要标题或引号。"""

                    full = ""
                    async for part in stream_chat_completion(prompt):
                        full += part
                    full = full.strip()
                    if full:
                        anchor.current_thought = full
                        emb = await get_embedding(
                            f"{anchor.event_name}\n{anchor.initial_thought or ''}\n{full}"
                        )
                        anchor.embedding = emb

                # ---------- 2. 从近期日摘要与对话中抽取新锚点 ----------
                stmt_sum = (
                    select(Summary)
                    .where(Summary.user_id == uid, Summary.type == "daily")
                    .order_by(Summary.summary_date.desc())
                    .limit(5)
                )
                res_sum = await db.execute(stmt_sum)
                summaries = res_sum.scalars().all()
                summaries_text = "\n\n".join(
                    f"[{s.summary_date}] {s.content}" for s in summaries
                )

                stmt_msgs = (
                    select(Message)
                    .where(Message.user_id == uid)
                    .order_by(Message.created_at.desc())
                    .limit(80)
                )
                res_msgs = await db.execute(stmt_msgs)
                msgs = list(reversed(res_msgs.scalars().all()))
                convo_text = "\n".join(
                    f"{m.role}: {m.content}" for m in msgs
                )[:10000] if msgs else ""

                if not summaries_text and not convo_text:
                    continue

                # 已有锚点的事件名，避免重复
                existing_names = {a.event_name.strip().lower() for a in anchors}

                prompt2 = f"""根据下面「近期日摘要」和「近期对话」，提取 0～3 个值得长期记录的「重要事件或触发情境」（例如：某次被否定、某次闪回、与某人的冲突、某个反复出现的念头）。每个事件用一句话命名即可。

若没有明显的新事件，请只输出：无

近期日摘要：
---
{summaries_text or '（无）'}
---

近期对话：
---
{convo_text}
---

请按行输出，每行一个事件名；若没有则只输出「无」。不要编号、不要解释。"""

                full2 = ""
                async for part in stream_chat_completion(prompt2):
                    full2 += part
                full2 = full2.strip()
                lines = [
                    line.strip()
                    for line in full2.splitlines()
                    if line.strip() and line.strip().lower() != "无"
                ]
                for event_name in lines[:3]:
                    if not event_name or event_name.lower() in existing_names:
                        continue
                    # 为新锚点生成 initial_thought（同作 current_thought）
                    prompt3 = f"""针对用户的重要事件/情境：「{event_name}」，用一句温和的话写出用户可能的「最初看法」或情绪（1 句）。不要问句。"""
                    it = ""
                    async for part in stream_chat_completion(prompt3):
                        it += part
                    it = it.strip() or None
                    text_for_emb = f"{event_name}\n{it or ''}"
                    emb = await get_embedding(text_for_emb)
                    anchor_new = Anchor(
                        user_id=uid,
                        event_name=event_name,
                        initial_thought=it,
                        current_thought=it,
                        evolution_history=[],
                        embedding=emb,
                    )
                    db.add(anchor_new)
                    existing_names.add(event_name.lower())

            await db.commit()

    asyncio.run(_run())
    return "anchor maintenance task executed"

