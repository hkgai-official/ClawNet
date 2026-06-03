# ClawNet Core

> 基于 [OpenClaw](https://github.com/openclaw/openclaw) `v2026.2.14` 的增强分支，版本 `2026.2.25`。
> 新增 1400+ 文件，修改 2400+ 文件，覆盖引擎内核、网关架构、UI、消息通道及部署全链路。

## 与上游的核心差异

### 1. 代理节点架构 (Proxy Node)

上游仅支持直连节点。ClawNet 引入 Operator 代理层：

```
Operator Connection ──┬── Proxy Node A
                      ├── Proxy Node B
                      └── Proxy Node C
```

- `NodeSession` 新增 `proxy` 标记与 `fileAccess` 策略（`deny` / `scoped` / `full`）
- `NodeRegistry` 新增 `registerProxy()` / `unregisterProxy()` / `unregisterAllProxies()`
- Operator 断连时自动清理所有代理节点及其挂起的 invoke

### 2. 远程文件操作

Nodes Tool 提供 13 个文件相关 action，通过 Gateway Blob Store 实现二进制传输：

**基础文件操作：**

| Action | 说明 |
|--------|------|
| `file_read` | 单文件/批量读取（最多 20 个），支持 `parse` 模式和 `saveTo` 本地保存 |
| `file_write` | 通过 blob 上传后写入远端节点，支持 `createDirs` / `append` |
| `file_stat` | 获取文件元数据 |
| `file_list` | 目录列表，支持递归、排序、深度限制 |
| `file_search` | 关键词搜索，可配置深度、预览字节数、最大结果数 |
| `file_move` | 移动文件/目录，支持可选覆盖 |
| `file_rename` | 原地重命名文件/目录 |
| `file_copy` | 递归复制文件/目录 |
| `file_mkdir` | 创建目录，支持递归创建 |
| `file_trash` | 安全删除，移入工作区回收站（`.clawnet/trash/`） |

**操作历史与回滚：**

| Action | 说明 |
|--------|------|
| `ops_log` | 查询操作历史，支持按 sessionId、时间范围、命令类型过滤 |
| `ops_undo` | 按 operationId 撤销单个操作 |
| `ops_rollback` | 批量回滚，支持 dry-run 预览 |

对应新增 `fetchGatewayBlob()` / `uploadGatewayBlob()` / `resolveGatewayHttpUrl()` 底层接口。

### 3. Tag Agent（标签助手）

上游无多身份隔离机制。ClawNet 引入基于标签的社会身份隔离：

```
用户
├── 主助手 (Main)      ── 可访问所有标签工作区
├── 工作助手 (Tag: 工作) ── 仅访问工作文件夹
└── 生活助手 (Tag: 生活) ── 仅访问生活文件夹
```

- `TagContext` 定义标签上下文：`tagId` / `tagName` / `workspaceId` / `nodeAcl` / `accessMode`
- Gateway RPC 支持 `tag.context.set` / `tag.context.get` / `tag.context.clear` / `tag.workspace.init`
- `accessMode` 区分 `rw`（读写）和 `ro`（只读，用于代理对话）
- `a2aMode` 为 Agent-to-Agent 对话提供更严格的安全策略
- 主助手（`isMain: true`）可跨标签访问所有工作区

### 4. 工作区与软硬限制

ClawNet 区分**云端工作区**（Gateway 容器内）和**节点端工作区**（用户设备上），并实施两层限制：

**工作区层级：**

```
~/.openclaw/
├── workspace/                    # 云端默认工作区
│   ├── {tagWorkspaceId}/         # 标签隔离的子工作区
│   └── memory/                   # 记忆存储
├── sandboxes/                    # 沙箱工作区（临时隔离）
└── sessions/                     # 会话记录（受磁盘预算约束）
```

**软硬限制：**

| 限制类型 | 参数 | 默认值 | 说明 |
|----------|------|--------|------|
| 单文件注入软限制 | `bootstrapMaxChars` | 20,000 字符 | 每个 bootstrap 文件注入系统提示词的上限 |
| 总注入软限制 | `bootstrapTotalMaxChars` | 150,000 字符 | 所有 bootstrap 文件的总字符上限 |
| 磁盘硬限制 | `maxDiskBytes` | 无限制 | 会话存储的绝对上限，超出触发清理 |
| 磁盘软限制 | `highWaterBytes` | 无限制 | 清理目标水位，按最旧会话优先淘汰 |

**节点端访问控制：**

- `NodeFileAccess` 支持 `deny` / `scoped` / `full` 三种模式
- `TagNodeAcl` 实现路径级白名单/黑名单（支持 fnmatch 通配符）
- 边界违规追踪：`node_workspace_isolation` / `file_workspace_escape` / `node_acl_denied`

### 5. 最小权限与安全加固

- Gateway Tool 调用新增 `resolveLeastPrivilegeOperatorScopesForMethod()`，按方法分配最小 scope
- Gateway Tool 标记 `ownerOnly: true`，仅 owner 可调用
- URL 验证区分 `local` / `remote` target，token 按 target 类型从 config 自动解析
- 配对错误自动检测：`isPairingRequiredMessage()` + `extractPairingRequestId()`

### 6. 凭证与连接管理

- `resolveGatewayCredentialsFromConfig()` 统一凭证解析
- `GatewayOverrideTarget` 类型区分 local/remote，token fallback 策略不同
- CLI 命令支持从父命令继承 `--token` / `--password`（`inheritOptionFromParent`）
- 结构化日志 `createSubsystemLogger()` 替代 `console.info`

### 7. 多语言 (i18n)

`ui/src/i18n/` 完整国际化系统：

- `I18nManager` 翻译引擎 — 单例 + 订阅者模式 + 参数化字符串
- Lit Web Component 集成控制器
- 浏览器语言自动检测 + localStorage 持久化
- 已支持：English / 简体中文 / 繁体中文 / 葡萄牙语-巴西
- 缺失翻译自动 fallback 到英语

### 8. 部署优化

**Docker**：UID/GID 映射、ClawHub 插件预装、非 root 运行、`OPENCLAW_PREFER_PNPM=1`

**Podman**：`openclaw.podman.env` 模板 + `setup-podman.sh` 脚本

**构建**：`pyproject.toml`（Python 技能 ruff/pytest）、`vitest.gateway.config.ts`（网关专用测试）、iOS 签名脚本

---

## 架构总览

```
┌──────────────────────────────────────────────────────────────┐
│                       Gateway (核心)                          │
│  ┌──────────┐  ┌──────────┐  ┌───────────┐  ┌────────────┐ │
│  │ Auth/TLS │  │ Node     │  │ Blob      │  │ Tag        │ │
│  │ + Scopes │  │ Registry │  │ Store     │  │ Context    │ │
│  └──────────┘  └──────────┘  └───────────┘  └────────────┘ │
├──────────────────────────────────────────────────────────────┤
│                      Agent Tools                              │
│  ┌──────────────┐  ┌──────────────┐  ┌─────────────────────┐│
│  │ Gateway Tool  │  │ Nodes Tool   │  │ Workspace           ││
│  │ (ownerOnly)   │  │ 13 file +    │  │ Isolation +         ││
│  │               │  │ 3 ops actions│  │ Disk Budget         ││
│  └──────────────┘  └──────────────┘  └─────────────────────┘│
├──────────────────────────────────────────────────────────────┤
│                    消息通道 (Channels)                         │
│  WhatsApp · Telegram · Slack · Discord · Signal               │
│  iMessage · Google Chat · MS Teams · Matrix · WebChat         │
│  Zalo · BlueBubbles · Nostr · Line · Feishu · IRC             │
│  Mattermost · Nextcloud Talk · Synology Chat                  │
├──────────────────────────────────────────────────────────────┤
│                    Skills / Extensions                         │
│  PDF · DOCX · PPTX · XLSX · Markdown · Weather                │
│  Video Frames · Summarize · Coding Agent · References          │
└──────────────────────────────────────────────────────────────┘
```

## 技术栈

| 类别 | 工具 |
|------|------|
| 语言 | TypeScript (ESM) + Python (技能) |
| 运行时 | Node.js >= 22.12.0 |
| 包管理 | pnpm 10.23.0 |
| UI | Lit Web Components |
| 测试 | Vitest + V8 Coverage (70% 阈值) |
| Lint | Oxlint + Oxfmt + Ruff (Python) |
| 构建 | tsdown |
| 协议 | WebSocket (ws/wss) + HTTP Blob API |

## Skills 技能系统

相比上游 48 个技能，ClawNet 精简为 14 个，聚焦**文档处理与自动化**。新增 8 个技能，均为上游不具备的能力。

### 新增技能

| 技能 | 用途 | 实现 |
|------|------|------|
| **docx** | Word 文档创建/读取/编辑，支持表格、目录、页眉页脚、批注 | docx-js + Python XML 操作 |
| **xlsx** | Excel 读写与数据分析，强制公式驱动（禁止硬编码值） | openpyxl + pandas |
| **pptx** | PPT 创建/编辑，含设计规范（配色、字体配对、间距） | pptxgenjs + LibreOffice 转图检查 |
| **pdf** | PDF 提取/合并/拆分/OCR/水印/加密/表单填充 | pdfplumber + pypdf + reportlab + tesseract |
| **mark2pdf-simple** | Markdown 转 PDF，内嵌文泉驿微米黑字体，保证中文渲染 | weasyprint + 本地 TTF |
| **markdown-converter** | 万能格式转 Markdown（PDF/Word/PPT/Excel/HTML/音频/视频） | markitdown[all] (uvx) |
| **skill-router** | 智能技能分发：扫描元数据 → 匹配现有技能或创建新技能 | 元技能，调用 skill-creator |
| **references** | 天气服务参考文档，中文城市覆盖指南 | 静态文档 |

### 保留并增强的上游技能

| 技能 | 变更 |
|------|------|
| **weather** | 重写为中文优先（中文/英文/拼音查询），后端切换为 Open-Meteo |
| **coding-agent** | 新增 PTY 模式要求、反模式文档、2026.1 实战经验 |
| **skill-creator** | 从原则导向改为流程导向（评估 → 基准 → 迭代） |
| **tmux** | 新增安全输入模式和 sleep 间隔示例 |
| **summarize** / **video-frames** | 与上游一致，无修改 |

## 部署

详见 [clawnet-setup/README.md](../clawnet-setup/README.md)

## 项目结构

```
src/
├── cli/              # CLI 入口 (gateway-cli, node-cli, nodes-*)
├── gateway/          # 网关内核 (auth, node-registry, blob, credentials, tag-context)
├── agents/tools/     # Agent 工具 (gateway-tool, nodes-tool, file ops)
├── agents/           # 工作区管理 (workspace, sandbox, boundary-violation)
├── channels/         # 消息通道路由与管理
├── infra/            # 基础设施 (TLS, node-pairing, gateway-lock)
├── commands/         # 命令实现 (status, onboard, daemon)
├── daemon/           # 系统服务 (launchd/systemd)
├── config/           # 配置 (sessions/disk-budget, schema.tags)
├── shared/           # 共享工具 (node-match)
└── hooks/            # 生命周期钩子
ui/src/
├── i18n/             # 国际化系统
└── ui/               # Web Components (views, controllers)
extensions/           # 通道插件 (msteams, matrix, zalo, voice-call...)
skills/               # 技能 (pdf, docx, xlsx, pptx, coding-agent...)
```

## 许可证

本项目基于 [Apache License 2.0](LICENSE) 发布,并整合了采用 MIT 协议的上游 [OpenClaw](https://github.com/openclaw/openclaw)(原始版权归属见 [NOTICE](NOTICE))。
