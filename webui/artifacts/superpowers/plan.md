# Antigravity 任务频繁自动结束修复规划

## 问题根因
1. `run-3100-server.sh` 与 `antigravity-runtime.provider.ts` 默认 `--print-timeout` 均设为了 `15m`（而 CLI `--help` 实测 `0` 为无限制等待回合自然结束）。
2. 看门狗超时过短（`360s/600s`），未把“正在等待工具结果”计入长程模式，且超时时若 `turnEmitted` 非空直接置 `turnHasSucceeded = true; finishSuccess()` 把未完成任务当成功结束。
3. 外层 `catch` 在 `accumulatedText` 非空时直接 `break` 且未进入可恢复暂停逻辑，导致中途断开时既不重试也未能明确提示断点继续。
4. 跨轮次未在 `result` 后优雅关闭 `stdin`，下轮直接 `pkill -9` 强杀遗留进程，导致新 CLI 启动必注入 `[Notice] ... due to server restart.`。

## 修复内容
- 修改 `webui/run-3100-server.sh` 与 `server/modules/providers/list/antigravity/antigravity-runtime.provider.ts` 默认 `--print-timeout` 为 `'0'`。
- 将看门狗普通阈值放宽至 `600_000ms`，长程/子代理/工具等待期间放宽至 `1_800_000ms`；看门狗触发时一律走异常/可恢复中断分支，绝不伪造 `turnHasSucceeded = true`。
- 移除 `accumulatedText` 非空直接 `break` 吞错逻辑，遇到中断且已有部分正文输出时转为 `stream was interrupted before the response finished` 交由既有 `isRecoverableStreamPause` 提示用户继续。
- 在 `finishSuccess()` 结算后通过 `.unref()` 定时器优雅关闭 `stdin.end()` 引导 CLI 正常退出。
- 在 `antigravity-runtime.test.ts` 新增对应测试，完成 `typecheck`、`oxlint`、`npm run build` 并重启 3100 服务上线。
