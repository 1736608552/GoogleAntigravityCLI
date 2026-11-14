/**
 * Reasoning Translate - Translation Engines
 * 支持 Ollama 本地引擎、OpenAI 兼容通用端点及 Antigravity 模型通道
 */
export const DEFAULT_GLOSSARY = [
    'Antigravity', 'AGY', 'Google', 'Gemini', 'Claude', 'DeepSeek', 'OpenAI',
    'npm', 'pnpm', 'Node', 'React', 'TypeScript', 'JavaScript', 'Python', 'Docker',
    'Ollama', 'MCP', 'API', 'JSON', 'YAML', 'CSS', 'HTML', 'DOM', 'Git', 'GitHub',
    'TODO', 'FIXME', 'OK', 'Token', 'SOCKS5', 'Proxy',
    'slot registry', 'assistant-step', 'renderer', 'bundle',
    'reasoning', 'thinking', 'stream', 'chunk', 'hook', 'session',
];
export function translationSystemPrompt(options = {}) {
    const glossary = [...DEFAULT_GLOSSARY, ...(options.glossary ?? [])].join(', ');
    return [
        '你是专业的技术推理文本翻译器。把你收到的英文思考过程片段翻译成简体中文。',
        '',
        '核心铁律：',
        '1. 仅输出翻译后的中文本身。严禁任何寒暄、开场白、解释说明、前缀、标头，不要用 Markdown 代码块包裹整段译文。',
        '2. 严格保持原有 Markdown 格式与排版：列表符号、编号、缩进、换行、行内代码块完全一致。',
        '3. 术语与技术专有名词保持原样：' + glossary + '；代码变量名、函数名、文件名、CLI 命令及参数严禁翻译。',
        '4. 忠实原文：严禁添加原文未包含的臆测或括号补充。',
        '5. 流式片段（半句话）时，直接直译这半句话，不要擅自补全后续内容。',
        '',
        '示例：',
        '原文: The user wants to translate reasoning streaming text. Let me check the registry.',
        '译文: 用户想要实时翻译流式推理文本。先检查一下 registry。',
    ].join('\n');
}
export function stripThinking(text) {
    if (typeof text !== 'string')
        return '';
    return text
        .replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '')
        .replace(/^\s*<think(?:ing)?>[\s\S]*$/i, '')
        .trim();
}
export function createEngine(options) {
    const engineType = options.engine || 'ollama';
    const config = options.config || {};
    const timeoutMs = Number.isFinite(config.timeoutMs) ? config.timeoutMs : 30_000;
    const temperature = Number.isFinite(config.temperature) ? config.temperature : 0;
    if (engineType === 'ollama') {
        const baseURL = String(config.baseURL || 'http://127.0.0.1:11434').replace(/\/+$/, '');
        const model = config.model || 'qwen2.5:1.5b';
        return {
            id: 'ollama',
            label: `Ollama (${model})`,
            async chat({ system, user, signal }) {
                const body = {
                    model,
                    stream: false,
                    think: false,
                    keep_alive: config.keepAlive ?? '30m',
                    messages: [
                        { role: 'system', content: system },
                        { role: 'user', content: user },
                    ],
                    options: {
                        temperature,
                        num_predict: config.maxTokens ?? 1024,
                        num_ctx: Number.isFinite(config.numCtx) ? config.numCtx : 4096,
                    },
                };
                const controller = new AbortController();
                const timer = setTimeout(() => controller.abort(), timeoutMs);
                try {
                    signal?.addEventListener('abort', () => controller.abort(), { once: true });
                    const res = await fetch(`${baseURL}/api/chat`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(body),
                        signal: controller.signal,
                    });
                    if (!res.ok) {
                        const errText = await res.text();
                        throw new Error(`Ollama HTTP ${res.status}: ${errText.slice(0, 200)}`);
                    }
                    const json = await res.json();
                    return stripThinking(json?.message?.content ?? '');
                }
                finally {
                    clearTimeout(timer);
                }
            },
        };
    }
    if (engineType === 'openai-compatible' || engineType === 'antigravity') {
        const baseURL = String(config.baseURL || 'https://api.openai.com/v1').replace(/\/+$/, '');
        const model = config.model || 'gpt-4o-mini';
        const headers = { 'Content-Type': 'application/json' };
        if (config.apiKey) {
            headers.Authorization = `Bearer ${config.apiKey}`;
        }
        return {
            id: engineType,
            label: `${config.displayName || 'OpenAI-Compatible'} (${model})`,
            async chat({ system, user, signal }) {
                const body = {
                    model,
                    stream: false,
                    temperature,
                    max_tokens: config.maxTokens ?? 1024,
                    enable_thinking: false, // 禁用翻译时的额外推理链，加速响应
                    messages: [
                        { role: 'system', content: system },
                        { role: 'user', content: user },
                    ],
                };
                const controller = new AbortController();
                const timer = setTimeout(() => controller.abort(), timeoutMs);
                try {
                    signal?.addEventListener('abort', () => controller.abort(), { once: true });
                    const res = await fetch(`${baseURL}/chat/completions`, {
                        method: 'POST',
                        headers,
                        body: JSON.stringify(body),
                        signal: controller.signal,
                    });
                    if (!res.ok) {
                        const errText = await res.text();
                        throw new Error(`${baseURL} HTTP ${res.status}: ${errText.slice(0, 200)}`);
                    }
                    const json = await res.json();
                    const rawOutput = json?.choices?.[0]?.message?.content || json?.choices?.[0]?.message?.text || '';
                    return stripThinking(rawOutput);
                }
                finally {
                    clearTimeout(timer);
                }
            },
        };
    }
    throw new Error(`不支持的翻译引擎类型: ${engineType}`);
}
export async function probeEngine(engine) {
    const started = Date.now();
    try {
        const text = await engine.chat({
            system: 'You are a translator. Only reply with the single word: ready',
            user: 'ready',
        });
        return { ok: true, ms: Date.now() - started, sample: String(text).slice(0, 100) };
    }
    catch (error) {
        return { ok: false, ms: Date.now() - started, error: error instanceof Error ? error.message : String(error) };
    }
}
//# sourceMappingURL=engine.service.js.map