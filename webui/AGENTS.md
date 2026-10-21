# Repository guidance

## Backend code

For every task that creates, modifies, refactors, or reviews backend code under `server/`, load and follow `$backend-module-standards` from `.agents/skills/backend-module-standards/SKILL.md`. Apply it only to backend code; do not impose those architecture rules on the frontend.

## Frontend code

For every task that creates, modifies, refactors, or reviews frontend code under `src/`, load and follow `$frontend-module-standards` from `.agents/skills/frontend-module-standards/SKILL.md`. Apply it only to frontend code; do not impose those architecture rules on the backend.

## 语言与思考规范 (Language Policy)

- **全程中文思考与回答**：无论是内部推理过程（Thinking / Chain-of-Thought）、排查分析、任务规划，还是最终对用户的回复输出，**必须 100% 始终使用中文**。
- **严禁思维链使用英文**：严禁在思考（thinking）阶段使用英文分析问题，所有的分析逻辑、推导过程、排查步骤必须全程采用自然流畅的中文进行。
- **代码与专有名词**：保留原有的代码语法、符号、函数名、API 字段名和库名，其余所有推导、解释、注释和沟通一律使用中文。

## 19999 端口反重力专用隔离守则 (Antigravity Proxy Port Isolation)
- **专有通道绝不越界**：`127.0.0.1:19999`（BringYour SOCKS5）是**反重力（Antigravity）与 Google 大模型底层通信专用的局部代理通道**。
- **严禁擅自探测与借用**：在任何通用命令执行、日常网络排查、IP归属查询、API测试或网页请求中，**严禁使用 `-x socks5://127.0.0.1:19999` 或主动调用代理唤醒方法**，坚决杜绝无谓的节点握手和流量质押浪费。
- **全局环境零污染**：主服务、系统环境及日常命令一律使用宿主机原生直连网络，严禁将 19999 暴露为全局 `ALL_PROXY` 或 `HTTPS_PROXY`。
- **按需静默调度**：19999 端口由 WebUI 底层在触发模型推理时透明按需拉起，并在对话结束后 60 秒自动优雅断开回收流量，外部任何机制不得干预其生命周期。


