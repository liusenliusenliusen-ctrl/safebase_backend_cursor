from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from .database import get_db
from .deps import get_current_user
from .models import DiaryEntry
from .schemas import DiaryCreate, DiaryListResponse, DiaryOut, DiaryUpdate, UserOut

router = APIRouter(prefix="/api/diary", tags=["diary"])


def _ilike_pattern(term: str) -> str:
    """转义 LIKE 通配符，避免用户输入 % / _ 破坏匹配。"""
    escaped = term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


@router.get("", response_model=DiaryListResponse)
async def list_diaries(
    q: str | None = Query(None, description="在标题与正文中搜索，不区分大小写"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    current_user: UserOut = Depends(get_current_user),
) -> DiaryListResponse:
    base_filter = DiaryEntry.user_id == current_user.id
    search = q.strip() if q else ""

    if search:
        pat = _ilike_pattern(search)
        filter_expr = base_filter & (
            or_(
                DiaryEntry.title.ilike(pat, escape="\\"),
                DiaryEntry.content.ilike(pat, escape="\\"),
            )
        )
    else:
        filter_expr = base_filter

    count_stmt = select(func.count(DiaryEntry.id)).where(filter_expr)
    total = int((await db.execute(count_stmt)).scalar_one())

    offset = (page - 1) * page_size
    list_stmt = (
        select(DiaryEntry)
        .where(filter_expr)
        .order_by(DiaryEntry.updated_at.desc())
        .offset(offset)
        .limit(page_size)
    )
    res = await db.execute(list_stmt)
    rows = res.scalars().all()

    items = [
        DiaryOut(
            id=r.id,
            title=r.title or "",
            content=r.content,
            created_at=r.created_at,
            updated_at=r.updated_at,
        )
        for r in rows
    ]
    return DiaryListResponse(
        items=items,
        total=total,
        page=page,
        page_size=page_size,
    )


@router.post("", response_model=DiaryOut, status_code=status.HTTP_201_CREATED)
async def create_diary(
    body: DiaryCreate,
    db: AsyncSession = Depends(get_db),
    current_user: UserOut = Depends(get_current_user),
) -> DiaryOut:
    row = DiaryEntry(
        user_id=current_user.id,
        title=body.title.strip() if body.title else "",
        content=body.content,
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return DiaryOut(
        id=row.id,
        title=row.title or "",
        content=row.content,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


@router.get("/{entry_id}", response_model=DiaryOut)
async def get_diary(
    entry_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: UserOut = Depends(get_current_user),
) -> DiaryOut:
    stmt = select(DiaryEntry).where(
        DiaryEntry.id == entry_id,
        DiaryEntry.user_id == current_user.id,
    )
    res = await db.execute(stmt)
    row = res.scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Diary not found")
    return DiaryOut(
        id=row.id,
        title=row.title or "",
        content=row.content,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


@router.patch("/{entry_id}", response_model=DiaryOut)
async def update_diary(
    entry_id: int,
    body: DiaryUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: UserOut = Depends(get_current_user),
) -> DiaryOut:
    stmt = select(DiaryEntry).where(
        DiaryEntry.id == entry_id,
        DiaryEntry.user_id == current_user.id,
    )
    res = await db.execute(stmt)
    row = res.scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Diary not found")

    if body.title is not None:
        row.title = body.title.strip()
    if body.content is not None:
        row.content = body.content

    await db.commit()
    await db.refresh(row)
    return DiaryOut(
        id=row.id,
        title=row.title or "",
        content=row.content,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


@router.delete("/{entry_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_diary(
    entry_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: UserOut = Depends(get_current_user),
) -> Response:
    stmt = delete(DiaryEntry).where(
        DiaryEntry.id == entry_id,
        DiaryEntry.user_id == current_user.id,
    )
    res = await db.execute(stmt)
    if res.rowcount == 0:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Diary not found")
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
