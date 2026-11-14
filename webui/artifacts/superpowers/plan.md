# Superpowers 实施方案：后台任务排队 (Message Queuing) 与秒级分发调度集成

## 1. 目标与价值
解决用户在执行长时间后台任务（构建、测试、长思考推理、多步工具调用）时，容易误触回车打断任务、或无法提前提交后续指令的体验痛点。
- **前端交互**：弹窗拦截并支持安全取消、排队（Queue）或继续发送；
- **后端秒级调度**：任务结算时通过事件机制（`onRunSettled`）立即触发排队消息，告别 30 秒轮询等待。

## 2. 变更影响范围 (Files to Touch)
1. `src/shared/types.ts`: 增加 `BackgroundSendChoice` 和 `BackgroundSendPrompt` 类型。
2. `src/modules/chat/composer/BackgroundSendDialog.tsx`: 新增后台任务发送确认弹窗（取消默认聚焦，防误触）。
3. `src/modules/chat/composer/ChatComposer.tsx`: 接入 `BackgroundSendDialog`。
4. `src/modules/chat/hooks/useChatComposerState.ts`: 提取通用 `queueMessage`，集成后台任务提问与排队流。
5. `src/modules/chat/ChatInterface.tsx`: 贯通状态传递。
6. `src/modules/i18n/locales/zh-CN/chat.json` / `en/chat.json`: 补全中文与英文提示字典。
7. `server/modules/websocket/services/chat-run-registry.service.ts` & `server/modules/websocket/index.ts`: 实现 `onRunSettled` 事件总线。
8. `server/modules/database/repositories/session-drafts.db.ts`: `listQueuedMessages(sessionId?)` 定向检索支持。
9. `server/modules/scheduled-messages/services/scheduled-message-dispatcher.service.ts`: 订阅事件总线，实现毫秒级自动触发。

## 3. 实施步骤与单步验证计划
- **Step 1**: 在 `src/shared/types.ts` 定义排队类型与接口。
- **Step 2**: 实现 `BackgroundSendDialog.tsx` 组件并配置中英文国际化文本。
- **Step 3**: 重构 `useChatComposerState.ts`，打通 `queueMessage` 与后台任务弹窗选择逻辑。
- **Step 4**: 在 `ChatComposer.tsx` 和 `ChatInterface.tsx` 完成挂载与事件连接。
- **Step 5**: 在服务端实现 `onRunSettled` 事件发布与订阅调度（`chat-run-registry` -> `scheduled-message-dispatcher` -> `session-drafts.db`）。
- **Step 6**: 执行全量类型检查（`npm run typecheck`）与构建校验（`npm run build`）。
- **Step 7**: 完成安全审计与自检闭环，输出 `execution.md` 与 `finish.md`。
