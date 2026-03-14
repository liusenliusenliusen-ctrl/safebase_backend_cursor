from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from uuid import uuid4

from .database import get_db
from .models import User, Profile
from .schemas import UserCreate, UserOut, Token
from .security import hash_password, verify_password, create_access_token
from .deps import get_current_user


router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/register", response_model=Token)
async def register(data: UserCreate, db: AsyncSession = Depends(get_db)) -> Token:
    stmt = select(User).where(User.username == data.username)
    result = await db.execute(stmt)
    if result.scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Username already exists",
        )

    user = User(
        id=str(uuid4()),
        username=data.username,
        password_hash=hash_password(data.password),
    )
    db.add(user)
    # 创建默认画像
    profile = Profile(user_id=user.id)
    db.add(profile)
    await db.commit()
    await db.refresh(user)

    token_str = create_access_token(subject=str(user.id))
    return Token(
        token=token_str,
        user=UserOut(id=str(user.id), username=user.username, created_at=user.created_at),
    )


@router.post("/login", response_model=Token)
async def login(data: UserCreate, db: AsyncSession = Depends(get_db)) -> Token:
    stmt = select(User).where(User.username == data.username)
    result = await db.execute(stmt)
    user = result.scalar_one_or_none()
    if user is None or not verify_password(data.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Incorrect username or password",
        )
    token_str = create_access_token(subject=str(user.id))
    return Token(
        token=token_str,
        user=UserOut(id=str(user.id), username=user.username, created_at=user.created_at),
    )


@router.get("/me", response_model=UserOut)
async def me(current_user: UserOut = Depends(get_current_user)) -> UserOut:
    return current_user

