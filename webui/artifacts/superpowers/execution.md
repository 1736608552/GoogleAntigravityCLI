# WebUI 全面交互重设计执行日志（Superpowers Execution）

## 1. 已执行的规划阶段与落盘文件

### 阶段 1：全局动效令牌、顶栏交互重塑与快捷控制中心通道打通
- [src/index.css](file:///vol1/@apphome/GoogleAntigravityCLI/webui/src/index.css)：新增 `sheet-slide-up`（`.sheet-enter`）与 `popover-pop-in`（`.popover-enter`）过渡动效。
- [src/modules/project-workspace/hooks/useProjectsState.ts](file:///vol1/@apphome/GoogleAntigravityCLI/webui/src/modules/project-workspace/hooks/useProjectsState.ts)：增加 `quickSettingsOpen` 与 `setQuickSettingsOpen`。
- [src/modules/project-workspace/context/ProjectsStateContext.tsx](file:///vol1/@apphome/GoogleAntigravityCLI/webui/src/modules/project-workspace/context/ProjectsStateContext.tsx)：新增 `ProjectQuickSettingsContext` 并导出 `useProjectQuickSettingsState()`。
- [src/modules/project-workspace/ProjectQuickSettingsRegion.tsx](file:///vol1/@apphome/GoogleAntigravityCLI/webui/src/modules/project-workspace/ProjectQuickSettingsRegion.tsx)：新增快捷控制中心宿主容器，受控挂载 `QuickSettingsPanel` 并关闭压屏边缘把手（`showEdgeHandle={false}`）。
- [src/modules/project-workspace/ProjectWorkspaceShell.tsx](file:///vol1/@apphome/GoogleAntigravityCLI/webui/src/modules/project-workspace/ProjectWorkspaceShell.tsx)、[ProjectMainRegion.tsx](file:///vol1/@apphome/GoogleAntigravityCLI/webui/src/modules/project-workspace/ProjectMainRegion.tsx)、[WorkspaceMain.tsx](file:///vol1/@apphome/GoogleAntigravityCLI/webui/src/modules/project-workspace/WorkspaceMain.tsx)、[WorkspaceHeader.tsx](file:///vol1/@apphome/GoogleAntigravityCLI/webui/src/modules/project-workspace/WorkspaceHeader.tsx)、[MobileMenuButton.tsx](file:///vol1/@apphome/GoogleAntigravityCLI/webui/src/modules/project-workspace/MobileMenuButton.tsx)：统一顶栏卡片按钮与毛玻璃背景，右侧新增控制中心入口按钮（`SlidersHorizontal`）。

### 阶段 2：快捷控制中心与设置中心全面交互重构
- [src/modules/quick-settings-panel/QuickSettingsPanelView.tsx](file:///vol1/@apphome/GoogleAntigravityCLI/webui/src/modules/quick-settings-panel/QuickSettingsPanelView.tsx)、[QuickSettingsPanelHeader.tsx](file:///vol1/@apphome/GoogleAntigravityCLI/webui/src/modules/quick-settings-panel/QuickSettingsPanelHeader.tsx)、[QuickSettingsSection.tsx](file:///vol1/@apphome/GoogleAntigravityCLI/webui/src/modules/quick-settings-panel/QuickSettingsSection.tsx)、[QuickSettingsToggleRow.tsx](file:///vol1/@apphome/GoogleAntigravityCLI/webui/src/modules/quick-settings-panel/QuickSettingsToggleRow.tsx)、[QuickSettingsContent.tsx](file:///vol1/@apphome/GoogleAntigravityCLI/webui/src/modules/quick-settings-panel/QuickSettingsContent.tsx)：
  - 移动端改用底部圆角云母抽屉，桌面端为右侧悬浮圆角控制卡，统一 `z-[9050]`/`z-[9100]` 遮罩层级并支持 `Escape` 关闭；
  - 将原 checkbox 开关行升级为物理拨片 Switch（`role="switch"`），新增「完整设置中心」直达入口。
- [src/modules/settings/Settings.tsx](file:///vol1/@apphome/GoogleAntigravityCLI/webui/src/modules/settings/Settings.tsx)、[SettingsSidebar.tsx](file:///vol1/@apphome/GoogleAntigravityCLI/webui/src/modules/settings/SettingsSidebar.tsx)、[SettingsCard.tsx](file:///vol1/@apphome/GoogleAntigravityCLI/webui/src/modules/settings/SettingsCard.tsx)、[SettingsRow.tsx](file:///vol1/@apphome/GoogleAntigravityCLI/webui/src/modules/settings/SettingsRow.tsx)、[SettingsSection.tsx](file:///vol1/@apphome/GoogleAntigravityCLI/webui/src/modules/settings/SettingsSection.tsx)、[useSettingsController.ts](file:///vol1/@apphome/GoogleAntigravityCLI/webui/src/modules/settings/hooks/useSettingsController.ts)、[AgentCategoryTabsSection.tsx](file:///vol1/@apphome/GoogleAntigravityCLI/webui/src/modules/settings/tabs/agents-settings/sections/AgentCategoryTabsSection.tsx)、[AntigravityAccountManager.tsx](file:///vol1/@apphome/GoogleAntigravityCLI/webui/src/modules/settings/tabs/agents-settings/sections/content/AntigravityAccountManager.tsx)、[LanguageSelector.tsx](file:///vol1/@apphome/GoogleAntigravityCLI/webui/src/modules/i18n/LanguageSelector.tsx)、[PillBar.tsx](file:///vol1/@apphome/GoogleAntigravityCLI/webui/src/shared/ui/PillBar.tsx)：
  - 弹窗壳层支持 ESC / 遮罩关闭与云母圆角卡片风格；
  - 移动端顶部胶囊导航支持切换时自动横向居中滚动；
  - `SettingsRow` 与 `LanguageSelector` 支持 `flex-wrap` 自适应换行，解决窄屏与 `<select>` 挤压；
  - 修复 `KNOWN_MAIN_TABS` 漏掉 `'voice'` 问题，并将添加账号内嵌弹层调整为 `z-[9500]`。
- 新增单测：[src/modules/quick-settings-panel/tests/quickSettingsPanel.test.tsx](file:///vol1/@apphome/GoogleAntigravityCLI/webui/src/modules/quick-settings-panel/tests/quickSettingsPanel.test.tsx)

### 阶段 3：侧边栏抽屉与项目/会话卡片交互重构
- [src/modules/project-workspace/ProjectSidebarRegion.tsx](file:///vol1/@apphome/GoogleAntigravityCLI/webui/src/modules/project-workspace/ProjectSidebarRegion.tsx)：移动端抽屉改用 `rounded-r-3xl` 云母悬浮侧栏 + 模糊遮罩。
- [src/modules/sidebar/SidebarHeader.tsx](file:///vol1/@apphome/GoogleAntigravityCLI/webui/src/modules/sidebar/SidebarHeader.tsx)、[SidebarCollapsed.tsx](file:///vol1/@apphome/GoogleAntigravityCLI/webui/src/modules/sidebar/SidebarCollapsed.tsx)、[SidebarContent.tsx](file:///vol1/@apphome/GoogleAntigravityCLI/webui/src/modules/sidebar/SidebarContent.tsx)、[SidebarFooter.tsx](file:///vol1/@apphome/GoogleAntigravityCLI/webui/src/modules/sidebar/SidebarFooter.tsx)：
  - 统一桌面端/移动端顶部品牌与 4 模式（项目 / 对话 / 运行 / 归档）分段胶囊条，修复运行数字溢出边框问题；
  - 升级底部栏为一体化的「设置与版本」圆角卡片按钮。
- [src/modules/sidebar/SidebarProjectItem.tsx](file:///vol1/@apphome/GoogleAntigravityCLI/webui/src/modules/sidebar/SidebarProjectItem.tsx)、[SidebarProjectSessions.tsx](file:///vol1/@apphome/GoogleAntigravityCLI/webui/src/modules/sidebar/SidebarProjectSessions.tsx)、[SidebarSessionItem.tsx](file:///vol1/@apphome/GoogleAntigravityCLI/webui/src/modules/sidebar/SidebarSessionItem.tsx)、[SidebarRecentConversations.tsx](file:///vol1/@apphome/GoogleAntigravityCLI/webui/src/modules/sidebar/SidebarRecentConversations.tsx)：
  - 移除移动端项目行高对比小方框，统一云母卡片与左侧主色选中指示条；
  - 在移动端会话操作底部抽屉中补全 `Fork session` 能力，同时保持所有 `memo` / `Object.is` 测试契约。

### 阶段 4：对话画布去噪、底部悬浮输入窗与模型/思考抽屉重构
- [src/shared/types.ts](file:///vol1/@apphome/GoogleAntigravityCLI/webui/src/shared/types.ts)、[src/modules/chat/hooks/useComposerMenuAnchor.ts](file:///vol1/@apphome/GoogleAntigravityCLI/webui/src/modules/chat/hooks/useComposerMenuAnchor.ts)：扩展 `ComposerMenuAnchor` 支持左右锚定。
- [src/modules/chat/composer/ComposerMenuPrimitives.tsx](file:///vol1/@apphome/GoogleAntigravityCLI/webui/src/modules/chat/composer/ComposerMenuPrimitives.tsx)：升级为响应式双形态壳层（移动端 `< 640px` 底部 Bottom Sheet + 手柄 + 遮罩，桌面端高透云母浮层卡）。
- [src/modules/chat/composer/ComposerModelMenu.tsx](file:///vol1/@apphome/GoogleAntigravityCLI/webui/src/modules/chat/composer/ComposerModelMenu.tsx)：扩大触发胶囊宽度与高亮思考徽标；抽屉内部顶部采用横向分段思考胶囊（`默认 / Low / Medium / High / XHigh`），下方直接展开模型卡片列表。
- [src/modules/chat/composer/ComposerMoreMenu.tsx](file:///vol1/@apphome/GoogleAntigravityCLI/webui/src/modules/chat/composer/ComposerMoreMenu.tsx)（新建）：将上传附件、`/` 快捷命令、定时发送（含预设与自定义时间子视图）、思考翻译设置、Token 上下文摘要与清空草稿收纳进左侧 `+` 工具箱抽屉。
- [src/modules/chat/composer/ChatComposer.tsx](file:///vol1/@apphome/GoogleAntigravityCLI/webui/src/modules/chat/composer/ChatComposer.tsx)、[PromptInput.tsx](file:///vol1/@apphome/GoogleAntigravityCLI/webui/src/modules/chat/composer/PromptInput.tsx)、[ComposerPermissionMenu.tsx](file:///vol1/@apphome/GoogleAntigravityCLI/webui/src/modules/chat/composer/ComposerPermissionMenu.tsx)、[ScheduleMessagePopover.tsx](file:///vol1/@apphome/GoogleAntigravityCLI/webui/src/modules/chat/composer/ScheduleMessagePopover.tsx)、[TokenUsageSummary.tsx](file:///vol1/@apphome/GoogleAntigravityCLI/webui/src/modules/chat/composer/TokenUsageSummary.tsx)：重构底栏布局，移动端释放模型与发送键触控空间，桌面端保留核心直达工具。
- [src/modules/chat/transcript/ChatMessagesPane.tsx](file:///vol1/@apphome/GoogleAntigravityCLI/webui/src/modules/chat/transcript/ChatMessagesPane.tsx)、[ChatExportMenu.tsx](file:///vol1/@apphome/GoogleAntigravityCLI/webui/src/modules/chat/transcript/ChatExportMenu.tsx)、[ChatInterface.tsx](file:///vol1/@apphome/GoogleAntigravityCLI/webui/src/modules/chat/ChatInterface.tsx)：移除会跟着滚动遮挡气泡文字的 `sticky` 导出按钮，改为消息流顶端流式呈现；升级悬浮「回到底部」按钮为高透胶囊芯片。
- 新增单测：[src/modules/chat/tests/composerModelMenu.test.tsx](file:///vol1/@apphome/GoogleAntigravityCLI/webui/src/modules/chat/tests/composerModelMenu.test.tsx)

---

## 2. 实际执行的最终验证命令与观测输出
1. **定向 Lint 自检**：
   - `npx oxlint src/modules/chat/composer/ComposerMoreMenu.tsx src/modules/sidebar/SidebarHeader.tsx src/modules/quick-settings-panel/QuickSettingsPanelView.tsx src/modules/chat/tests/composerModelMenu.test.tsx src/modules/quick-settings-panel/tests/quickSettingsPanel.test.tsx` -> `Found 0 warnings and 0 errors.`
2. **TypeScript 类型校验**：
   - `npm run typecheck` -> `tsc --noEmit -p tsconfig.json && tsc --noEmit -p server/tsconfig.json` 退出码 `0`。
3. **15 个关联前端测试文件全量回归**：
   - `npx vitest run src/modules/quick-settings-panel/tests/quickSettingsPanel.test.tsx src/modules/chat/tests/composerModelMenu.test.tsx src/modules/chat/tests/promptInputSubmit.test.tsx src/modules/chat/tests/agentExecutionStepsRender.test.tsx src/modules/chat/tests/composerDraftScoping.test.tsx src/modules/chat/tests/composerToolsSettingsResolution.test.ts src/modules/chat/tests/chatProviderModels.test.ts src/modules/sidebar/tests/ src/modules/settings/tests/ src/modules/project-workspace/tests/`
   - 实际结果：`Test Files  15 passed (15)`，`Tests  65 passed (65)`。
4. **全量构建与线上静态包检测**：
   - `npm run build` -> 成功生成前端产物 `dist/assets/index-D35M75g7.js` 与 `dist/index.html`（Nov 24 22:51），并完成 `build:server` 与 `promote-dist-server.mjs`。
   - `curl -s http://127.0.0.1:3100/ | grep -oE "index-[A-Za-z0-9_-]+\.js"` -> 输出 `index-D35M75g7.js`，证实 `3100` 服务已即时向页面提供最新前端构建产物。
