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


class AccountDeleteRequest(BaseModel):
    """注销账号时需再次验证密码，防止误触与盗用 token。"""

    password: str = Field(min_length=6, max_length=128)


class PromptDebugRequest(ChatRequest):
    # 是否返回构成 prompt 的各个片段（会包含用户内容，注意隐私）
    include_components: bool = False
    # 是否强制从模板文件重新加载（通常需配合 PROMPT_TEMPLATE_DIR）
    reload_templates: bool = False


class PromptDebugResponse(BaseModel):
    template_name: str
    prompt: str
    # 可选：返回 profile/摘要/锚点等变量值，便于你对照调试
    components: Optional[dict[str, str]] = None


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


# ---------- 管理后台 ----------
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

