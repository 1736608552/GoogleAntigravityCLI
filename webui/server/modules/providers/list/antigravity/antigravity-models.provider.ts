import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import type { IProviderModels } from '@/shared/interfaces.js';
import type {
  ProviderCurrentActiveModel,
  ProviderModelOption,
  ProviderModelsDefinition,
} from '@/shared/types.js';
import { buildDefaultProviderCurrentActiveModel } from '@/shared/utils.js';

import { resolveAntigravityBinary } from './antigravity-auth.provider.js';

const execFileAsync = promisify(execFile);

/**
 * 静态兜底反重力模型目录。
 * 仅在官方 Antigravity CLI 尚未生成缓存、发生网络超时或处于完全离线环境时作为保底使用。
 * 注意：Gemini 系列仅保留基础模型（如 Gemini 3.8 Flash），由前端顶部的深度思考档位（Effort）统一调控，绝不在模型列表中重复展示 -high/-medium/-low。
 */
export const ANTIGRAVITY_FALLBACK_MODELS: ProviderModelsDefinition = {
  OPTIONS: [
    {
      value: 'gemini-3.8-flash',
      label: 'Gemini 3.8 Flash',
      description: 'Google DeepMind 旗舰模型，支持深度多维推理 (调用顶部 Low/Medium/High 思考档位)。',
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
  DEFAULT: 'gemini-3.8-flash',
};

/** 保持历史导出兼容 */
export const ANTIGRAVITY_PREDEFINED_MODELS = ANTIGRAVITY_FALLBACK_MODELS;

/** 内存缓存 TTL，设定为 60 秒，避免前端短时间内高频重复调用 CLI 进程 */
const MODEL_CACHE_TTL_MS = 60_000;

let cachedModelsDefinition: ProviderModelsDefinition | null = null;
let lastFetchedTimestamp = 0;
let inFlightFetchPromise: Promise<ProviderModelsDefinition> | null = null;

/**
 * 解析官方 Antigravity CLI `antigravity models` 命令的实时标准输出。
 * 核心设计：
 * 将 Gemini 系列的各档位变体 (gemini-3.8-flash-high/medium/low) 聚合为单一基础模型 (gemini-3.8-flash)，
 * 并装配 Low/Medium/High 思考档位，供顶部“深度思考 (推理)”菜单调控，
 * 绝不在下方的“模型”列表中重复展示各档位变体。
 */
export function parseAntigravityModelsOutput(rawStdout: string): ProviderModelsDefinition {
  const lines = rawStdout.split('\n');
  const rawItems: Array<{ id: string; label: string }> = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('Fetching')) {
      continue;
    }
    const parts = line.split(/\t+|\s{2,}/);
    const id = parts[0]?.trim();
    if (!id) continue;
    const label = parts.slice(1).join(' ').trim() || id;
    rawItems.push({ id, label });
  }

  if (rawItems.length === 0) {
    return ANTIGRAVITY_FALLBACK_MODELS;
  }

  // 1. 扫描与归纳 Gemini 系列的基础模型与支持的 effort
  const geminiBases = new Map<
    string,
    {
      baseId: string;
      baseLabel: string;
      efforts: Set<string>;
    }
  >();

  // 记录非 effort 衍生的独立模型（如 Claude、GPT-OSS 等）
  const standaloneItems: Array<{ id: string; label: string }> = [];

  for (const item of rawItems) {
    const { id, label } = item;
    if (id.startsWith('gemini-')) {
      const match = id.match(/^(.+)-(high|medium|low)$/i);
      if (match) {
        const baseId = match[1];
        const effortVal = match[2].toLowerCase();
        // 剥离 label 中的 (High)/(Medium)/(Low) 标识作为基础模型 label
        const cleanLabel =
          label.replace(/\s*\((?:High|Medium|Low)\)\s*/i, '').trim() || 'Gemini 3.8 Flash';

        if (!geminiBases.has(baseId)) {
          geminiBases.set(baseId, {
            baseId,
            baseLabel: cleanLabel,
            efforts: new Set([effortVal]),
          });
        } else {
          geminiBases.get(baseId)!.efforts.add(effortVal);
        }
        // 关键：带有 -high/-medium/-low 后缀的衍生变体跳过，绝不单独加入模型列表！
        continue;
      } else {
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

  const options: ProviderModelOption[] = [];

  // 2. 将聚合后的 Gemini 基础模型加入列表（排在最前面）
  for (const [baseId, baseInfo] of geminiBases.entries()) {
    const effortValues = ['low', 'medium', 'high'].filter((e) => baseInfo.efforts.has(e));
    options.push({
      value: baseId,
      label: baseInfo.baseLabel,
      description: 'Google DeepMind 官方反重力模型，支持顶部深度思考 (Low/Medium/High) 档位调控。',
      effort: {
        values: (effortValues.length > 0 ? effortValues : ['low', 'medium', 'high']).map((v) => ({
          value: v,
        })),
        default: 'high',
      },
    });
  }

  // 若未能识别出任何 Gemini 基础模型（防空容错），置入默认 gemini-3.8-flash
  if (options.length === 0) {
    options.push({
      value: 'gemini-3.8-flash',
      label: 'Gemini 3.8 Flash',
      description: 'Google DeepMind 旗舰模型，支持深度多维推理 (调用顶部 Low/Medium/High 思考档位)。',
      effort: {
        values: [{ value: 'low' }, { value: 'medium' }, { value: 'high' }],
        default: 'high',
      },
    });
  }

  // 3. 将三方模型与独立模型加入列表
  for (const item of standaloneItems) {
    const { id, label } = item;
    const isClaude = id.toLowerCase().includes('claude');
    const isGpt = id.toLowerCase().includes('gpt') || id.toLowerCase().includes('oss');

    let description = '';
    if (isClaude) {
      description = 'Anthropic 官方思考模型，通过 Google Antigravity 原生调度。';
    } else if (isGpt) {
      description = '开源大语言模型，通过 Google Antigravity 原生调度。';
    } else {
      description = 'Google Antigravity 实时可用模型。';
    }

    options.push({
      value: id,
      label,
      description,
      effort: undefined, // 三方模型绝不配置 effort，防止 CLI 报错
    });
  }

  const defaultModel =
    options.find((o) => o.value === 'gemini-3.8-flash')?.value ||
    options[0]?.value ||
    'gemini-3.8-flash';

  return {
    OPTIONS: options,
    DEFAULT: defaultModel,
  };
}

/**
 * 实时调用反重力 CLI 获取当前账号支持的最新模型目录。
 * 具备并发请求去重与内存短时缓存机制。
 */
export async function fetchLiveAntigravityModels(force = false): Promise<ProviderModelsDefinition> {
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
    } catch (err: any) {
      console.warn('[AntigravityModels] 实时调用反重力模型失败，自动回退到缓存或预定义目录:', err?.message);
    } finally {
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
export function invalidateAntigravityModelCache(): void {
  cachedModelsDefinition = null;
  lastFetchedTimestamp = 0;
}

export class AntigravityProviderModels implements IProviderModels {
  /**
   * 实时获取反重力平台支持的模型清单
   */
  async getSupportedModels(options: { force?: boolean } = {}): Promise<ProviderModelsDefinition> {
    return fetchLiveAntigravityModels(options.force);
  }

  async getCurrentActiveModel(): Promise<ProviderCurrentActiveModel> {
    const supported = await this.getSupportedModels();
    return buildDefaultProviderCurrentActiveModel(supported);
  }

  invalidateCache(): void {
    invalidateAntigravityModelCache();
  }
}

export const antigravityModelsProvider = new AntigravityProviderModels();
