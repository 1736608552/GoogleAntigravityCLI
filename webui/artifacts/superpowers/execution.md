# Google Antigravity 原生语言服务器双配额体系根治执行记录 (Execution Log)

## 1. 深度根因排查与复现
- **根因 A：动态端口与 CSRF Token 丢失**
  - Google Antigravity CLI 启动时动态生成随机 HTTP 监听端口与 CSRF Token（如本轮真实的 `localhost:36401` 与 Token `690c9ba8-429d-4323-8cbe-6e415a672b98`）；
  - 当旧会话文件失效时，后端 3100 服务扫描未命中，导致语言服务器探测失败。
- **根因 B：REST API 致命覆盖污染**
  - 语言服务器连接失败后，后端回退至 Google 云端 REST API（`fetchAvailableModels`）。由于该接口不返回 5 小时滚动算力桶（remainingFraction 恒为 1.0），代码在 `buildQuotaSnapshotFromModels` 中误将配额算为 100%，并将 5h 倒计时算为 4h 59m，周倒计时算为 1天14h（按自然周一），随后写入了全局内存与磁盘 `accounts.json`，把原本准确的真实快照强行覆盖污染！
- **根因 C：历史消息回退**
  - 历史助手消息未携带完整快照，前端渲染时回退计算触发了 100% 默认值。

## 2. 核心架构修复与实施
1. **多层语言服务器会话深度自愈** (`antigravity-accounts.service.ts`)：
   - 支持从全系统 `/proc/*/environ` 深度扫描任意包含 `ANTIGRAVITY_CSRF_TOKEN` 的进程；
   - 自动解析 `~/.gemini/antigravity-cli/log/cli-*.log` 最新日志，直接提取当前活跃的 HTTP 监听端口；
   - 探活成功后立即双写持久化至 `data/ls_session.json` 与 `~/.gemini/antigravity-cli/ls_session.json`；
2. **REST API 防污染铁壁** (`antigravity-accounts.service.ts`)：
   - 严格拦截：若当前系统已有语言服务器拉取的原生真实配额数据，严禁被 REST API 产生的假 100% 覆盖；
3. **对话结束原生配额直出** (`antigravity-runtime.provider.ts`)：
   - 在生成 `completeMessage` 时，若缓存为空或疑似假满额，直接 `await fetchLiveQuotaSummary(true)` 强刷真实配额后向客户端派发；
4. **历史消息快照全量清洗** (`antigravity-sessions.provider.ts`)：
   - 在 `fetchHistory` 遍历所有 assistant 消息，对缺失快照或携带陈旧 100% / 1天14h 特征的历史消息，全量清洗替换为当前官方语言服务器原生最新真实快照；
5. **前端组件防御强化** (`MessageQuotaFooter.tsx` & `useChatRealtimeHandlers.ts`)：
   - 优先采用 `liveQuota` 与模块单例全局缓存；
   - 若快照包含 100% 假特征，自动切换至真实语言服务器算力池；
   - 收到 `quota_update` 时联动更新当前会话消息树。

## 3. 全链路测试与验证
- `npm run build:server`：100% 成功编译；
- `npm run build:client`：100% 成功构建打包；
- 独立 Node 验证：
  - Active Account QuotaSnapshot: Gemini 5h: 72.7% (3小时2分) | Gemini Weekly: 87.7% (6天22小时)；
  - 历史助手消息 52 条全量清洗为真实双配额；
- 平滑热重启 3100 端口服务（PID 4032350），服务稳定监听并提供最新前端资源。
