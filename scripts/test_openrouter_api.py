#!/usr/bin/env python3
"""
测试 OpenRouter 的 embeddings 与 chat/completions（与 app/llm.py 行为一致）。
项目根目录：python scripts/test_openrouter_api.py
"""
import os
import sys

from typing import Optional

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)
os.chdir(ROOT)

from dotenv import load_dotenv
import httpx

load_dotenv()

KEY = os.getenv("OPENROUTER_API_KEY")
BASE = os.getenv("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1").rstrip("/")
EMB_MODEL = os.getenv("OPENROUTER_EMBEDDING_MODEL", "openai/text-embedding-3-small")
CHAT_MODEL = os.getenv("OPENROUTER_CHAT_MODEL", "deepseek/deepseek-chat")
DIMS_RAW = os.getenv("OPENROUTER_EMBEDDING_DIMENSIONS", "2048")
DIMS: Optional[int]
try:
    DIMS = int(DIMS_RAW) if DIMS_RAW.strip() else None
except ValueError:
    DIMS = None


def test_embeddings() -> None:
    print("【1】测试 embeddings...")
    if not KEY:
        print("  失败: 未设置 OPENROUTER_API_KEY\n")
        return
    url = f"{BASE}/embeddings"
    headers = {
        "Authorization": f"Bearer {KEY}",
        "Content-Type": "application/json",
    }
    payload: dict = {"model": EMB_MODEL, "input": "天很蓝，海很深"}
    if DIMS is not None:
        payload["dimensions"] = DIMS
    try:
        with httpx.Client(timeout=60) as client:
            resp = client.post(url, headers=headers, json=payload)
        if resp.status_code == 401:
            print("  失败: 401，请检查 OPENROUTER_API_KEY\n")
            return
        resp.raise_for_status()
        data = resp.json()
        emb = data["data"][0]["embedding"]
        print(f"  成功: 向量维度 = {len(emb)}\n")
    except httpx.HTTPStatusError as e:
        msg = e.response.text[:400] if e.response.text else str(e)
        print(f"  失败: HTTP {e.response.status_code} - {msg}\n")
    except Exception as e:
        print(f"  失败: {e}\n")


def test_chat() -> None:
    print("【2】测试 chat/completions（非流式）...")
    if not KEY:
        print("  失败: 未设置 OPENROUTER_API_KEY\n")
        return
    url = f"{BASE}/chat/completions"
    headers = {
        "Authorization": f"Bearer {KEY}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": CHAT_MODEL,
        "messages": [{"role": "user", "content": "请用一句话介绍你自己。"}],
        "stream": False,
    }
    try:
        with httpx.Client(timeout=90) as client:
            resp = client.post(url, headers=headers, json=payload)
        if resp.status_code == 401:
            print("  失败: 401，请检查 OPENROUTER_API_KEY\n")
            return
        resp.raise_for_status()
        data = resp.json()
        content = data.get("choices", [{}])[0].get("message", {}).get("content", "")
        print(f"  成功: 回复 = {content[:150]}{'...' if len(content) > 150 else ''}\n")
    except httpx.HTTPStatusError as e:
        print(f"  失败: HTTP {e.response.status_code} - {e.response.text[:200]}\n")
    except Exception as e:
        print(f"  失败: {e}\n")


def main() -> None:
    print("使用配置:")
    print(f"  OPENROUTER_BASE_URL = {BASE}")
    print(f"  OPENROUTER_EMBEDDING_MODEL = {EMB_MODEL}")
    print(f"  OPENROUTER_CHAT_MODEL = {CHAT_MODEL}")
    print(f"  OPENROUTER_EMBEDDING_DIMENSIONS = {DIMS}")
    print(f"  OPENROUTER_API_KEY = {'已设置' if KEY else '未设置'}\n")
    test_embeddings()
    test_chat()


if __name__ == "__main__":
    main()
