# WebUI 全面交互重设计实施计划（Superpowers Plan）

## 1. 重设计核心目标
基于实机移动端截图痛点反馈与全面前端代码调研，将当前 WebUI 从「早期桌面 IDE 拼装风」升级为**「卡片化云母浮岛 2.0（移动端单手友好 + 桌面端宽屏自适应）」**，全面覆盖：
1. **顶部导航与主画布去噪**（消除遮挡文字的边缘浮标与压屏 sticky 下载按钮）；
2. **底部悬浮输入视窗与模型/深度思考抽屉重构**（彻底解决 7 个控件挤一行与半屏细长竖框痛点）；
3. **侧边栏交互重塑**（圆角悬浮抽屉、柔和分段筛选、统一会话触控操作卡片、清爽底栏）；
4. **设置中心与快捷控制台重构**（取消右侧常驻 `<` 把手，顶栏统一唤起现代 Switch 控制中心；设置弹窗窄屏自动响应与居中导航胶囊；修复 `voice` Tab 路由遗漏与 `z-index` 冲突）；
5. **气泡与执行步骤卡片视觉对齐**，全量校验并重启 `3100` 服务生效。

---

## 2. 分阶段实施清单与精准验证命令

### 步骤 1：设计令牌、全局基础样式与快捷控制中心状态联动
- **修改范围**：
  - `src/index.css`：优化云母表面质感类、底抽屉滑入与微缩放动画、柔和分割线样式。
  - `src/modules/project-workspace/context/ProjectsStateContext.tsx` & `src/modules/project-workspace/hooks/useProjectsState.ts`（或通过 `ProjectWorkspaceShell` / `ProjectMainRegion` 联动）：增加 `quickSettingsOpen` / `toggleQuickSettings` 轻量状态，打通顶栏入口与快捷控制台开关，无需常驻右边缘 `<` 把手压住正文。
  - `src/modules/project-workspace/WorkspaceHeader.tsx` & `WorkspaceTabs.tsx` & `MobileMenuButton.tsx`：美化顶栏毛玻璃与左右分布，右侧集成「快捷控制台」按钮。
- **验证命令**：`npm run typecheck`

### 步骤 2：快捷控制中心 & 设置中心全面交互重构
- **修改范围**：
  - `src/modules/quick-settings-panel/`：
    - `QuickSettingsPanelView.tsx`：支持由 `ProjectWorkspaceShell` 受控打开（隐藏默认压屏 `QuickSettingsHandle`），升级为桌面悬浮圆角面板 + 移动顺滑滑出抽屉，统一 `z-index`（遮罩与面板严格分层，新增 `ESC` 关闭，并包含直达「完整设置」入口）。
    - `QuickSettingsContent.tsx` & `QuickSettingsToggleRow.tsx`：用现代物理 Switch 拨片替换生硬原生 checkbox，卡片式分段分组。
  - `src/modules/settings/`：
    - `Settings.tsx`：升级圆角云母大弹窗质感（桌面端宽屏更舒展、移动端全屏平滑顶栏与保存提示胶囊），理顺层级 `z-[9000]`。
    - `SettingsSidebar.tsx`：桌面端左侧栏增加清晰高亮指示与分类视觉；移动端横向药丸条增加自动居中滚动（`scrollIntoView`）与左右渐隐过渡，解决遮挡问题。
    - `SettingsCard.tsx` / `SettingsRow.tsx` / `SettingsSection.tsx` / `SettingsToggle.tsx` & `src/modules/i18n/LanguageSelector.tsx`：实现真正的卡片留白与长控件在窄屏下优雅垂直折行。
    - `hooks/useSettingsController.ts`：修正 `KNOWN_MAIN_TABS` 补齐 `'voice'`，与 `NAV_ITEMS` 保持一致。
    - `tabs/agents-settings/sections/content/AntigravityAccountManager.tsx`：微调内嵌添加账号弹窗 `z-[9500]` 与 ESC/遮罩关闭体验。
