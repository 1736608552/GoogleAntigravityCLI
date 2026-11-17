# 修复计划 (Implementation Plan)

## 任务目标
1. **修复添加 Google 账号报错**：解决用户在 WebUI 网页 OAuth 授权提交验证码后，提示 `Token 中未解析到有效的 Google 账号邮箱，请重新授权` 的缺陷。
2. **修复关闭桌宠后残留空白气泡**：解决用户在“设置-外观”关闭哈基米桌宠伴侣后，屏幕右上角常驻残留淡紫色边框空白对话框的缺陷。

## 方案拆解与文件修改
1. **服务端 Google 账号邮箱解析兜底** (`server/modules/providers/list/antigravity/antigravity-accounts.service.ts`)：
   - 健壮化 `parseJwtPayload`：支持标准 Base64URL 解码与 UTF-8 容错。
   - 实现 `fetchGoogleUserInfo`：当从 JWT（id_token）无法获取 `email` 时，使用 `access_token` 自动向 Google 官方 `https://www.googleapis.com/oauth2/v3/userinfo` 及 `https://oauth2.googleapis.com/tokeninfo` 发送反向查询请求，兜底提取真实邮箱、显示名称及头像。
   - 适配 token 数据结构多层级容错（兼容直接对象与嵌套 `token.id_token`）。
2. **前端桌宠隐藏全链路阻断** (`src/modules/pet/engine/hagemiEngine.js` 与 `src/modules/pet/hooks/useHagemiDirector.ts`)：
   - 在 `applyVisibility` 中，当 `settings.hidden` 时不仅隐藏主舞台，同时强制将 `bubble`（对话气泡）、`hud`（状态栏）、`menu`（右键菜单）全部设为 `display: none`。
   - 在 `startSpeech`、`stepSpeech`、`case 'say'`、`trySay` 中增加状态阻断门禁，隐藏/禁用状态下严禁将消息推入播放队列，严禁执行 `bubble.classList.add('show')`。
   - 在关闭时清空 `speechQueue` 并重置 `bubbleText`，彻底消灭孤立悬浮气泡。

## 验证与发布
1. `npx tsc --noEmit` 静态类型检查。
2. `npm run build:server` 服务端编译发布到 `dist-server/`。
3. `npm run build:client` 前端生产打包发布到 `dist/`。
4. 重启 3100 服务进程使最新后端生效。
5. 提交 Git 并推送到远程仓库。
