import logging

from fastapi import FastAPI, Request

# 让控制台打出 INFO 日志（如 llm 使用的模型）
logging.basicConfig(
    level=logging.INFO,
    format="%(levelname)s [%(name)s] %(message)s",
)

from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .config import get_settings
from .database import Base, engine
from . import routers_auth, routers_chat, routers_messages, routers_admin


logger = logging.getLogger(__name__)
settings = get_settings()

app = FastAPI(
    title=settings.app_name,
)


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """开发环境下返回 500 的详细错误，便于排查。"""
    logger.exception("Unhandled exception: %s", exc)
    if settings.debug:
        return JSONResponse(
            status_code=500,
            content={
                "detail": str(exc),
                "type": type(exc).__name__,
            },
        )
    return JSONResponse(status_code=500, content={"detail": "Internal Server Error"})

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def on_startup() -> None:
    # 打印当前对话/向量使用的来源，便于确认 .env 是否生效
    has_openrouter = bool(settings.openrouter_api_key and settings.openrouter_api_key.strip())
    has_ark = bool(settings.ark_api_key and settings.ark_api_key.strip())
    if has_openrouter:
        logger.info("chat 使用: OpenRouter model=%s", settings.openrouter_chat_model)
    elif has_ark:
        logger.info("chat 使用: 火山方舟 model=%s", settings.ark_chat_model)
    else:
        logger.warning("chat 未配置: 需设置 OPENROUTER_API_KEY 或 ARK_API_KEY")
    if has_ark:
        logger.info("embedding 使用: 火山方舟 model=%s", settings.ark_embedding_model)
    elif has_openrouter:
        logger.info("embedding 使用: OpenRouter model=%s", settings.openrouter_embedding_model)
    else:
        logger.warning("embedding 未配置: 需设置 ARK_API_KEY 或 OPENROUTER_API_KEY")

    # 简单自动建表，生产可改为 Alembic 迁移
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


app.include_router(routers_auth.router)
app.include_router(routers_messages.router)
app.include_router(routers_chat.router)
app.include_router(routers_admin.router)

