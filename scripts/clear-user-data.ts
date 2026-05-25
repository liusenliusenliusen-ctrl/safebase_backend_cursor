#!/usr/bin/env node
import { pool, query } from "../src/db.js";

const DEFAULT_PROFILE = `# 核心画像
尚未生成

## 触发清单
尚未记录

## 资源库
尚未记录`;

async function main(): Promise<void> {
  await query("DELETE FROM public.anchors");
  await query("DELETE FROM public.summaries");
  await query("DELETE FROM public.messages");
  await query("DELETE FROM public.diaries");
  await query(`UPDATE public.profiles SET content = $1, updated_at = now()`, [
    DEFAULT_PROFILE,
  ]);
  console.log(
    "已清空：anchors, summaries, messages, diaries；已重置所有 profile。auth.users 未删除。"
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => pool.end());
