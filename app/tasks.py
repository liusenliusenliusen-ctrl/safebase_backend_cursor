from datetime import date, datetime, timedelta

from celery import Celery
from sqlalchemy import select, text, union
from sqlalchemy.ext.asyncio import AsyncSession

from .config import get_settings
from .database import AsyncSessionLocal
from .llm import get_embedding, stream_chat_completion
from .models import Anchor, Message, Profile, Summary
from .prompting import render_prompt


settings = get_settings()

DEFAULT_PROFILE_CONTENT = """# 核心画像
尚未生成

## 触发清单
尚未记录

## 资源库
尚未记录"""


async def _active_user_ids(db: AsyncSession) -> list[str]:
    """Supabase 主站用户：profiles + 有 messages 的 auth.users，不再依赖 public.users。"""
    stmt = union(
        select(Profile.user_id),
        select(Message.user_id).distinct(),
    )
    res = await db.execute(stmt)
    return [str(row[0]) for row in res.fetchall()]


async def _fetch_recent_diaries_text(
    db: AsyncSession,
    uid: str,
    limit: int = 5,
    updated_since: datetime | None = None,
    max_chars_per: int = 600,
) -> str:
    """主站 diaries 表（非 diary_entries）。"""
    if updated_since is not None:
        stmt = text(
            """
            SELECT title, content
            FROM diaries
            WHERE user_id = :uid AND updated_at >= :since
            ORDER BY updated_at DESC
            LIMIT :lim
            """
        )
        res = await db.execute(
            stmt,
            {"uid": uid, "since": updated_since, "lim": limit},
        )
    else:
        stmt = text(
            """
            SELECT title, content
            FROM diaries
            WHERE user_id = :uid
            ORDER BY updated_at DESC
            LIMIT :lim
            """
        )
        res = await db.execute(stmt, {"uid": uid, "lim": limit})
    rows = res.fetchall()
    if not rows:
        return ""
    lines: list[str] = []
    for title, content in rows:
        t = (title or "无标题").strip()
        c = (content or "")[:max_chars_per]
        lines.append(f"- {t}: {c}")
    return "\n".join(lines)


async def _ensure_profile(db: AsyncSession, uid: str) -> Profile:
    stmt_profile = select(Profile).where(Profile.user_id == uid)
    res_profile = await db.execute(stmt_profile)
    profile = res_profile.scalar_one_or_none()
    if not profile:
        profile = Profile(user_id=uid, content=DEFAULT_PROFILE_CONTENT)
        db.add(profile)
        await db.flush()
    return profile

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
            user_ids = await _active_user_ids(db)
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
                diaries_text = await _fetch_recent_diaries_text(
                    db,
                    uid,
                    limit=3,
                    updated_since=datetime.combine(yesterday, datetime.min.time()),
                )
                prompt = render_prompt(
                    "daily_summary",
                    {
                        "convo_text": convo_text,
                        "diaries_text": diaries_text or "（无）",
                    },
                )
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
            user_ids = await _active_user_ids(db)

            for uid in user_ids:
                profile = await _ensure_profile(db, uid)
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

                diaries_text = await _fetch_recent_diaries_text(db, uid, limit=5)

                if not summaries_text and not msgs and not diaries_text:
                    continue

                prompt = render_prompt(
                    "profile_update",
                    {
                        "current_content": current_content,
                        "summaries_text": summaries_text or "（暂无）",
                        "convo_text": convo_text[:8000],
                        "diaries_text": diaries_text or "（暂无）",
                    },
                )

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
            user_ids = await _active_user_ids(db)

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
                    diaries_since = await _fetch_recent_diaries_text(
                        db,
                        uid,
                        limit=3,
                        updated_since=anchor.updated_at,
                    )

                    prompt = render_prompt(
                        "anchor_update_current_thought",
                        {
                            "event_name": anchor.event_name,
                            "initial_thought": anchor.initial_thought or "（无）",
                            "current_thought": anchor.current_thought or "（无）",
                            "convo_since": convo_since,
                            "diaries_text": diaries_since or "（无）",
                        },
                    )

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

                diaries_text = await _fetch_recent_diaries_text(db, uid, limit=5)

                if not summaries_text and not convo_text and not diaries_text:
                    continue

                existing_names = {a.event_name.strip().lower() for a in anchors}

                prompt2 = render_prompt(
                    "anchor_extract",
                    {
                        "summaries_text": summaries_text or "（无）",
                        "convo_text": convo_text,
                        "diaries_text": diaries_text or "（无）",
                    },
                )

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
                    # 新建锚点：用与「更新 current_thought」同一套 prompt，在「尚无最初/当前看法」时
                    # 从近期对话得到首次「当前看法」；该快照同时作为 initial_thought（时间上最早的 current）。
                    convo_for_new = (convo_text or "")[:6000]
                    prompt_bootstrap = render_prompt(
                        "anchor_update_current_thought",
                        {
                            "event_name": event_name,
                            "initial_thought": "（无）",
                            "current_thought": "（无）",
                            "convo_since": convo_for_new,
                            "diaries_text": diaries_text or "（无）",
                        },
                    )
                    first_view = ""
                    async for part in stream_chat_completion(prompt_bootstrap):
                        first_view += part
                    first_view = first_view.strip() or None
                    text_for_emb = f"{event_name}\n{first_view or ''}"
                    emb = await get_embedding(text_for_emb)
                    anchor_new = Anchor(
                        user_id=uid,
                        event_name=event_name,
                        initial_thought=first_view,
                        current_thought=first_view,
                        evolution_history=[],
                        embedding=emb,
                    )
                    db.add(anchor_new)
                    existing_names.add(event_name.lower())

            await db.commit()

    asyncio.run(_run())
    return "anchor maintenance task executed"

