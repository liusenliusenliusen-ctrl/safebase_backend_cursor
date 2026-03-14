from datetime import date

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from sqlalchemy import bindparam, select, text
from sqlalchemy.ext.asyncio import AsyncSession
from pgvector.sqlalchemy import Vector

from .database import get_db
from .deps import get_current_user
from .llm import get_embedding, stream_chat_completion
from .models import Anchor, Message, Profile, Summary, User
from .schemas import ChatRequest, UserOut


router = APIRouter(prefix="/api", tags=["chat"])


async def build_memory_context(
    db: AsyncSession,
    user_id: str,
    user_message: str,
) -> str:
    # 画像
    stmt_profile = select(Profile).where(Profile.user_id == user_id)
    res_profile = await db.execute(stmt_profile)
    profile = res_profile.scalar_one_or_none()
    profile_text = profile.content if profile else "# 核心画像\n尚未生成\n"

    # 近期对话（最近 30 条）
    stmt_msgs = (
        select(Message)
        .where(Message.user_id == user_id)
        .order_by(Message.created_at.desc())
        .limit(30)
    )
    res_msgs = await db.execute(stmt_msgs)
    msgs = list(reversed(res_msgs.scalars().all()))
    short_ctx_lines: list[str] = []
    for m in msgs:
        role = "用户" if m.role == "user" else "AI"
        short_ctx_lines.append(f"{role}: {m.content}")
    short_ctx = "\n".join(short_ctx_lines)

    # 中层摘要与锚点检索
    emb = await get_embedding(user_message)

    # 2 条相关日摘要
    summaries_text = ""
    stmt_summaries = text(
        """
        SELECT id, type, content, summary_date
        FROM summaries
        WHERE user_id = :user_id AND type = 'daily' AND embedding IS NOT NULL
        ORDER BY embedding <-> :embedding
        LIMIT 2
        """
    ).bindparams(bindparam("embedding", type_=Vector(2048)))
    res_summaries = await db.execute(
        stmt_summaries, {"user_id": user_id, "embedding": emb}
    )
    rows_summaries = res_summaries.fetchall()
    for row in rows_summaries:
        summaries_text += f"- {row.summary_date}: {row.content}\n"

    # 1 条相关锚点
    anchors_text = ""
    stmt_anchors = text(
        """
        SELECT event_name, initial_thought, current_thought
        FROM anchors
        WHERE user_id = :user_id AND embedding IS NOT NULL
        ORDER BY embedding <-> :embedding
        LIMIT 1
        """
    ).bindparams(bindparam("embedding", type_=Vector(2048)))
    res_anchors = await db.execute(stmt_anchors, {"user_id": user_id, "embedding": emb})
    row_anchor = res_anchors.fetchone()
    if row_anchor:
        anchors_text = (
            f"事件：{row_anchor.event_name}\n"
            f"最初看法：{row_anchor.initial_thought or ''}\n"
            f"当前看法：{row_anchor.current_thought or ''}\n"
        )

    prompt = f"""你是一位温柔、稳定、具备 CPTSD 专业知识的长期疗愈伴侣。
请使用下列信息来理解用户，并进行有共情的回复。避免生硬的心理学术语，多用具象、轻柔的表达。

## 用户静态画像
{profile_text}

## 近期对话片段
{short_ctx}

## 相关历史摘要（部分）
{summaries_text}

## 重要事件锚点（部分）
{anchors_text}

## 本次用户输入
{user_message}
"""
    return prompt


@router.post("/chat")
async def chat(
    body: ChatRequest,
    db: AsyncSession = Depends(get_db),
    current_user: UserOut = Depends(get_current_user),
):
    # 校验 user_id 与 token 一致
    if body.user_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User ID mismatch",
        )

    # 确认用户存在（若已被清库等，返回 401 让前端清 token 并跳转登录）
    stmt_user = select(User).where(User.id == body.user_id)
    res_user = await db.execute(stmt_user)
    if res_user.scalar_one_or_none() is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")

    # 保存用户消息 + 向量
    user_embedding = await get_embedding(body.message)
    msg_user = Message(
        user_id=body.user_id,
        role="user",
        content=body.message,
        embedding=user_embedding,
    )
    db.add(msg_user)
    await db.commit()
    await db.refresh(msg_user)

    prompt = await build_memory_context(db, body.user_id, body.message)

    async def event_stream():
        full_text_parts: list[str] = []
        async for chunk in stream_chat_completion(prompt):
            full_text_parts.append(chunk)
            yield f"data: {chunk}\n\n"

        # 所有内容流式发送完后，再统一保存 AI 回复，确保在前端收到 end 事件时已落库
        full_text = "".join(full_text_parts)
        assistant_embedding = await get_embedding(full_text)
        msg_ai = Message(
            user_id=body.user_id,
            role="assistant",
            content=full_text,
            embedding=assistant_embedding,
        )
        db.add(msg_ai)
        await db.commit()

        # 结束标记（放在保存之后，保证前端拉取最新消息时能拿到这条回复）
        yield "event: end\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")

