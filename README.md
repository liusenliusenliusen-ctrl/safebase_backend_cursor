# CPTSD 疗愈伴侣后端（FastAPI）

本项目是「CPTSD 疗愈伴侣」应用的后端服务，实现：

- **用户认证**：注册 / 登录 / 获取当前用户
- **智能对话**：`/api/chat` 支持流式返回（SSE）
- **长期记忆**：对话消息、画像、分层摘要、事件锚点
- **RAG 检索**：基于 pgvector 的向量检索（摘要 & 锚点）
- **定时任务**：基于 Celery 的摘要、画像与锚点维护任务

## 技术栈

- **后端框架**：FastAPI
- **数据库**：PostgreSQL + pgvector
- **ORM**：SQLAlchemy 2.x（异步）
- **向量 & 大模型**：支持 **OpenRouter**（推荐，可切换多种模型）或 **火山方舟**
- **任务队列**：Celery + Redis

## 本地运行步骤

1. 安装依赖：

```bash
pip install -r requirements.txt
```

2. 配置环境变量（可使用 `.env` 文件）：

- `DATABASE_URL`：例如 `postgresql+asyncpg://user:pass@localhost:5432/cptsd`
- `JWT_SECRET_KEY`、`JWT_ALGORITHM`

**大模型与向量（二选一）：**

- **方式一：OpenRouter**（推荐，[openrouter.ai](https://openrouter.ai) 统一接口，可切换多种模型）
  - `OPENROUTER_API_KEY`：在 OpenRouter 控制台获取
  - `OPENROUTER_CHAT_MODEL`：对话模型，如 `openai/gpt-4o-mini`、`anthropic/claude-3.5-haiku`
  - `OPENROUTER_EMBEDDING_MODEL`：向量模型，如 `openai/text-embedding-3-small`
  - `OPENROUTER_EMBEDDING_DIMENSIONS`：可选，与 DB 向量维度一致时填写（如 `2048`），部分模型支持
- **方式二：火山方舟**
  - `ARK_API_KEY`、`ARK_CHAT_MODEL`、`ARK_EMBEDDING_MODEL`（未设置 OpenRouter 时生效）

3. 运行数据库迁移 / 初始化表（可直接执行 `app/models.py` 中的元数据创建或使用 Alembic）。

4. 启动应用：

```bash
uvicorn app.main:app --reload
```

5. 启动 Celery（可选，用于定时任务）：

```bash
celery -A app.tasks.app worker -B
```

> 具体配置与使用方式请参考代码中的注释和配置文件。

