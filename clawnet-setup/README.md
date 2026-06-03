# ClawNet v1.0 部署指南

## 项目结构

各组件均为 **ClawNet 仓库**下的子目录，下文的 `cd clawnet-xxx` / `cd ../clawnet-xxx` 命令基于此布局：

```
ClawNet/                      # 仓库根 (README / USER_GUIDE / LICENSE / assets)
├── clawnet-server/           # 后端服务 (FastAPI + PostgreSQL + Redis)
├── clawnet-core/             # ClawNet Gateway 源码 (Based on OpenClaw)
├── clawnet-macosapp/         # 原生 macOS 客户端 (Swift)
├── clawnet-desktop/          # 跨平台桌面客户端 (Electron: Win/macOS/Linux)
└── clawnet-setup/            # 部署工具 + Admin CLI
    ├── admin.sh              # Admin CLI 管理工具
    ├── multi-run.sh          # 构建 Gateway 镜像
    └── workspaces/           # 用户 workspace 目录 (WORKSPACES_ROOT 指向此处)
        └── ws-0-template/    # workspace 模板
```

## 前置条件

- Docker + Docker Compose
- Node.js 22+
- Python 3.12+
- `curl`, `jq` (admin.sh 依赖)

## 一、启动后端服务

```bash
cd clawnet-server

# 首次部署：构建镜像 + 启动 + 执行全部 migrations
./clawnet.sh setup v1

# 后续重启（不重建镜像）
./clawnet.sh rebuild v1
```

启动后会运行以下容器：

| 容器 | 端口 | 说明 |
|------|------|------|
| `clawnet-v1-postgres` | 5432 | PostgreSQL 16 |
| `clawnet-v1-redis` | 6379 | Redis 7 |
| `clawnet-v1-backend` | 9000 | FastAPI 后端 |

验证：

```bash
./clawnet.sh status v1
curl http://localhost:9000/health
```

## 二、构建 ClawNet Gateway 镜像

后端的 provision 服务需要一个预构建好的 Gateway 镜像。镜像名格式为 `openclaw-{env}:local`。

首次构建：

```bash
cd clawnet-setup
./multi-run.sh setup
```

## 三、配置 API Key 与客户端服务器地址

**LLM API Key（必须）：** 替换以下两个文件中的 `"apiKey": "xxx"`：

- `workspaces/ws-0-template/config/openclaw.json`
- `workspaces/ws-0-template/config/agents/main/agent/models.json`

**macOS 客户端服务器地址：** 在 `~/Downloads/` 创建 `server-config.json`，指向后端服务的公网 IP：

```json
{
    "serverURL": "http://<你的公网IP>:9000"
}
```

或直接修改 `clawnet-macosapp/ClawNet/ServerConfig.swift` 中的默认值。

**Server 回连地址（必须）：** 在 `clawnet-server/.env.v1` 中设置 `SERVER_EXTERNAL_URL`，Gateway 容器通过此地址回连 Server（用于 blob proxy 等回调）：

```bash
SERVER_EXTERNAL_URL=http://<你的公网IP>:9000
```

**Workspaces 路径（必须）：** 在 `clawnet-server/.env.v1` 中设置 `WORKSPACES_ROOT`，必须为**绝对路径**，指向项目下的 `workspaces/` 目录：

```bash
WORKSPACES_ROOT=/absolute/path/to/clawnet-setup/workspaces
```

## 四、创建 Admin 用户

```bash
cd clawnet-server
./scripts/seed-admin.sh admin "Admin" "admin123." v1
```

该脚本直接在 DB 中创建 `role=admin` 的用户。Admin 用户不需要 Gateway 容器。

## 五、使用 Admin CLI 管理用户

```bash
cd clawnet-setup/

# 1. 登录（token 缓存到 ~/.clawnet-admin-token，有效期 1 小时）
./admin.sh login

# 2. 创建用户（自动 provision Gateway 容器）
./admin.sh user create sara@example.com "Sara" "password123"
./admin.sh --env v1 user create sara@example.com "Sara" "password123"
#   → 自动分配端口 (20001, 20002, ...)
#   → 自动创建 workspace (workspaces/ws-v1-sara-20001/)
#   → 自动渲染 openclaw.json 注入 gateway token
#   → 自动启动 Docker 容器 (oc-v1-sara-20001)
#   → 轮询直到容器 healthy

# 3. 查看所有用户
./admin.sh user list

# 4. 查看容器状态
./admin.sh status

# 5. 查看单个用户详情
./admin.sh user get sara@example.com

# 6. 重启用户容器
./admin.sh user restart sara@example.com

# 7. 停止容器（需要输入 admin 密码确认）
./admin.sh user stop sara@example.com

# 8. 删除用户（停容器 + 删 workspace + 删 DB 记录，需密码确认）
./admin.sh user delete sara@example.com
```

