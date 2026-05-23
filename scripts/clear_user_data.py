#!/usr/bin/env python3
"""
清空业务数据，便于调试（Supabase：用户账号在 auth.users，本脚本不删 Auth 用户）。
在项目根目录执行：
  python scripts/clear_user_data.py
"""
import asyncio
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)
os.chdir(ROOT)

from dotenv import load_dotenv

load_dotenv()


async def run() -> None:
    from sqlalchemy import delete, select, text

    from app.database import AsyncSessionLocal
    from app.models import Anchor, Message, Profile, Summary

    async with AsyncSessionLocal() as db:
        await db.execute(delete(Anchor))
        await db.execute(delete(Summary))
        await db.execute(delete(Message))
        await db.execute(text("DELETE FROM public.diaries"))
        profiles = (await db.execute(select(Profile))).scalars().all()
        default = "# 核心画像\n尚未生成\n\n## 触发清单\n尚未记录\n\n## 资源库\n尚未记录"
        for p in profiles:
            p.content = default
        await db.commit()
        print(
            "已清空：anchors, summaries, messages, diaries；已重置所有 profile。"
            "auth.users 未删除。"
        )


def main() -> None:
    asyncio.run(run())


if __name__ == "__main__":
    main()
