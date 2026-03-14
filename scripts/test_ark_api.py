#!/usr/bin/env python3
"""
测试火山方舟「文本向量」与「对话」接口。
在项目根目录执行：python scripts/test_ark_api.py
或：cd scripts && python test_ark_api.py（需确保 .env 在上级目录）
"""
import os
import sys

# 确保能加载项目根目录的 .env
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)
os.chdir(ROOT)

from dotenv import load_dotenv
import httpx

load_dotenv()

ARK_API_KEY = os.getenv("ARK_API_KEY")
ARK_BASE_URL = os.getenv("ARK_BASE_URL", "https://ark.cn-beijing.volces.com/api/v3")
ARK_EMBEDDING_MODEL = os.getenv("ARK_EMBEDDING_MODEL", "text-embedding-v2")
ARK_CHAT_MODEL = os.getenv("ARK_CHAT_MODEL", "ep-XXXXXXXX")


def test_embeddings() -> None:
    """测试文本向量接口"""
    print("【1】测试文本向量 (embeddings)...")
    if not ARK_API_KEY:
        print("  失败: 未设置 ARK_API_KEY（请在 .env 中配置）\n")
        return
    url = f"{ARK_BASE_URL}/embeddings/multimodal"
    headers = {
        "Authorization": f"Bearer {ARK_API_KEY}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": ARK_EMBEDDING_MODEL,
        "input": [
        {
            "type":"text",
            "text":"天很蓝，海很深"
        }
      ]
    }
    try:
        with httpx.Client(timeout=30) as client:
            resp = client.post(url, headers=headers, json=payload)
        if resp.status_code == 401:
            print("  失败: 401 鉴权失败，请检查 ARK_API_KEY 是否有效及是否开通向量模型权限。\n")
            return
        resp.raise_for_status()
        data = resp.json()
        emb = data.get("data", [{}]).get("embedding", [])
        print(f"  成功: 向量维度 = {len(emb)}\n")
    except httpx.HTTPStatusError as e:
        msg = e.response.text[:300] if e.response.text else str(e)
        print(f"  失败: HTTP {e.response.status_code} - {msg}\n")
        if e.response.status_code == 400 and "vision" in msg.lower():
            print("  提示: 当前接入点是「视觉向量」模型，不支持文本 /embeddings 接口。")
            print("  请在火山方舟控制台创建「文本向量」模型接入点（如 doubao-embedding-text-*），")
            print("  并将 ARK_EMBEDDING_MODEL 改为该接入点 ID。\n")
    except Exception as e:
        print(f"  失败: {e}\n")
        print(data)


def test_chat() -> None:
    """测试对话接口"""
    print("【2】测试对话 (chat/completions)...")
    if not ARK_API_KEY:
        print("  失败: 未设置 ARK_API_KEY（请在 .env 中配置）\n")
        return
    url = f"{ARK_BASE_URL}/chat/completions"
    headers = {
        "Authorization": f"Bearer {ARK_API_KEY}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": ARK_CHAT_MODEL,
        "messages": [{"role": "user", "content": "请用一句话介绍你自己。"}],
        "stream": False,
    }
    try:
        with httpx.Client(timeout=60) as client:
            resp = client.post(url, headers=headers, json=payload)
        if resp.status_code == 401:
            print("  失败: 401 鉴权失败，请检查 ARK_API_KEY 是否有效及是否开通对话模型权限。\n")
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
    print(f"  ARK_BASE_URL = {ARK_BASE_URL}")
    print(f"  ARK_EMBEDDING_MODEL = {ARK_EMBEDDING_MODEL}")
    print(f"  ARK_CHAT_MODEL = {ARK_CHAT_MODEL}")
    print(f"  ARK_API_KEY = {'已设置' if ARK_API_KEY else '未设置'}\n")
    test_embeddings()
    test_chat()


if __name__ == "__main__":
    main()
