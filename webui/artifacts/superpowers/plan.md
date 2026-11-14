# Google Antigravity 原生语言服务器双配额体系改造方案 (Implementation Plan)

## 1. 目标与背景
彻底攻克并纠正 Antigravity 实时配额与重置时间问题，摒弃以往通过外部云 API 估算自然周一重置的猜算方式：
- **深度研读开源插件 `dsh-antigravity-usage` 架构**：确认 Antigravity 的配额与重置时间不落盘，由本地语言服务器（Language Server）HTTP RPC 服务原生动态计算暴露；
- **5小时滚动额度 (5-Hour Rolling Limit)**：短期突发配额，耗尽后在当前 5 小时窗口期内暂停调用；
- **每周总额度 (Weekly Cap)**：滚动 7 天（Rolling 7-Day Window，168 小时）全局硬预算，真实重置时间为首笔大额消耗起精确向后推算 7 天（而非自然周一）；
- **动态百分比与重置倒计时**：直通本地语言服务器 `RetrieveUserQuotaSummary`，100% 原生呈现真实的百分比（如 89.0%、94.4%）和官方倒计时（如 4小时20分 vs 6天23小时）。

## 2. 修改范围
- `webui/server/modules/providers/list/antigravity/antigravity-accounts.service.ts`：
  - 增加 `getLanguageServerSession()`：集成环境变量、持久化文件及 `/proc` 进程逆序扫描，自愈探测存活的语言服务器端口与 CSRF Token；
  - 增加 `fetchFromLanguageServer()`：直调 RPC 提取 `groups`、`buckets`，精准提取 5h 与 weekly 原生数据；
  - 在 `fetchLiveQuotaSummary()` 中作为第一优先级接入，若无语言服务器再平滑降级至云端 API。
- `webui/src/modules/settings/tabs/agents-settings/sections/content/AntigravityProxySection.tsx`：
  - 升级模型配额卡片为双排展示结构（⚡ 5小时滚动额度 + 📅 每周总额度）；
  - 呈现 3 色分段物理进度条与高精度官方动态倒计时；
  - 呈现 5h 步数与本周步数，底部附带双配额协同运行机制说明条。

## 3. 验证与交付
- 全量构建 `npm run build:server` 与 `npm run build:client` 零错误通过；
- 服务平滑热重启与真实 API `/api/providers/antigravity/quota` 联通性测试验证；
- 敏感凭证全面脱敏自检；
- Git 提交并推送到 GitHub 远程主分支。
