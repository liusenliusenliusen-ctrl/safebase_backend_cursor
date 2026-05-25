#!/usr/bin/env node
/**
 * cron / 手动入口：npm run tasks -- daily [profiles] [anchors]
 */
import {
  generateDailySummaries,
  maintainAnchors,
  updateProfiles,
} from "../src/tasks/index.js";

const TASKS: Record<string, { label: string; run: () => Promise<void> }> = {
  daily: { label: "日摘要", run: generateDailySummaries },
  profiles: { label: "画像更新", run: updateProfiles },
  anchors: { label: "锚点维护", run: maintainAnchors },
};

async function main(): Promise<number> {
  const args = process.argv.slice(2).map((a) => a.trim().toLowerCase()).filter(Boolean);
  if (args.length === 0) {
    console.log("用法: npm run tasks -- <daily|profiles|anchors> [...]");
    console.log("示例: npm run tasks -- daily profiles anchors");
    console.log("cron 示例: scripts/cron.example");
    return 0;
  }

  let code = 0;
  for (const key of args) {
    const task = TASKS[key];
    if (!task) {
      console.error(`未知任务: ${key}`);
      code = 1;
      continue;
    }
    console.log(`执行任务: ${key} (${task.label}) ...`);
    try {
      await task.run();
      console.log(`  完成: ${key}`);
    } catch (e) {
      console.error(`  失败:`, e);
      code = 1;
    }
  }
  return code;
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
