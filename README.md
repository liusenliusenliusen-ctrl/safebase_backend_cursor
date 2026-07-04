# 创伤疗愈伴侣 · 后端（Node.js + Postgres）

主站 API、对话 RAG、数据库 Schema、夜间记忆批处理、管理接口。面向**有创伤经历、正在自我疗愈**的群体（范围宽于 CPTSD 诊断标签）。与 [safebase_front_cursor](../safebase_front_cursor)、[safebase_admin_cursor](../safebase_admin_cursor) 共用同一 Postgres。

技术栈：**Node.js 18+ · TypeScript · Fastify · pg · jose · bcryptjs**

## 快速开始

```bash
docker compose up -d
cp .env.example .env   # DATABASE_URL、JWT_SECRET、OPENROUTER_API_KEY、ADMIN_SECRET
npm install
npm run dev            # http://0.0.0.0:8000
npm run build && npm start   # 生产：node dist/src/index.js
```

连接数据库：

```bash
psql "postgresql://postgres:postgres@127.0.0.1:5433/trauma_heal"
# 或 docker exec -it trauma-heal-postgres psql -U postgres -d trauma_heal
```

## HTTP API

| 前缀 | 说明 |
|------|------|
| `/api/health` | 健康检查 |
| `/api/auth/*` | 注册、登录（JWT） |
| `/api/messages` | 对话消息 |
| `/api/chat/stream` | RAG + OpenRouter SSE |
| `/api/diaries` | 日记 CRUD + embedding |
| `/api/account` | 注销账号 |
| `/api/admin/*` | 管理端（`X-Admin-Key`） |

用户数据在 **`public.users`**；Schema 见 `sql/migrations/`。

对话调试：每次 `/api/chat/stream` 在日志输出 `chat stream: model and prompt`（含 `route`、`routeReason`、`model`、`reasoningEnabled`、`userMessage`、`systemPrompt`、`userPrompt`）；生产环境 `pm2 logs safebase-backend`。

## 批处理（cron）

```bash
npm run tasks -- daily
npm run tasks -- profiles anchors
```

见 `scripts/cron.example`。

## 环境变量

`.env` 放在仓库根目录（与 `package.json` 同级）。`npm run dev` 与 PM2 运行 `dist/src/index.js` 均从此处加载。

| 变量 | 说明 |
|------|------|
| `DATABASE_URL` | `postgresql://postgres:postgres@127.0.0.1:5433/trauma_heal`（Docker 宿主机端口 5433） |
| `JWT_SECRET` | JWT 签名（**必填**，否则注册/登录 500） |
| `OPENROUTER_API_KEY` | 对话与 embedding |
| `OPENROUTER_CHAT_MODEL` | 兼容旧配置；路由关闭时等同深度模型 |
| `OPENROUTER_CHAT_ROUTING` | 启用双模型路由，默认 `true` |
| `OPENROUTER_CHAT_MODEL_DEEP` | 深度轮模型，默认 `deepseek/deepseek-r1` |
| `OPENROUTER_CHAT_MODEL_FAST` | 快轨模型，默认 `deepseek/deepseek-chat` |
| `OPENROUTER_CHAT_DEEP_MIN_CHARS` | 触发深度轮的最小字数，默认 `300` |
| `OPENROUTER_CHAT_MAX_TOKENS` | 单轮回复上限，默认 `3072` |
| `OPENROUTER_CHAT_TEMPERATURE` | 采样温度，默认 `0.65` |
| `OPENROUTER_CHAT_REASONING` | 深度轮流式启用 reasoning，默认 `true`（`exclude=true` 思考不可见） |
| `OPENROUTER_CHAT_REASONING_EFFORT` | reasoning 强度，默认 `max` |
| `OPENROUTER_CHAT_TWO_PASS` | 回复前内部分析 pass，默认 `false`（已弃用） |
| `OPENROUTER_CHAT_ANALYSIS_MAX_TOKENS` | 内部分析 token 上限，默认 `1200` |
| `OPENROUTER_CHAT_ANALYSIS_TEMPERATURE` | 内部分析温度，默认 `0.4` |
| `OPENROUTER_EMBEDDING_MODEL` | 建议 `openai/text-embedding-3-large` |
| `ADMIN_SECRET` | 管理后台密钥（请求头 `X-Admin-Key`） |

## 目录

```text
sql/migrations/     数据库 Schema（唯一来源）
src/auth/           JWT、注册登录
src/chat/           RAG、流式对话
src/messages/       消息 API
src/diaries/        日记 API
src/admin/          管理 API
src/tasks/          夜间批处理
prompts/            LLM 模板
docker-compose.yml  Postgres + pgvector
```

## 工具

```bash
npm run clear-data   # 清空业务数据（保留 public.users）
```

详细联调与部署见主站 [docs/DEVELOPMENT.md](../safebase_front_cursor/docs/DEVELOPMENT.md)、[docs/DEPLOYMENT.md](../safebase_front_cursor/docs/DEPLOYMENT.md)。  
数据访问与隐私演进路线见 [docs/SECURITY_EVOLUTION.md](../safebase_front_cursor/docs/SECURITY_EVOLUTION.md)。
