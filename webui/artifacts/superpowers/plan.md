# Google Antigravity 原生语言服务器配额 100% 虚假回退彻底根治方案

## 一、深层根因分析
1. **动态端口与 CSRF Token 丢失导致的级联失败**：
   Google Antigravity CLI 启动时动态生成 HTTP 监听端口与 CSRF Token（如本轮真实的 `localhost:36401` 与 Token `690c9ba8-...`）。
   当旧持久化文件（`ls_session.json`）记录了死亡端口（如 `42045`）时，后端 3100 独立服务因未自动从最新的 `cli-*.log` 日志或活跃进程解析最新端口，导致 `probeLsSession` 失败。
2. **REST API 的致命覆盖污染**：
   在语言服务器失联后，后端降级请求 Google 云端 REST API（`fetchAvailableModels`）。由于该接口不返回 5 小时滚动算力桶（remainingFraction 恒为 1.0），代码在 `buildQuotaSnapshotFromModels` 中误将配额算为 100%，并将 5h 倒计时算为 4h 59m，周倒计时算为 1天14h（按自然周一），随后写入了全局内存与磁盘 `accounts.json`，把原本准确的真实快照强行覆盖污染！
3. **消息历史快照与实时响应断层**：
   历史消息在 transcript.jsonl 中不包含快照，前端在 `actualSnap` 为空时 fallback 触发默认值计算；且前端在收到 `quota_update` 时仅更新了全局 Hook，未联动修正已渲染消息对象的快照。

## 二、实施步骤清单
1. **修复 `antigravity-accounts.service.ts` 的会话发现与防污染屏障**：
   - 增加从 `cli-*.log` 最新日志中自动解析语言服务器 HTTP 端口的机制；
   - 增加从 `/proc/*/environ` 深度捕获有效 CSRF Token 的能力；
   - 立即将当前鲜活的 `localhost:36401` 和 Token 持久化写入 `data/ls_session.json` 和 `~/.gemini/antigravity-cli/ls_session.json`；
   - **核心防污染拦截**：严禁 `buildQuotaSnapshotFromModels` 用 100% 的伪数据覆盖已有真实快照；当语言服务器临时不可用时，严格继承既有快照并动态推演倒计时。
2. **打通 `antigravity-runtime.provider.ts` 与 `antigravity-sessions.provider.ts`**：
   - 在 `completeMessage` 产出前直接 `await fetchLiveQuotaSummary(true)`，保证新消息天然携带官方实时原生双配额；
   - 在 `antigravity-sessions.provider.ts` 渲染历史消息时，为所有 assistant 消息注入有效快照，杜绝前端空快照回退。
3. **升级前端 Hook 与组件防御**（`MessageQuotaFooter.tsx` & `useChatRealtimeHandlers.ts`）：
   - `MessageQuotaFooter`：当实时快照（`liveQuota` 或 `cachedQuotaSnapshot`）存在时，100% 绝对强制优先渲染实时快照；历史消息若为 100% 且存在有效实时快照，自动覆写为实时真实百分比；
   - `useChatRealtimeHandlers`：收到 `quota_update` 时，不仅更新全局 Hook，同时原地更新当前 session 消息树中最后一条 assistant 消息的快照。
4. **编译构建、热重启与真机验证**：
   - 执行 `npm run build:server` 和 `npm run build:client`；
   - 平滑热重启 3100 服务；
   - 调用接口与真机确认：不再出现 100% 闪回，稳定展现 76.7% 与 89.8% 双配额。
