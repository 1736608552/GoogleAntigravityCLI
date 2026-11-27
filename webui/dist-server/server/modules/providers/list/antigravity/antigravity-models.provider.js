import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { buildDefaultProviderCurrentActiveModel } from '../../../../shared/utils.js';
import { resolveAntigravityBinary } from './antigravity-auth.provider.js';
const execFileAsync = promisify(execFile);
/**
 * 静态兜底反重力模型目录。
 * 仅在官方 Antigravity CLI 尚未生成缓存、发生网络超时或处于完全离线环境时作为保底使用。
 * 正常运行时的模型清单**一律以实时拉取结果为准**（见 fetchLiveAntigravityModels），本表不参与排序或默认值决策。
 * 聚合规则：Gemini 系列的各档位变体（-low/-medium/-high/-xhigh）在实时解析时会被收敛为单一基础模型，
 * 档位交给前端顶部「深度思考」菜单调控，不在模型列表中重复展示。
 */
export const ANTIGRAVITY_FALLBACK_MODELS = {
    OPTIONS: [
        {
            value: 'gemini-4-hydrogen',
            label: 'Gemini 4 Hydrogen',
            description: 'Google DeepMind 旗舰深度推理模型，支持顶部 Low/Medium/High 思考档位。',
            effort: {
                values: [{ value: 'low' }, { value: 'medium' }, { value: 'high' }, { value: 'xhigh' }],
                default: 'high',
            },
        },
        {
            value: 'gemini-3.8-flash',
            label: 'Gemini 3.8 Flash',
            description: 'Google DeepMind 轻量快速模型，支持顶部 Low/Medium/High 思考档位。',
            effort: {
                values: [{ value: 'low' }, { value: 'medium' }, { value: 'high' }],
                default: 'high',
            },
        },
        {
            value: 'claude-sonnet-4-6',
            label: 'Claude Sonnet 4.6 (Thinking)',
            description: 'Anthropic Claude Sonnet 4.6 深度思考模型，通过 Google Antigravity 原生调度。',
        },
        {
            value: 'claude-opus-4-6-thinking',
            label: 'Claude Opus 4.6 (Thinking)',
            description: 'Anthropic Claude Opus 4.6 旗舰超强思考模型，通过 Google Antigravity 原生调度。',
        },
        {
            value: 'gpt-oss-120b-medium',
            label: 'GPT-OSS 120B (Medium)',
            description: '开源高规格 120B 大语言模型，通过 Google Antigravity 原生调度。',
        },
    ],
    DEFAULT: 'gemini-4-hydrogen',
};
/** 保持历史导出兼容 */
export const ANTIGRAVITY_PREDEFINED_MODELS = ANTIGRAVITY_FALLBACK_MODELS;
/** 内存缓存 TTL，设定为 60 秒，避免前端短时间内高频重复调用 CLI 进程 */
const MODEL_CACHE_TTL_MS = 60_000;
let cachedModelsDefinition = null;
let lastFetchedTimestamp = 0;
let inFlightFetchPromise = null;
/**
 * 解析官方 Antigravity CLI `antigravity models` 命令的实时标准输出。
 * 核心设计：
 * 将 Gemini 系列的各档位变体 (gemini-3.8-flash-high/medium/low) 聚合为单一基础模型 (gemini-3.8-flash)，
 * 并装配 Low/Medium/High 思考档位，供顶部“深度思考 (推理)”菜单调控，
 * 绝不在下方的“模型”列表中重复展示各档位变体。
 */
