# 数据库 Schema

由 `docker compose up` 首次启动时自动执行本目录下 SQL（按文件名排序）。

当前版本：`001_initial.sql` — Postgres 16 + pgvector，含 `public.users`、对话/日记/记忆表及 RAG RPC。

**新增迁移：** 添加 `002_xxx.sql`；对已存在库需手动 `psql` 执行，或 `docker compose down -v` 重建（会清空数据）。
