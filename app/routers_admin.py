"""管理后台：需在请求头携带 X-Admin-Key；用户列表来自 auth.users（Supabase Auth）。"""
from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.security import APIKeyHeader
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from .config import get_settings
from .database import get_db
from .models import Message, Profile, Summary, Anchor
from .schemas import (
    AdminUserDetail,
    AdminUserListItem,
    MessageBase,
    UserOut,
)

router = APIRouter(prefix="/api/admin", tags=["admin"])
admin_key_header = APIKeyHeader(name="X-Admin-Key", auto_error=False)


async def require_admin(key: str | None = Depends(admin_key_header)) -> None:
    settings = get_settings()
    secret = settings.admin_secret if settings.admin_secret else ""
    if not secret or key != secret:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing admin key",
        )


@router.get("/users", response_model=list[AdminUserListItem])
async def list_users(
    _: None = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> list[AdminUserListItem]:
    stmt = text(
        """
        SELECT
          u.id::text AS id,
          COALESCE(
            u.raw_user_meta_data->>'username',
            split_part(u.email, '@', 1),
            '用户'
          ) AS username,
          u.created_at AS created_at,
          (SELECT count(*) FROM public.messages m WHERE m.user_id = u.id) AS message_count,
          (SELECT count(*) FROM public.summaries s WHERE s.user_id = u.id) AS summary_count,
          (SELECT count(*) FROM public.anchors a WHERE a.user_id = u.id) AS anchor_count
        FROM auth.users u
        ORDER BY u.created_at DESC
        """
    )
    res = await db.execute(stmt)
    rows = res.fetchall()
    return [
        AdminUserListItem(
            id=r.id,
            username=r.username,
            created_at=r.created_at,
            message_count=int(r.message_count or 0),
            summary_count=int(r.summary_count or 0),
            anchor_count=int(r.anchor_count or 0),
        )
        for r in rows
    ]


@router.get("/users/{user_id}", response_model=AdminUserDetail)
async def get_user_detail(
    user_id: str,
    messages_limit: int = Query(50, le=200),
    _: None = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> AdminUserDetail:
    stmt_user = text(
        """
        SELECT
          u.id::text AS id,
          COALESCE(
            u.raw_user_meta_data->>'username',
            split_part(u.email, '@', 1),
            '用户'
          ) AS username,
          u.created_at AS created_at
        FROM auth.users u
        WHERE u.id = :uid
        """
    )
    res_user = await db.execute(stmt_user, {"uid": user_id})
    user_row = res_user.fetchone()
    if user_row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    stmt_profile = select(Profile).where(Profile.user_id == user_id)
    res_profile = await db.execute(stmt_profile)
    profile = res_profile.scalar_one_or_none()

    msg_count = await db.scalar(
        select(func.count(Message.id)).where(Message.user_id == user_id)
    )
    summary_count = await db.scalar(
        select(func.count(Summary.id)).where(Summary.user_id == user_id)
    )
    anchor_count = await db.scalar(
        select(func.count(Anchor.id)).where(Anchor.user_id == user_id)
    )

    stmt_messages = (
        select(Message)
        .where(Message.user_id == user_id)
        .order_by(Message.id.desc())
        .limit(messages_limit)
    )
    res_messages = await db.execute(stmt_messages)
    messages = list(res_messages.scalars().all())
    recent = [
        MessageBase(id=m.id, role=m.role, content=m.content, created_at=m.created_at)
        for m in reversed(messages)
    ]

    return AdminUserDetail(
        user=UserOut(
            id=user_row.id,
            username=user_row.username,
            created_at=user_row.created_at,
        ),
        profile_content=profile.content if profile else None,
        profile_updated_at=profile.updated_at if profile else None,
        message_count=msg_count or 0,
        summary_count=summary_count or 0,
        anchor_count=anchor_count or 0,
        recent_messages=recent,
    )
