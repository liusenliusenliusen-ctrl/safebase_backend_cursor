#!/usr/bin/env python3
"""
检查 .env 是否被正确加载（不依赖当前工作目录）。
在任意目录执行：python scripts/check_env.py  或  python /path/to/safebase_backend_cursor/scripts/check_env.py
"""
import os
import sys

# 项目根目录 = 本脚本所在目录的上一级
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENV_PATH = os.path.join(ROOT, ".env")

print("项目根目录:", ROOT)
print(".env 路径:", ENV_PATH)
print(".env 存在:", os.path.isfile(ENV_PATH))

from dotenv import load_dotenv
load_dotenv(ENV_PATH)

v = os.getenv("OPENROUTER_API_KEY")
print("OPENROUTER_API_KEY 存在:", bool(v))
if v:
    print("前 12 字符:", repr(v[:12]) + "...")
else:
    print("请确认 .env 中有一行: OPENROUTER_API_KEY=sk-or-v1-...")
    sys.exit(1)
