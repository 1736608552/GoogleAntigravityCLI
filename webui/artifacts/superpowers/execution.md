# 执行与验证记录 (防止任务提前自动结束修复)

- **修改文件**：
  - `webui/run-3100-server.sh`：`AGY_PRINT_TIMEOUT` 默认由 `15m` 改为 `0`（等待回合自然结束）。
  - `webui/server/modules/providers/list/antigravity/antigravity-runtime.provider.ts`：
    1. 默认 `--print-timeout` 由 `'15m'` 改为 `'0'`；
    2. 看门狗阈值放宽为长程/子代理/工具等待期间 `1_800_000ms`（30 分钟）、普通 `600_000ms`（10 分钟），且触发超时时不再置 `turnHasSucceeded = true`，改为转为可恢复暂停或超时中断；
    3. 移除 `accumulatedText > 0` 时直接 `break` 吞错逻辑，若输出部分正文后发生断流/看门狗中断，准确走 `stream was interrupted before the response finished` 交由 `isRecoverableStreamPause` 保留进度并提示用户接续；
    4. `finishSuccess()` 收到 CLI `result` 后延迟 `1500ms` 优雅 `stdin.end()` 并用 `.unref()` 定时器收尾，减少跨轮 `pkill -9` 触发 `[Notice] ... due to server restart`。
  - `webui/server/modules/providers/tests/antigravity-runtime.test.ts`：
    1. 新增 `runAntigravityTurnOnce defaults --print-timeout to 0 and cleanly closes stdin after result`；
    2. 修复第 3 项既有测试未等待 `resolveAntigravityProxyEnv` 异步完成后 `spawnImpl` 调用的时序竞争。
- **验证命令与实测结果**：
  - `npx tsx --tsconfig server/tsconfig.json --test --test-force-exit server/modules/providers/tests/antigravity-runtime.test.ts`：`pass 8, fail 0`。
  - `npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/antigravity-accounts-reset.test.ts server/modules/providers/tests/antigravity-models.test.ts server/modules/providers/tests/antigravity-sessions.test.ts`：`pass 8, fail 0`。
  - `npm run typecheck`：退出码 `0`。
  - `npx oxlint server/modules/providers/list/antigravity/antigravity-runtime.provider.ts server/modules/providers/tests/antigravity-runtime.test.ts`：`Found 3 warnings and 0 errors`。
  - `npm run build`：退出码 `0`，成功更新 `dist/` 与 `dist-server/`。
