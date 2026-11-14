# Superpowers 执行与单步验证记录 (Execution Log)

## 执行步骤与真实测试命令

### 步骤 1：前后端类型系统与契约增强
- **修改文件**：`src/shared/types.ts`
- **内容**：
  - 导出 `BackgroundSendChoice` ('send' | 'queue' | 'cancel')；
  - 导出 `BackgroundSendPrompt` ({ work: string[] })；
  - 修复 `AntigravityAccount` 缺少 `quotaSnapshot?: AntigravityQuotaSnapshot` 的定义。

### 步骤 2：创建后台发送确认交互弹窗与国际化配置
- **新建文件**：`src/modules/chat/composer/BackgroundSendDialog.tsx`
  - Cancel 设为 DOM 第一项获得默认聚焦，防误敲回车打断任务；
  - Queue 支持安全排队；
  - Send anyway 支持强行终止任务发送。
- **更新语言包**：`src/modules/i18n/locales/zh-CN/chat.json` 与 `en/chat.json` 补齐后台任务字典与提示文案。

### 步骤 3：重构 Hook 与状态管理打通排队逻辑
- **修改文件**：`src/modules/chat/hooks/useChatComposerState.ts`
  - 提取公共 `queueMessage` 辅助函数；
  - 挂载 `backgroundSendPrompt` 状态与 `resolveBackgroundSendPrompt` 解决器；
  - 检测会话后台任务状态，若存在正在运行的任务，弹窗提供 Queue / Cancel / Send anyway 供用户选择；
  - 导出 `backgroundSendPrompt` 和 `resolveBackgroundSendPrompt`。

### 步骤 4：界面挂载与事件连通
- **修改文件**：`src/modules/chat/composer/ChatComposer.tsx` 与 `src/modules/chat/ChatInterface.tsx`
  - 接入 `BackgroundSendDialog` 弹窗；
  - 在输入组件与页面容器之间完成 props 穿透绑定。

### 步骤 5：服务端实时秒级自动分发调度链路
- **修改文件**：
  - `server/modules/websocket/services/chat-run-registry.service.ts`：增加 `settledListeners`，在 run 到达 terminal `complete` 时通过微任务触发 `notifyRunSettled(run.appSessionId)`；
  - `server/modules/websocket/index.ts`：导出 `onRunSettled` 事件；
  - `server/modules/database/repositories/session-drafts.db.ts`：`listQueuedMessages(sessionId?)` 支持定向检索单会话排队草稿；
  - `server/modules/scheduled-messages/services/scheduled-message-dispatcher.service.ts`：在初始化时订阅 `onRunSettled`，会话 run 结算瞬间定向提取排队消息并立即发送，彻底消除以往 30 秒轮询等待！

### 步骤 6：全量校验与编译验证
1. **TypeScript 静态检查**：
   - 命令：`npm run typecheck`
   - 结果：`tsc --noEmit -p tsconfig.json && tsc --noEmit -p server/tsconfig.json` -> **0 Errors, Exit Code 0**.
2. **前后端全量生产打包**：
   - 命令：`npm run build`
   - 结果：Vite 客户端生产产物与 TypeScript 服务端产物打包顺利编译，-> **Exit Code 0**。
