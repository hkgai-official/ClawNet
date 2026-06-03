# ClawNet macOS App

ClawNet 是一款原生 macOS 客户端应用，作为分布式 AI Agent 网络中的智能节点运行。它允许用户与 AI Agent 进行对话、执行远程命令和文件操作，并通过精细的安全策略管理任务执行权限。

## 功能特性

- **多通道消息** — 支持直接对话、群组聊天和 Agent 任务会话，支持文本、图片、视频、语音、文件、富文本卡片等消息类型
- **实时消息流** — 基于 WebSocket 的双向通信，支持 AI 回复的流式增量更新
- **远程命令执行** — 支持 `system.run`（Shell 命令）和 `file.read/write/stat/list/search`（文件操作），所有命令均受策略控制
- **Agent 管理** — 创建、配置和管理 AI Agent，支持 Agent 间对话及审批工作流
- **联系人与社交** — 联系人管理、好友请求系统、用户资料管理
- **安全策略控制** — 命令白名单/黑名单、三级文件访问控制（拒绝全部 / 作用域限定 / 允许全部）、危险命令硬拦截
- **离线优先架构** — 消息通过本地 SQLite 缓存，支持断网后自动恢复同步
- **自动重连** — 指数退避重连机制，支持系统休眠/唤醒感知和网络状态监控

## 系统要求

| 项目 | 要求 |
|------|------|
| macOS | 15.0+（Sequoia） |
| Xcode | 16+ |
| Swift | 6.2+ |

## 构建与运行

### 使用 Xcode

```bash
xed .
# 选择 ClawNet scheme → Run (Cmd+R)
```

### 命令行构建

```bash
xcodebuild -project ClawNet.xcodeproj \
    -scheme ClawNet \
    -configuration Release \
    -derivedDataPath ./build build
```

### 使用构建脚本

```bash
./scripts/build-app.sh
# 输出: build/Build/Products/Release/ClawNet.app
```

## 服务器配置

App 启动时会从 `~/Downloads/server-config.json` 读取后端服务器地址。如果该文件不存在或格式不正确，则回退到代码中的默认值。

**配置方式一：创建配置文件（推荐）**

在 `~/Downloads/` 下创建 `server-config.json`：

```json
{
    "serverURL": "http://<你的公网IP>:9000"
}
```

**配置方式二：修改源码默认值**

编辑 `ClawNet/ServerConfig.swift`，将 `defaultServerURL` 的回退值改为你的服务器地址：

```swift
return "http://<你的公网IP>:9000"
```

> **注意：** 这里需要填写 clawnet-server 所在机器的**公网 IP**（或局域网 IP），端口对应 `.env` 中的 `BACKEND_PORT`。

## 首次启动

1. 确保已按上述步骤配置服务器地址
2. 输入邮箱和密码进行登录
3. 凭证安全存储于 macOS Session
4. 通过 **设置**（`Cmd+,`）配置命令策略和文件访问权限

## 技术架构

```
AppState（根状态）
├── AuthManager          # JWT 令牌生命周期管理
├── ClawNetAPI           # REST 客户端
├── ChatService          # WebSocket 消息 + 会话缓存
├── ChatEventHandler     # 实时消息解析
├── NodeEventHandler     # 命令分发 + 策略执行
├── ConnectionManager    # 重连逻辑 + 网络感知
├── ContactService       # 联系人 + 好友请求
├── AgentService         # Agent CRUD + 对话管理
├── CommandPolicy        # 白名单/黑名单 + 文件访问控制
├── LocalStore           # SQLite 持久层（GRDB）
└── NotificationService  # 系统通知
```

**核心技术栈：** SwiftUI · WebSocket · GRDB/SQLite · Keychain · JWT · swift-log

## 项目结构

```
ClawNet/
├── Views/          # SwiftUI 视图（聊天、设置、联系人、认证）
├── Models/         # 数据模型（Chat、Agent、Contact、AppState）
├── Services/       # 核心服务（ChatService、AgentService、CommandPolicy 等）
├── Networking/     # 网络层（AuthManager、ClawNetAPI、ServerConnection）
├── Gateway/        # WebSocket 网关协议
├── Storage/        # 本地存储（GRDB/SQLite）
├── Utilities/      # 工具类
├── Assets.xcassets # 资源文件
└── docs/           # 内部文档
```

## 许可证

本项目基于 [Apache License 2.0](LICENSE) 开源。详见 [LICENSE](LICENSE) 文件。

```
Copyright 2025 ClawNet Contributors

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
```