export function parseAntigravityModelsOutput(rawStdout) {
    const lines = rawStdout.split('\n');
    const rawItems = [];
    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line || line.startsWith('Fetching')) {
            continue;
        }
        const parts = line.split(/\t+|\s{2,}/);
        const id = parts[0]?.trim();
        if (!id)
            continue;
        const label = parts.slice(1).join(' ').trim() || id;
        rawItems.push({ id, label });
    }
    if (rawItems.length === 0) {
        return ANTIGRAVITY_FALLBACK_MODELS;
    }
    // 1. 扫描与归纳 Gemini 系列的基础模型与支持的 effort
    const geminiBases = new Map();
    // 记录非 effort 衍生的独立模型（如 Claude、GPT-OSS 等）
    const standaloneItems = [];
    for (const item of rawItems) {
        const { id, label } = item;
        if (id.startsWith('gemini-')) {
            const match = id.match(/^(.+)-(xhigh|high|medium|low|max)$/i);
            if (match) {
                const baseId = match[1];
                const effortVal = match[2].toLowerCase();
                // 剥离 label 中的 (XHigh)/(High)/(Medium)/(Low)/(Max) 标识作为基础模型 label
                const cleanLabel = label.replace(/\s*\((?:XHigh|High|Medium|Low|Max)\)\s*/i, '').trim() || baseId;
                if (!geminiBases.has(baseId)) {
                    geminiBases.set(baseId, {
                        baseId,
                        baseLabel: cleanLabel,
                        efforts: new Set([effortVal]),
                    });
                }
                else {
                    geminiBases.get(baseId).efforts.add(effortVal);
                }
                // 关键：带有 -xhigh/-high/-medium/-low/-max 后缀的衍生变体跳过，绝不单独加入模型列表！
                continue;
            }
            else {
                // 无后缀的 gemini 原生基础条目
                if (!geminiBases.has(id)) {
                    geminiBases.set(id, {
                        baseId: id,
                        baseLabel: label,
                        efforts: new Set(['low', 'medium', 'high']),
                    });
                }
                continue;
            }
        }
        // 三方或独立模型
        standaloneItems.push(item);
    }
    const options = [];
    // 2. 将聚合后的 Gemini 基础模型加入列表（排在最前面）
    //    顺序完全沿用 CLI 返回顺序，不做任何人工重排：官方把最新旗舰放在最前。
    for (const [baseId, baseInfo] of geminiBases.entries()) {
        const effortValues = ['low', 'medium', 'high', 'xhigh', 'max'].filter((e) => baseInfo.efforts.has(e));
        const effectiveEfforts = effortValues.length > 0 ? effortValues : ['low', 'medium', 'high'];
        options.push({
            value: baseId,
            label: baseInfo.baseLabel,
            description: `Google DeepMind 官方反重力模型，支持顶部深度思考 (${effectiveEfforts
                .map((v) => v.charAt(0).toUpperCase() + v.slice(1))
                .join('/')}) 档位调控。`,
            effort: {
                values: effectiveEfforts.map((v) => ({ value: v })),
                default: effectiveEfforts.includes('high') ? 'high' : effectiveEfforts[effectiveEfforts.length - 1],
            },
        });
    }
    // 注意：这里刻意不再「凭空插入一个硬编码 Gemini 模型」。
    // 若实时列表里一个 Gemini 都没有（例如账号仅开通了三方模型），就如实展示三方模型，
    // 由 pickPreferredDefaultModel 退化为取列表首项——绝不让界面出现实际不可调用的模型。
    // 3. 将三方模型与独立模型加入列表
    for (const item of standaloneItems) {
        const { id, label } = item;
        const isClaude = id.toLowerCase().includes('claude');
        const isGpt = id.toLowerCase().includes('gpt') || id.toLowerCase().includes('oss');
        let description = '';
        if (isClaude) {
            description = 'Anthropic 官方思考模型，通过 Google Antigravity 原生调度。';
        }
        else if (isGpt) {
            description = '开源大语言模型，通过 Google Antigravity 原生调度。';
        }
        else {
            description = 'Google Antigravity 实时可用模型。';
        }
        options.push({
            value: id,
            label,
            description,
            effort: undefined, // 三方模型绝不配置 effort，防止 CLI 报错
        });
    }
    // 默认模型：完全从「实时列表」推导，不再维护任何硬编码模型名清单。
    // 历史问题：此处曾写死 'gemini-3.8-flash'，导致所有新会话静默跑在上一代轻量模型上，
    // 用户主观感受就是「模型变笨」；而模型列表本身一直是实时的，所以写死 DEFAULT 才会与线上能力脱节。
    const defaultModel = pickPreferredDefaultModel(options);
    return {
        OPTIONS: options,
        DEFAULT: defaultModel,
    };
}
/**
 * 默认模型的选取规则（不出现任何硬编码模型 ID，全部基于实时列表推导）：
 *
 * 1. 只看 Gemini 基础模型（带 effort 档位那一批）——官方把最新旗舰排在列表最前；
 * 2. 在其中优先选「支持的思考档位最多」的那个：档位数量是旗舰与轻量款的天然分界
 *    （旗舰含 xhigh/max，轻量款只有 low/medium/high），新模型上线后无需改代码即自动跟随；
 * 3. 档位数相同时取列表靠前者，保留官方推荐顺序；
 * 4. 完全没有 Gemini 模型时，退回列表首项（如纯三方账号）。
 */
