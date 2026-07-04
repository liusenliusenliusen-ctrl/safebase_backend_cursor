export const DEFAULT_PROFILE_CONTENT = `# 核心画像
尚未生成

## 触发清单
尚未记录

## 资源库
尚未记录`;

export function usernameToEmail(username: string): string {
  const slug = username
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const safe = slug || "user";
  return `${safe}@trauma-heal.internal`;
}
