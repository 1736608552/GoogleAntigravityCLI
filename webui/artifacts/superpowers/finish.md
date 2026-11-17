# 最终交付与收尾报告 (Finish & Delivery Report)

## 问题修复清单

| 序号 | 用户反馈问题 | 根因分析 | 解决方案 | 状态 |
| :--- | :--- | :--- | :--- | :--- |
| 1 | **添加账号时报错：`Token 中未解析到有效的 Google 账号邮箱，请重新授权`** | 1. Google 授权返回的 `id_token` 采用了 Base64URL 编码，原有解码未做补齐处理导致提取 payload 异常；<br>2. 部分授权返回数据结构将 token 嵌套在 `token.id_token`；<br>3. 原代码完全依赖客户端解码本地 JWT，缺少 Google 官方端点兜底反查机制。 | 1. 完善 Base64URL 规范化解码；<br>2. 兼容外层及嵌套层级的 `id_token`；<br>3. 引入 Google 官方 `userinfo` 与 `tokeninfo` 接口网络兜底，用 `access_token` 实时反查真实邮箱与个人信息。 | **已彻底修复并生效** |
| 2 | **关闭桌宠后右上角残留淡紫色空白气泡** | 桌宠 DOM 结构中 `bubble` 与 `stage` 属于平级兄弟节点，此前 `applyVisibility` 仅将舞台设为 `display: none`，未隐藏气泡；且舞台隐藏后跳过了主循环动画，导致气泡内的打字机和关闭计时器停滞，气泡永久悬挂。 | 1. `applyVisibility` 时联动隐藏 `bubble`、`hud`、`menu`；<br>2. 关闭桌宠时清空 `speechQueue` 并主动调用 `closeBubble()`；<br>3. 隐藏及禁用状态下拦截所有 `say` / `startSpeech` 调用，杜绝气泡挂载。 | **已彻底修复并生效** |

## 安全与代码审查 (Code Review Pass)
- [x] **Blocker 级别**：无内存泄露、无阻塞式无限重试、无未捕获异常。
- [x] **Major 级别**：Google 接口请求已配置合理超时，失败时优雅降级并输出明确中文日志。
- [x] **Minor 级别**：清理冗余代码与无效分支，确保前后端 TypeScript 静态检查 0 报错。
- [x] **Nit 级别**：规范化编码与模块职责，符合前后端架构规范。

## 零残留与端口守则检查
- 无遗留临时进程或调试脚本；
- 严格遵守 19999 端口反重力隔离守则，未发生任何探测或借用；
- 远程仓库同步完成：`9706851`。
