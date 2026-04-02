import json
import logging
from collections.abc import AsyncGenerator
from typing import List

import httpx

from .config import get_settings


logger = logging.getLogger(__name__)
settings = get_settings()


def _raise_auth_error(provider: str) -> None:
    from fastapi import HTTPException
    raise HTTPException(
        status_code=502,
        detail=(
            f"{provider} API 鉴权失败（401）。请检查 .env 中对应 API Key 是否正确。"
        ),
    )


# ---------- Embedding ----------


async def _get_embedding_openrouter(text: str) -> List[float]:
    url = f"{settings.openrouter_base_url}/embeddings"
    headers = {
        "Authorization": f"Bearer {settings.openrouter_api_key}",
        "Content-Type": "application/json",
    }
    payload: dict = {
        "model": settings.openrouter_embedding_model,
        "input": text,
    }
    if getattr(settings, "openrouter_embedding_dimensions", None) is not None:
        payload["dimensions"] = settings.openrouter_embedding_dimensions
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(url, headers=headers, json=payload)
            if resp.status_code == 401:
                _raise_auth_error("OpenRouter")
            resp.raise_for_status()
            data = resp.json()
            return data["data"][0]["embedding"]
    except httpx.HTTPStatusError as e:
        if e.response.status_code == 401:
            _raise_auth_error("OpenRouter")
        raise


async def _get_embedding_ark(text: str) -> List[float]:
    url = f"{settings.ark_base_url}/embeddings/multimodal"
    headers = {
        "Authorization": f"Bearer {settings.ark_api_key}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": settings.ark_embedding_model,
        "input": [{"type": "text", "text": text}],
    }
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(url, headers=headers, json=payload)
            if resp.status_code == 401:
                _raise_auth_error("火山方舟")
            resp.raise_for_status()
            data = resp.json()
            emb = data.get("data", {}).get("embedding", [])
            return emb
    except httpx.HTTPStatusError as e:
        if e.response.status_code == 401:
            _raise_auth_error("火山方舟")
        raise


async def get_embedding(text: str) -> List[float]:
    # 向量：优先火山方舟（若配了 ARK_API_KEY），否则 OpenRouter
    if settings.ark_api_key and settings.ark_api_key.strip():
        logger.info("embedding: 火山方舟 model=%s", settings.ark_embedding_model)
        return await _get_embedding_ark(text)
    if settings.openrouter_api_key and settings.openrouter_api_key.strip():
        logger.info("embedding: OpenRouter model=%s", settings.openrouter_embedding_model)
        return await _get_embedding_openrouter(text)
    from fastapi import HTTPException
    raise HTTPException(
        status_code=502,
        detail="请配置 ARK_API_KEY 或 OPENROUTER_API_KEY 以使用向量接口。",
    )


# ---------- Chat ----------


async def _stream_chat_openrouter(prompt: str) -> AsyncGenerator[str, None]:
    url = f"{settings.openrouter_base_url}/chat/completions"
    headers = {
        "Authorization": f"Bearer {settings.openrouter_api_key}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": settings.openrouter_chat_model,
        "messages": [{"role": "user", "content": prompt}],
        "stream": True,
    }
    try:
        async with httpx.AsyncClient(timeout=90) as client:
            async with client.stream(
                "POST", url, headers=headers, json=payload
            ) as resp:
                if resp.status_code == 401:
                    _raise_auth_error("OpenRouter")
                if resp.status_code >= 400:
                    err_raw = await resp.aread()
                    err_text = err_raw.decode("utf-8", errors="replace")[:4000]
                    logger.error(
                        "OpenRouter chat/completions HTTP %s model=%s body=%s",
                        resp.status_code,
                        settings.openrouter_chat_model,
                        err_text,
                    )
                    from fastapi import HTTPException

                    raise HTTPException(
                        status_code=502,
                        detail=(
                            f"OpenRouter 返回 HTTP {resp.status_code}（模型 {settings.openrouter_chat_model}）。"
                            "请核对 openrouter.ai 控制台中的模型 ID、账户余额与 Key 权限；"
                            f"上游摘要：{err_text[:400]}"
                        ),
                    )
                buffer = ""
                async for chunk in resp.aiter_text():
                    buffer += chunk
                    while "\n" in buffer:
                        line, buffer = buffer.split("\n", 1)
                        line = line.strip()
                        if not line:
                            continue
                        if line == "data: [DONE]":
                            return
                        if not line.startswith("data: "):
                            continue
                        try:
                            data = json.loads(line[6:])
                            delta = data.get("choices", [{}])[0].get("delta", {})
                            content = delta.get("content")
                            if content:
                                yield content
                        except Exception:
                            pass
    except httpx.HTTPStatusError as e:
        if e.response.status_code == 401:
            _raise_auth_error("OpenRouter")
        raise


async def _stream_chat_ark(prompt: str) -> AsyncGenerator[str, None]:
    url = f"{settings.ark_base_url}/chat/completions"
    headers = {
        "Authorization": f"Bearer {settings.ark_api_key}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": settings.ark_chat_model,
        "messages": [{"role": "user", "content": prompt}],
        "stream": False,
    }
    try:
        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(url, headers=headers, json=payload)
            if resp.status_code == 401:
                _raise_auth_error("火山方舟")
            resp.raise_for_status()
            data = resp.json()
            content = data["choices"][0]["message"]["content"]
    except httpx.HTTPStatusError as e:
        if e.response.status_code == 401:
            _raise_auth_error("火山方舟")
        raise

    chunk_size = 60
    for i in range(0, len(content), chunk_size):
        yield content[i : i + chunk_size]


async def stream_chat_completion(prompt: str) -> AsyncGenerator[str, None]:
    # 对话：优先 OpenRouter（若配了 OPENROUTER_API_KEY），否则火山方舟
    if settings.openrouter_api_key and settings.openrouter_api_key.strip():
        logger.info("chat: OpenRouter model=%s", settings.openrouter_chat_model)
        async for chunk in _stream_chat_openrouter(prompt):
            yield chunk
        return
    if settings.ark_api_key and settings.ark_api_key.strip():
        logger.info("chat: 火山方舟 model=%s", settings.ark_chat_model)
        async for chunk in _stream_chat_ark(prompt):
            yield chunk
        return
    from fastapi import HTTPException
    raise HTTPException(
        status_code=502,
        detail="请配置 OPENROUTER_API_KEY 或 ARK_API_KEY 以使用对话接口。",
    )
