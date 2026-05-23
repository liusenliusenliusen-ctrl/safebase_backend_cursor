from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel


class UserOut(BaseModel):
    id: str
    username: str
    created_at: datetime


class MessageBase(BaseModel):
    id: int
    role: Literal["user", "assistant"]
    content: str
    created_at: datetime


class AdminUserListItem(BaseModel):
    id: str
    username: str
    created_at: datetime
    message_count: int = 0
    summary_count: int = 0
    anchor_count: int = 0


class AdminUserDetail(BaseModel):
    user: UserOut
    profile_content: Optional[str] = None
    profile_updated_at: Optional[datetime] = None
    message_count: int = 0
    summary_count: int = 0
    anchor_count: int = 0
    recent_messages: list[MessageBase] = []