function pickPreferredDefaultModel(options) {
    const geminiOptions = options.filter((o) => o.value.startsWith('gemini-'));
    const pool = geminiOptions.length > 0 ? geminiOptions : options;
    let best = pool[0];
    let bestEffortCount = best?.effort?.values?.length ?? 0;
    for (const candidate of pool) {
        const count = candidate.effort?.values?.length ?? 0;
        if (count > bestEffortCount) {
            best = candidate;
            bestEffortCount = count;
        }
    }
    return best?.value ?? ANTIGRAVITY_FALLBACK_MODELS.DEFAULT;
}
/**
 * 实时调用反重力 CLI 获取当前账号支持的最新模型目录。
 * 具备并发请求去重与内存短时缓存机制。
 */
export async function fetchLiveAntigravityModels(force = false) {
    const now = Date.now();
    if (!force && cachedModelsDefinition && now - lastFetchedTimestamp < MODEL_CACHE_TTL_MS) {
        return cachedModelsDefinition;
    }
    if (inFlightFetchPromise) {
        return inFlightFetchPromise;
    }
    inFlightFetchPromise = (async () => {
        try {
            const bin = resolveAntigravityBinary();
            const { stdout } = await execFileAsync(bin, ['models'], {
                timeout: 15_000,
                env: process.env,
            });
            const parsed = parseAntigravityModelsOutput(stdout || '');
            if (parsed.OPTIONS.length > 0) {
                cachedModelsDefinition = parsed;
                lastFetchedTimestamp = Date.now();
                return parsed;
            }
        }
        catch (err) {
            console.warn('[AntigravityModels] 实时调用反重力模型失败，自动回退到缓存或预定义目录:', err?.message);
        }
        finally {
            inFlightFetchPromise = null;
        }
        if (cachedModelsDefinition) {
            return cachedModelsDefinition;
        }
        // 当 CLI 执行失败且尚无有效缓存时，缓存保底模型定义，避免后续连续请求反复阻塞超时
        cachedModelsDefinition = ANTIGRAVITY_FALLBACK_MODELS;
        lastFetchedTimestamp = Date.now();
        return ANTIGRAVITY_FALLBACK_MODELS;
    })();
    return inFlightFetchPromise;
}
/**
 * 主动使模型缓存失效（用于账号切换或手动刷新场景）
 */
export function invalidateAntigravityModelCache() {
    cachedModelsDefinition = null;
    lastFetchedTimestamp = 0;
}
export class AntigravityProviderModels {
    /**
     * 实时获取反重力平台支持的模型清单
     */
    async getSupportedModels(options = {}) {
        return fetchLiveAntigravityModels(options.force);
    }
    async getCurrentActiveModel() {
        const supported = await this.getSupportedModels();
        return buildDefaultProviderCurrentActiveModel(supported);
    }
    invalidateCache() {
        invalidateAntigravityModelCache();
    }
}
export const antigravityModelsProvider = new AntigravityProviderModels();
//# sourceMappingURL=antigravity-models.provider.js.map