# URnetwork SOCKS5 代理 10秒探活与断网秒级换IP 改造实施计划

## 1. 目标
1. **运行时每 10 秒进行一次连通性 Ping**，确保住宅出口 IP 处于通畅状态。
2. **发现 IP 不通时马上自动更换 IP**（节点轮换）。
3. **更换节点后立马 Ping 验证是否连通**，若新节点仍不通则持续轮换重试直到验通。
4. 深度协同现有的 Scale-to-Zero 智能休眠机制，休眠或直连时看门狗自动挂起，0 额外流量消耗。

## 2. 改造文件清单
- `server/modules/providers/list/antigravity/antigravity-proxy.ts`:
  - 增强 `ProxyHealthState` 接口与状态管理（增加 `watchdogActive`）；
  - 实现严格每 10 秒一次的探活执行器 `runHealthCheckTick()`；
  - 完善 `rotateNodeAndVerify()`：换节点后 0 延迟立马执行 Ping 验证，失败继续轮换重试；
  - 全生命周期钩子（启动、停止、休眠、唤醒、模式切换）精准绑定看门狗；
  - `getProxyStatus()` 注入 `health` 字段。
- `server/modules/providers/provider.routes.ts`:
  - 增加 `/antigravity/proxy/rotate` 路由，支持一键换 IP 立即探活。
- `server/index.ts`:
  - 服务启动/关闭时挂载/卸载看门狗。
- `src/shared/api.ts`:
  - 增加 `rotateAntigravityProxyNode()` 方法。
- `src/modules/settings/tabs/agents-settings/sections/content/AntigravityProxySection.tsx`:
  - 展示 10 秒探活状态、健康指标及一键【换 IP】按钮。

## 3. 验证步骤
1. 执行 `npm run build` 确保前后端编译无语法/类型错误。
2. 平滑重启后端 Node 服务。
3. 检查后台日志输出：确认每 10 秒输出一次探活状态。
4. 测试主动轮换接口：调用换 IP，确认后台立即重启代理，并在端口建立后立马执行 Ping 探活验证。
5. 验证休眠与直连联动：代理休眠或切换直连时，看门狗自动停止，0 流量无残留。
