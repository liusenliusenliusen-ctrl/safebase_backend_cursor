from datetime import datetime, date
from typing import Literal, Optional

from pydantic import BaseModel, Field


class UserBase(BaseModel):
    id: str
    username: str


class UserCreate(BaseModel):
    username: str = Field(min_length=3, max_length=64)
    password: str = Field(min_length=6, max_length=128)


class UserOut(UserBase):
    created_at: datetime


class Token(BaseModel):
    token: str
    user: UserOut


class TokenPayload(BaseModel):
    sub: str
    exp: int


class MessageBase(BaseModel):
    id: int
    role: Literal["user", "assistant"]
    content: str
    created_at: datetime


class MessageListResponse(BaseModel):
    messages: list[MessageBase]
    hasMore: bool


class ChatRequest(BaseModel):
    user_id: str
    message: str


class ProfileOut(BaseModel):
    content: str
    updated_at: datetime


class SummaryOut(BaseModel):
    id: int
    type: Literal["daily", "weekly", "monthly", "yearly"]
    content: str
    summary_date: date


class AnchorOut(BaseModel):
    id: int
    event_name: str
    initial_thought: Optional[str] = None
    current_thought: Optional[str] = None

