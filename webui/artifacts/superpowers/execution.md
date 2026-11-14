# Google Antigravity 原生语言服务器双配额体系执行记录 (Execution Log)

## 1. 架构逆向与调研
- 克隆并研读了 `kirigayakazima/dsh-antigravity-usage` 官方原装实现；
- 确认数据源：Antigravity 会话 token 消耗不落盘，真正额度由本地语言服务器通过 HTTP 暴露：
  - `POST http://127.0.0.1:<port>/exa.language_server_pb.LanguageServerService/GetUserStatus`
  - `POST http://127.0.0.1:<port>/exa.language_server_pb.LanguageServerService/RetrieveUserQuotaSummary`
  - Header: `x-codeium-csrf-token: <csrfToken>`

## 2. 代码实现
- 在 `antigravity-accounts.service.ts` 中实现：
  - `probeLsSession`：2.5 秒快速握手探活；
  - `getLanguageServerSession`：多重自愈探测（环境变量 -> 本地 session 文件 -> `/proc` 最新进程环境嗅探），探活成功后自动持久化；
  - `fetchFromLanguageServer`：直接解析官方返回的 `Gemini Models` 和 `Claude and GPT models` 的 `5h` 与 `weekly` buckets，提取真实 `remainingFraction`、`resetTime` 与官方说明；
  - 401 自动失效重试机制；
  - `fetchLiveQuotaSummary` 将其作为第一优先级优先返回。

## 3. 编译与测试验证
- 执行 `npm run build:server`：编译 100% 成功，生成 `dist-server`；
- 执行独立 Node.js 测试脚本：
  - 环境变量模式：成功获取 `Gemini 5h: 89% (4小时20分钟)`，`Gemini Weekly: 94.4% (6天23小时)`；
  - 无环境变量（纯 `/proc` 嗅探模式）：同样 100% 成功命中并提取最新配额；
- 平滑热重启 3100 服务进程（PID 4009788）；
- 通过 HTTP API `GET http://127.0.0.1:3100/api/providers/antigravity/quota?force=true` 验证，返回真实的 89% 5小时额度与 94.4% 周额度，倒计时精确对齐 Google 官方返回值。
