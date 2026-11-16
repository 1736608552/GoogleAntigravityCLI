# 取消 URnetwork SOCKS5 代理 10s Ping 规划方案 (Superpowers Plan)

## 1. 目标
响应用户需求：“URnetwork SOCKS5 代理 取消那个10s ping”。
彻底移除 SOCKS5 代理的 10 秒定时自动 Ping 循环，停止一切无谓的后台网络探活打扰与流量质押消耗，遵循专有通道按需调度与流量零浪费原则，同时保留用户主动测试和断网重试时的节点轮换功能。

## 2. 变更清单
1. **后端引擎：`server/modules/providers/list/antigravity/antigravity-proxy.ts`**
   - 彻底关闭并移除 `proxyHealthWatchdogTimer = setInterval(..., 10_000)` 定时循环；
   - 移除启动 1 秒后的延迟自启动探活；
   - 重构 `startProxyHealthWatchdog()` 与 `stopProxyHealthWatchdog()`，确保不再启动后台任何轮询 Ping 定时器，并清理可能残留的定时器句柄；
   - `getProxyHealthStatus()` 返回的状态中 `watchdogActive` 设为 `false`，默认状态文案表明“按需连接（已取消后台Ping省流）”；
   - 保留用户主动触发的 `rotateNodeAndVerify()` 和手动连通性测试 `testProxyConnectivity()`。
2. **前端展示：`src/modules/settings/tabs/agents-settings/sections/content/AntigravityProxySection.tsx`**
   - 将原标签文案 `🛡️ 探活看门狗 (每10秒Ping):` 更新为 `🛡️ 链路健康与节点状态:`；
   - 移除界面中任何提及“每10秒Ping”的过期说明，同步更新节点运行时的状态提示（例如“按需就绪/省流静默”）；
   - 保留“换IP并验证”按钮，用户需要时仍可手动单次验证新住宅节点。
3. **服务生命周期清理：`server/index.ts`**
   - 检查启动与关机钩子，确保不会再启动 10s ping 定时器。

## 3. 验证方案
1. 静态类型校验：执行 `npx tsc --noEmit`，确保前后端 TypeScript 编译 0 报错；
2. 前端静态包构建：执行 `npm run build:client`，验证生产构建无破损；
3. 进程与定时器审查：验证系统中不再有任何针对 19999 端口的 10 秒定时 curl / ping 请求；
4. Git 提交与同步。
