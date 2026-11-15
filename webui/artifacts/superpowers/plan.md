# 实施计划：为桌宠设置面板新增 API 与 Key 输入，并补全推理模型列表

## 1. 用户诉求与痛点
- 用户在【哈基米设置】面板中看到了【AI 动态吐槽】与【推理模型】等配置；
- 但由于开源项目原作者原本是为本地 CLI 旁路设计的，**原版代码中完全缺失了 API 接口地址与 API Key 的输入框**，且【推理模型】下拉列表未注入可用模型；
- 用户希望知道在哪里输入 API 和 Key，并能真正配置和使用 AI 模型。

## 2. 解决方案
1. **在设置面板 `openPanel` 中新增输入项**：
   - `apiBaseUrl`：API 端点地址（例如 `https://api.siliconflow.cn/v1` 或 `https://api.openai.com/v1`，提示“留空则默认复用系统模型”）；
   - `apiKey`：API Key 密钥输入框（密码隐藏输入，防止泄露）；
   - 预设精选模型列表：注入 `gemini-2.5-flash`、`deepseek-chat`、`Qwen/Qwen2.5-7B-Instruct`、`claude-3-5-sonnet` 等，且支持自定义模型名输入。
2. **数据持久化与打通**：
   - 在 `settings.ai` 中保存 `apiKey` 与 `apiBaseUrl`，并通过 `localStorage` 或桌宠设置存储安全持久化；
   - 在 `useHagemiDirector.ts` 中向桌宠发送 `pet.receive({ t: 'models', models: [...] })`，将系统当前支持的模型列表传入桌宠。
3. **构建与自检验证**：
   - 运行 `npx tsc --noEmit` 校验；
   - 运行 `npm run build` 全量打包；
   - 答复用户并清晰说明原作者机制与当前新增的输入方式。
