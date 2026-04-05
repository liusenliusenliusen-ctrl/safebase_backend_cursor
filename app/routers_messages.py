from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from .database import get_db
from .deps import get_current_user
from .models import Message, User
from .schemas import MessageBase, MessageListResponse, UserOut


router = APIRouter(prefix="/api/messages", tags=["messages"])


@router.get("", response_model=MessageListResponse)
async def list_messages(
    user_id: str = Query(...),
    before: int | None = Query(None),
    limit: int = Query(20, le=100),
    db: AsyncSession = Depends(get_db),
) -> MessageListResponse:
    # 确认用户存在（若已被清库等导致不存在，返回 401 让前端清 token 并跳转登录）
    stmt_user = select(User).where(User.id == user_id)
    res_user = await db.execute(stmt_user)
    if res_user.scalar_one_or_none() is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")

    stmt = select(Message).where(Message.user_id == user_id)
    if before is not None:
        stmt = stmt.where(Message.id < before)
    stmt = stmt.order_by(Message.id.desc()).limit(limit + 1)

    res = await db.execute(stmt)
    rows = res.scalars().all()

    has_more = len(rows) > limit
    rows = rows[:limit]
    rows_sorted = list(reversed(rows))

    messages = [
        MessageBase(
            id=m.id,
            role=m.role,
            content=m.content,
            created_at=m.created_at,
        )
        for m in rows_sorted
    ]
    return MessageListResponse(messages=messages, hasMore=has_more)


@router.delete("/last-user", status_code=status.HTTP_204_NO_CONTENT)
async def delete_last_user_message(
    db: AsyncSession = Depends(get_db),
    current_user: UserOut = Depends(get_current_user),
) -> Response:
    """删除当前用户最近一条用户消息（用于前端「停止生成」时撤销本轮已落库的用户输入）。"""
    stmt = (
        select(Message)
        .where(Message.user_id == current_user.id, Message.role == "user")
        .order_by(Message.created_at.desc())
        .limit(1)
    )
    res = await db.execute(stmt)
    msg = res.scalar_one_or_none()
    if msg is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No user message")
    await db.execute(delete(Message).where(Message.id == msg.id))
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)

