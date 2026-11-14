# Google Antigravity 双配额并行体系改造方案 (Implementation Plan)

## 1. 目标与背景
纠正配额显示逻辑中的误区（“5小时后周额度会回满”），遵循 Google Antigravity 官方双窗口配额体系：
- **5小时滚动额度 (5-Hour Rolling Limit)**：短期突发配额，耗尽后在当前 5 小时窗口期内暂停调用；
- **每周总额度 (Weekly Cap)**：全周全局上限硬预算，与 5 小时额度并行实时扣减。一旦耗尽，整周锁定直至周一刷新。
- **双维度并列展示**：前端设置中，对 Gemini 系列与 Claude/GPT 系列模型，同时并列显示 5小时额度与每周总额度及其独立的重置倒计时。

## 2. 修改范围
- `webui/server/modules/providers/list/antigravity/antigravity-accounts.service.ts`：
  - 增加 `getNextWeeklyResetIso()` 自然周周一 UTC 00:00 重置时间戳算法；
  - 准确构造 `gemini5h`、`geminiWeekly`、`claude5h`、`claudeWeekly`；
  - 增加双窗口协同消耗的策略文案说明。
- `webui/src/modules/settings/tabs/agents-settings/sections/content/AntigravityProxySection.tsx`：
  - 升级模型配额卡片为双排展示结构（⚡ 5小时滚动额度 + 📅 每周总额度）；
  - 呈现 3 色分段物理进度条与高精度动态倒计时；
  - 底部增加双配额协同运行机制说明条。

## 3. 验证与交付
- 全量构建 `npm run build`（前端 Vite + 后端 TypeScript）；
- 服务平滑热重启与接口连通性验证；
- 敏感凭证全面脱敏自检；
- Git 提交并推送到 GitHub 远程主分支。
