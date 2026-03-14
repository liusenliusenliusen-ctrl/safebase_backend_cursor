#!/usr/bin/env python3
"""
同步执行定时任务，便于本地调试（不经过 Redis/Worker，当前进程直接跑）。
在项目根目录执行：
  python scripts/run_task_sync.py                    # 列出任务
  python scripts/run_task_sync.py daily              # 执行日摘要
  python scripts/run_task_sync.py profiles           # 执行画像更新
  python scripts/run_task_sync.py anchors            # 执行锚点维护
  python scripts/run_task_sync.py daily profiles anchors  # 执行多个
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)
os.chdir(ROOT)

from dotenv import load_dotenv
load_dotenv()


def main() -> None:
    args = [a.strip().lower() for a in sys.argv[1:] if a.strip()]
    if not args:
        print("用法: python scripts/run_task_sync.py <任务名> [任务名 ...]")
        print("任务名: daily | profiles | anchors")
        print("示例: python scripts/run_task_sync.py profiles anchors")
        return

    from app.tasks import (
        generate_daily_summaries,
        update_profiles,
        maintain_anchors,
    )
    name_to_task = {
        "daily": generate_daily_summaries,
        "profiles": update_profiles,
        "anchors": maintain_anchors,
    }

    for key in args:
        if key not in name_to_task:
            print(f"未知任务: {key}，已忽略")
            continue
        task = name_to_task[key]
        print(f"执行任务: {key} ({task.name}) ...")
        try:
            # 同步执行（当前进程阻塞，不经过 Redis/Worker）
            result = task.apply()
            print(f"  完成: {result}")
        except Exception as e:
            print(f"  失败: {e}")
            import traceback
            traceback.print_exc()


if __name__ == "__main__":
    main()
