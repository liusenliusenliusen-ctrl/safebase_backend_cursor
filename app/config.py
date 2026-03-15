from functools import lru_cache
from pathlib import Path
from typing import Optional

from pydantic import AnyUrl
from pydantic_settings import BaseSettings

# 项目根目录（app 的上一级），.env 固定从该目录加载，与 uvicorn 启动目录无关
_PROJECT_ROOT = Path(__file__).resolve().parent.parent
_ENV_FILE = _PROJECT_ROOT / ".env"


class Settings(BaseSettings):
    # 基础配置
    app_name: str = "CPTSD Healing Companion Backend"
    debug: bool = True

    # 数据库
    database_url: AnyUrl | str = (
        "postgresql+asyncpg://cptsd_user:123456@localhost:5432/cptsd_db"
    )

    # JWT 相关
    jwt_secret_key: str
    jwt_algorithm: str = "HS256"
    access_token_expires_minutes: int = 60 * 24 * 7  # 7 天

    # 管理后台：请求头 X-Admin-Key 需与此一致才可访问 /api/admin/*
    admin_secret: Optional[str] = None

    # OpenRouter（优先）：统一接口切换模型，见 https://openrouter.ai/docs
    openrouter_api_key: Optional[str] = None
    openrouter_base_url: str = "https://openrouter.ai/api/v1"
    openrouter_chat_model: str = "deepseek/deepseek-chat"
    openrouter_embedding_model: str = "openai/text-embedding-3-small"
    openrouter_embedding_dimensions: Optional[int] = 2048  # 与 DB vector(2048) 一致，部分模型支持

    # 火山方舟 / 豆包（可单独用于 embedding，与 OpenRouter 混用：对话 OpenRouter + 向量火山）
    ark_api_key: Optional[str] = None
    ark_base_url: str = "https://ark.cn-beijing.volces.com/api/v3"
    ark_chat_model: str = "ep-XXXXXXXX"
    ark_embedding_model: str = "text-embedding-v2"

    class Config:
        env_file = str(_ENV_FILE)
        env_file_encoding = "utf-8"

    @property
    def use_openrouter(self) -> bool:
        return bool(self.openrouter_api_key and self.openrouter_api_key.strip())


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]