指定环境：

```bash
./admin.sh --env prod user list
./admin.sh --env v1 user create ...
```

## 六、用户自助注册

```
当前版本暂不开放
```

## 七、容器命名规则

| 资源 | 格式 | 示例 |
|------|------|------|
| Gateway 容器 | `oc-{env}-{slug}-{port}` | `oc-v1-sara-20001` |
| Workspace 目录 | `ws-{env}-{slug}-{port}` | `ws-v1-sara-20001` |
| 后端容器 | `clawnet-{project}-backend` | `clawnet-v1-backend` |

- `slug` 从 email 前缀自动生成
- `port` 由 DB 自增分配，保证唯一性

端口范围：

| 环境 | 端口段 |
|------|--------|
| v1 | 20001 - 20999 |

## 八、修改 clawnet-core 后更新

修改 `clawnet-core/` 代码后，一条命令重建镜像并滚动重启所有用户容器：

```bash
# 仅重启容器（不重建镜像，用于配置变更等）
./admin.sh deploy
```

流程：构建新镜像(clawnet-server/clawnet.sh) → 逐个停止旧容器 → 用新镜像重建（保留原有 volume 挂载） → 启动

## 跨项目修改的部署顺序

当同时修改了多个项目（如 nodeclaw + server + macOS App），**必须按以下顺序部署**，否则会出现 gateway token mismatch 或 proxy node 注册失败：

```
1. core rebuild     ← 最先：重建镜像 + 滚动重启 gateway 容器
2. server restart       ← 其次：重启后端，重新连接到新的 gateway
3. macOS App 编译运行    ← 最后：Xcode 编译新版客户端
```

**具体命令：**

```bash
# Step 1: 重建 core 镜像 + 滚动重启所有 gateway 容器
./multi-run.sh setup    # 重建 openclaw-{env}:local 镜像
./admin.sh deploy       # 用新镜像滚动重启所有 gateway 容器

# Step 2: 重启后端服务（让 server 重新连接到重启后的 gateway）
cd clawnet-server
./clawnet.sh setup v1

# Step 3: macOS App 在 Xcode 中编译运行
cd clawnet-macosapp/
./scripts/build-app.sh

```

**为什么顺序重要：**

- 如果先重启 server 再 rebuild nodeclaw，server 会连接到旧 gateway，gateway 重启后连接断开，server 的重连可能失败（proxy node 注册丢失）
- 正确顺序下，gateway 先就绪，server 重启后直接连到新 gateway，proxy node 注册成功

**只修改单个项目时：**

| 修改了 | 命令 |
|--------|------|
| 只改 core | `./multi-run.sh setup` then `./admin.sh deploy` |
| 只改 server | `./clawnet.sh setup v1` |
| 只改 macOS App | Xcode 编译运行即可 |

## 九、常用运维命令

```bash
# 后端日志
cd clawnet-server && ./clawnet.sh logs v1

# 进入后端容器 shell
./clawnet.sh shell v1

# 进入 PostgreSQL
./clawnet.sh psql v1

# 查看某用户的 Gateway 日志
docker logs -f oc-v1-sara-20001

# 进入某用户的 Gateway 容器
docker exec -it oc-v1-sara-20001 /bin/bash

# 查看所有 Gateway 容器（按环境过滤）
docker ps -a --filter "label=oc.env=v1" \
  --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}\t{{.Label \"oc.user_name\"}}"
```

## 十、完整首次部署 Checklist

```bash
# 1. 启动后端
cd clawnet-server
./clawnet.sh setup v1

# 2. 构建 Gateway 镜像
cd ../clawnet-setup
./multi-run.sh setup

# 3. 配置 API Key 与服务器地址
#    API Key（替换 ws-0-template 中的 apiKey）:
#    - workspaces/ws-0-template/config/openclaw.json
#    - workspaces/ws-0-template/config/agents/main/agent/models.json
#    Server 回连地址（在 clawnet-server/.env.v1 中设置）:
#    SERVER_EXTERNAL_URL=http://<你的公网IP>:9000
#    Workspaces 路径（绝对路径，在 clawnet-server/.env.v1 中设置）:
#    WORKSPACES_ROOT=/absolute/path/to/clawnet-setup/workspaces

# 4. 创建 admin
cd ../clawnet-server
./scripts/seed-admin.sh admin "Admin" "strongpass" v1

# 5. 创建用户
cd ../clawnet-setup
./admin.sh login
./admin.sh user create user1@example.com "User One" "pass123"
./admin.sh user list

# 6. 验证
./admin.sh status
curl http://localhost:9000/health
```
