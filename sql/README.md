# 数据库 Schema

由 `docker compose up` 首次启动时自动执行本目录下 SQL（按文件名排序）。

当前版本：
- `001_initial.sql` — Postgres 16 + pgvector，含 `public.users`、对话/日记/记忆表及 RAG RPC（含 `diaries.entry_date`）
- `003_diary_entry_date.sql` — 已有库升级：日记按自然日唯一归档，并更新 `match_diaries`

**新增迁移：** 添加 `00x_xxx.sql`；对已存在库需手动 `psql` 执行，或 `docker compose down -v` 重建（会清空数据）。

```bash
# 已有库应用日记按日归档
PGPASSWORD=postgres psql -h 127.0.0.1 -p 5433 -U postgres -d trauma_heal \
  -f sql/migrations/003_diary_entry_date.sql
```

**库名变更（safebase → trauma_heal）：** 保留旧 volume 时执行 `002_rename_database_safebase_to_trauma_heal.sql` 中的 `ALTER DATABASE`；全新安装使用 `POSTGRES_DB=trauma_heal` 即可。
