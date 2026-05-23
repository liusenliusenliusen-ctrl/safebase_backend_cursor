import logging

from fastapi import FastAPI, Request

logging.basicConfig(
    level=logging.INFO,
    format="%(levelname)s [%(name)s] %(message)s",
)

from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .config import get_settings
from . import routers_admin


logger = logging.getLogger(__name__)
settings = get_settings()

app = FastAPI(
    title=settings.app_name,
)


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception) -> JSONResponse:
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
    has_openrouter = bool(settings.openrouter_api_key and settings.openrouter_api_key.strip())
    if has_openrouter:
        logger.info(
            "LLM 使用 OpenRouter chat=%s embedding=%s",
            settings.openrouter_chat_model,
            settings.openrouter_embedding_model,
        )
    else:
        logger.warning("未配置 OPENROUTER_API_KEY：Celery 向量/摘要任务将不可用。")
    logger.info(
        "HTTP 仅暴露 /api/admin/*；主站对话与认证已迁移至 Supabase（Edge stream-chat + Auth）。"
    )


app.include_router(routers_admin.router)
