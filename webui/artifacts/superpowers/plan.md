# 交互升级与核心缺陷修复计划 (Superpowers Plan)

## 任务目标
1. **彻底根治“对话后必须手动刷新才显示”的严重 Bug**：
   - 完善 WebSocket 应用层双向心跳保活（15秒定时 ping/pong），防止手机端及反向代理超时切断连接；
   - 优化 WebSocket 重连处理：重连后第一时间同步发送 `chat.subscribe`，确保服务端即时重绑 socket 并重放缺失事件；
   - 前端增加活跃运行态防假死兜底同步（Active Turn Fallback Sync）：处于 processing 状态下若超过 3 秒无 WebSocket 推送，自动静默增量拉取，彻底告别手动 F5 刷新。
2. **彻底解决“附件大文件图片不能上传”的问题**：
   - 将服务端 `assets.routes.ts` 的图片上传限制由 5MB、附件限制由 10MB 全面放宽至 100MB，支持 20 个并发文件；
   - 将前端 `useChatComposerState.ts` 的 `MAX_ATTACHMENT_SIZE` 放宽至 100MB，优化超限提示为中文。
3. **实现截图所示的全新交互体系**：
   - **任务进度清单卡片（Task Plan Checklist）**：
     - 自动检测并提取 Markdown 任务待办列表（`[x]`, `[/]`, `[ ]`）；
     - 渲染为半透明圆角卡片，具有已完成（✔）、进行中（⠇动态动画）、待执行（○）等精美状态；
   - **步骤折叠与动态计时条（Running Step Accordion）**：
     - 工具调用与执行步骤默认采用折叠状态条展示，右侧带有动态实时运行计时器（如 `12s`、`1m 25s ⌵`），可一键平滑展开/折叠日志；
   - **快捷引用按钮（Floating Quote Action）**：
     - 划选文本或在消息右侧提供快捷“引用”按钮，一键将内容带入输入框。

## 涉及文件
- 服务端：
  - `server/modules/assets/assets.routes.ts`（放宽图片与文件上传至 100MB）
  - `server/modules/websocket/services/chat-websocket.service.ts`（支持应用层 ping/pong）
- 前端：
  - `src/shared/context/WebSocketContext.tsx`（添加 15s 定时 ping 心跳）
  - `src/modules/chat/hooks/useChatComposerState.ts`（放宽前端附件大小至 100MB）
  - `src/modules/chat/ChatInterface.tsx`（优先同步发送 chat.subscribe）
  - `src/modules/chat/hooks/useChatSessionState.ts`（增加 processing 状态防假死兜底拉取）
  - `src/modules/chat/transcript/TaskPlanChecklist.tsx`（全新任务进度打勾卡片组件）
  - `src/modules/chat/transcript/RunningStepAccordion.tsx`（全新带计时器的折叠步骤条）
  - `src/modules/chat/transcript/MessageComponent.tsx` 与 `ToolGroupContainer.tsx`（集成新交互卡片）
