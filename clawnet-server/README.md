# ClawNet Server

ClawNet 后端服务，基于 FastAPI 构建，提供用户认证、会话管理、AI Agent 对话、Gateway 容器编排、WebSocket 实时通信、标签隔离与文件管理等功能。

## 技术栈

- **框架**: FastAPI + Uvicorn
- **语言**: Python 3.12
- **数据库**: PostgreSQL 16 (asyncpg)
- **缓存**: Redis 7
- **ORM**: SQLAlchemy 2.0 (async)
- **认证**: JWT (python-jose)
- **部署**: Docker Compose

## 项目结构

```
clawnet-server/
├── src/
│   ├── api/                    # 路由层 (16 个模块)
│   │   ├── auth.py             # 认证 (注册/登录/刷新/Gateway token)
│   │   ├── users.py            # 用户管理、联系人、好友请求、文件访问设置
│   │   ├── conversations.py    # 会话管理
│   │   ├── messages.py         # 消息收发 (含流式响应)
│   │   ├── agents.py           # Agent 管理、session key
│   │   ├── agent_dialogs.py    # Agent 多轮对话
│   │   ├── tasks.py            # 任务管理
│   │   ├── files.py            # 文件上传/下载 (支持分块)
│   │   ├── tags.py             # 标签管理
│   │   ├── search.py           # 搜索
│   │   ├── discovery.py        # 发现任务
│   │   ├── audit.py            # 审计日志
│   │   ├── admin.py            # Admin 用户管理、容器编排
│   │   ├── gateway_proxy.py    # Gateway 代理
│   │   ├── internal.py         # 内部 API (Agent 消息发送)
│   │   └── websocket.py        # WebSocket 端点
│   ├── models/                 # SQLAlchemy 数据模型 (14 张表)
│   ├── schemas/                # Pydantic 请求/响应模型
│   ├── services/               # 业务逻辑层 (20+ 模块)
│   │   ├── auth_service.py     # 认证服务
│   │   ├── agent_service.py    # Agent 生命周期
│   │   ├── agent_dialog_service.py  # Agent 对话会话
│   │   ├── llm_service.py      # LLM 调用 (Claude / OpenAI)
│   │   ├── openclaw_service.py # Gateway 连接池、代理节点注册
│   │   ├── provision_service.py # 用户容器编排 (端口分配/Docker 生命周期)
│   │   ├── tag_service.py      # 标签服务
│   │   ├── intent_parser.py    # 意图解析
│   │   └── ...
│   ├── tasks/                  # 后台任务 (会话清理)
│   ├── utils/                  # 工具函数 (安全/错误处理)
│   ├── websocket/              # WebSocket 连接管理
│   ├── config.py               # 应用配置 + Gateway 映射缓存
│   ├── database.py             # 数据库连接
│   ├── dependencies.py         # 依赖注入 (JWT/权限)
│   └── main.py                 # 应用入口
├── migrations/                 # SQL 迁移脚本 (17 个, 编号 001–016)
├── scripts/
│   └── seed-admin.sh           # 创建 Admin 用户
├── docker-compose.yml
├── Dockerfile
├── clawnet.sh                  # 管理脚本
└── .env.example                # 环境变量模板
```

## 快速开始

### 前置条件

- Docker & Docker Compose
- (可选) Python 3.12+ (本地开发)

### 1. 初始化配置

```bash
cp .env.example .env.v1
# 编辑配置（数据库密码、JWT 密钥、LLM API Key 等）
vim .env.v1
```

### 2. 启动服务

```bash
# 首次部署（构建镜像 + 启动 + 数据库迁移）
./clawnet.sh setup v1
```

### 3. 创建 Admin 用户

```bash
./scripts/seed-admin.sh admin "Admin" "your-password" v1
```

### 管理命令

```bash
./clawnet.sh init    [env]   # 从 .env.example 生成 .env 文件
./clawnet.sh setup   [env]   # 首次初始化（构建 + 启动 + 迁移）
./clawnet.sh rebuild [env]   # 重建容器 + 迁移
./clawnet.sh logs    [env]   # 查看后端日志
./clawnet.sh shell   [env]   # 进入后端容器
./clawnet.sh psql    [env]   # 进入 PostgreSQL 终端
./clawnet.sh status  [env]   # 查看容器状态
./clawnet.sh clean   [env]   # 停止并删除容器和数据卷
```

## 核心功能

### Gateway 容器编排

Server 负责为每个用户自动 provision 独立的 Gateway 容器：

- 端口自动分配（v1 环境：20001-20999）
- Workspace 自动创建与模板渲染
- Docker 容器生命周期管理（启动/重启/停止/删除）
- Gateway 连接池 + 用户/Agent 映射缓存

### 标签系统 (Tags)

- 为用户创建标签（如「工作」「生活」），隔离不同助手的文件访问范围
- 标签与 Agent 绑定，实现身份隔离

### Agent 对话

- 多轮对话会话管理，支持断线重连
- 流式响应（stream_start → stream_delta → stream_end）
- 消息缓冲与超时控制
- 意图检测与解析

### WebSocket 实时通信

- 用户/Agent 多连接管理
- 代理节点注册与命令转发
- 心跳机制保活

## 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `CLAWNET_ENV` | 环境标识 | `v1` |
| `BACKEND_PORT` | 后端服务端口 | `9000` |
| `POSTGRES_PORT` | PostgreSQL 端口 | `5432` |
| `REDIS_PORT` | Redis 端口 | `6379` |
| `DATABASE_URL` | PostgreSQL 连接串 | 从上述参数自动生成 |
| `REDIS_URL` | Redis 连接串 | `redis://localhost:6379/0` |
| `JWT_SECRET_KEY` | JWT 签名密钥 (**生产环境必须修改**) | `clawnet-secret-key-...` |
| `INTERNAL_API_KEY` | 内部 API 密钥 (**生产环境必须修改**) | `clawnet-internal-key-...` |
| `ANTHROPIC_API_KEY` | Anthropic API Key | - |
| `OPENAI_API_KEY` | OpenAI API Key | - |
| `OPENCLAW_CLIENT_ID` | Gateway 客户端 ID | `openclaw-control-ui` |
| `GATEWAY_ENV` | Gateway 环境版本 | `v1` |
| `OPENCLAW_IMAGE_PATTERN` | Gateway 镜像名模式 | `openclaw-{env}:local` |
| `WORKSPACES_ROOT` | workspaces 目录的**绝对路径**（指向项目下的 `workspaces/`） | - |
| `SERVER_EXTERNAL_URL` | Gateway 回连 Server 的公网地址（如 `http://1.2.3.4:9000`） | - |
| `CORS_ORIGINS` | 允许的跨域来源 | `["*"]` |
| `DEBUG` | 调试模式 | `true` |

完整配置项参见 [.env.example](.env.example)。

## API 文档

服务启动后可访问自动生成的 API 文档：

- Swagger UI: `http://localhost:{BACKEND_PORT}/docs`
- ReDoc: `http://localhost:{BACKEND_PORT}/redoc`

### 健康检查

```bash
curl http://localhost:9000/health   # 存活检查（含 Gateway 连接池状态）
curl http://localhost:9000/ready    # 就绪检查
```

## 数据库迁移

迁移脚本位于 `migrations/` 目录（共 17 个文件，编号 001–016），按编号顺序执行。首次启动时 `001_initial.sql` 由 PostgreSQL 容器自动执行，后续迁移通过 `clawnet.sh` 管理：

```bash
./clawnet.sh setup v1    # setup 会自动执行所有未应用的迁移
```

## License

[Apache-2.0](LICENSE)
