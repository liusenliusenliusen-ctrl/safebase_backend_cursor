#!/usr/bin/env python3
"""
清空用户相关数据，便于调试。
在项目根目录执行：
  python scripts/clear_user_data.py           # 清空所有用户及关联数据（需重新注册）
  python scripts/clear_user_data.py --keep-users   # 只清空对话/摘要/锚点/画像，保留用户账号
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


async def run(keep_users: bool) -> None:
    from sqlalchemy import delete, select
    from app.database import AsyncSessionLocal
    from app.models import Anchor, Message, Profile, Summary, User

    async with AsyncSessionLocal() as db:
        # 按依赖顺序删除（子表先删）
        if keep_users:
            await db.execute(delete(Anchor))
            await db.execute(delete(Summary))
            await db.execute(delete(Message))
            # 重置画像为默认内容
            profiles = (await db.execute(select(Profile))).scalars().all()
            default = "# 核心画像\n尚未生成\n\n## 触发清单\n尚未记录\n\n## 资源库\n尚未记录"
            for p in profiles:
                p.content = default
            await db.commit()
            print("已清空：anchors, summaries, messages；已重置所有 profile。用户账号保留。")
        else:
            await db.execute(delete(Anchor))
            await db.execute(delete(Summary))
            await db.execute(delete(Message))
            await db.execute(delete(Profile))
            await db.execute(delete(User))
            await db.commit()
            print("已清空：anchors, summaries, messages, profiles, users。需重新注册。")


def main() -> None:
    keep_users = "--keep-users" in sys.argv
    asyncio.run(run(keep_users))


if __name__ == "__main__":
    main()