- **验证命令**：
  - `npx vitest run src/modules/settings/tests/`
  - `npm run typecheck`

### 步骤 3：侧边栏全面交互重构
- **修改范围**：
  - `src/modules/project-workspace/ProjectSidebarRegion.tsx`：移动端抽屉升级为 `rounded-r-3xl` 云母悬浮抽屉 + 柔和模糊背景遮罩；桌面端边界与主背景和谐融合。
  - `src/modules/sidebar/Sidebar.tsx`、`SidebarCollapsed.tsx`：统一云母表面、微动效图标与状态提示。
  - `src/modules/sidebar/SidebarHeader.tsx`：重塑顶部品牌行与操作区，升级 4 模式（项目/对话/运行/归档）柔和分段胶囊条（修复运行中角标溢出问题）与无边框聚焦搜索栏。
  - `src/modules/sidebar/SidebarProjectItem.tsx` & `SidebarSessionItem.tsx` & `SidebarRecentConversations.tsx`：
    - 严格保持传给子行组件及 `SessionOptions` 的所有 props 名称与 `Object.is` 引用不可变契约；
    - 升级项目与会话卡片圆角、左侧蓝色当前选中指示条、柔和触控热区；
    - 在 `SidebarSessionItem` 移动端底部操作抽屉中补齐 `Fork session` 能力，去除移动端项目行刺眼纯色边框小方块。
  - `src/modules/sidebar/SidebarFooter.tsx`：重设计为优雅的系统提示 + 设置胶囊卡。
- **验证命令**：
  - `npx vitest run src/modules/sidebar/tests/`
  - `npm run typecheck`

### 步骤 4：对话主画布去噪、底部悬浮输入窗与模型/思考抽屉重构
- **修改范围**：
  - `src/modules/chat/transcript/ChatMessagesPane.tsx` & `src/modules/chat/ChatInterface.tsx`：
    - 移除压在滚动消息右上角的 sticky `ChatExportMenu` 挡字问题，改在对话顶部轻量流式工具条呈现；
    - 升级悬浮「回到底部」按钮为高透紧凑胶囊条。
  - `src/modules/chat/composer/PromptInput.tsx` & `ChatComposer.tsx`：
    - 重构底部工具栏为「极简克制单手友好栏」：左侧 `+` 多功能创作工具箱（点击浮层收拢附件、`/` 指令、定时发送、翻译设置、Token 详细用量胶囊），中央主展示清晰无截断的「模型 · 思考档位」胶囊 + 权限模式胶囊，右端 40×40px 大触控发送/停止按钮；语音按钮按可用状态紧邻配置。
  - `src/modules/chat/composer/ComposerMenuPrimitives.tsx`、`ComposerModelMenu.tsx`、`ComposerPermissionMenu.tsx`、`ScheduleMessagePopover.tsx`：
    - 实现移动端自适应 **Bottom Sheet 底部半屏抽屉**（带手柄条、柔和遮罩、安全区内边距、流畅动画）+ 桌面端锚定高透云母菜单；
    - 重设计 `ComposerModelMenu`：**顶部直接横向并排显示「深度思考（推理）」分段胶囊（默认/Low/Med/High/XHigh 一眼点选），下方直接展开高颜值模型卡片列表**，一键直达不再折叠隐藏。
- **验证命令**：
  - `npx vitest run src/modules/chat/tests/`
  - `npm run typecheck`

### 步骤 5：全量自动化审查、测试与构建生效
- 遵守 `.agents/skills/frontend-module-standards/SKILL.md` 检查全部触及文件中的 `@/...` 导入规范、`type` 别名、导出注释、状态注释、跨模块 `index.ts` 导入；
- 执行全量验证：
  - `npm run test:client`
  - `npm run typecheck`
  - `npm run lint`（若项目配置了 lint）
  - `npm run build`
- 写入 `artifacts/superpowers/execution.md` 与 `artifacts/superpowers/finish.md`，平滑重启 `3100` 服务使新 `dist/` 上线生效并实测 `HTTP/1.1 200 OK`。
