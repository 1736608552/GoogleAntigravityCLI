/**
 * Reasoning Translate - Core Translator Service
 * 负责分句增量翻译、双层缓存（内存 LRU + 磁盘持久化）、并发控制与熔断器
 */
import { promises as fs } from 'fs';
import path from 'path';
import { looksChinese, splitUnits, sanitizeTranslation, joinTranslations, } from './text.util.js';
import { translationSystemPrompt, } from './engine.service.js';
const BATCH_CHARS = 450;
const BATCH_UNITS = 3;
const MAX_TAIL_CHARS = 1000;
const MAX_INFLIGHT = 2;
const BREAK_THRESHOLD = 3;
const BREAK_COOLDOWN_MS = 30_000;
class Limiter {
    limit;
    active = 0;
    queue = [];
    constructor(limit) {
        this.limit = limit;
    }
    async run(task) {
        if (this.active >= this.limit) {
            await new Promise((resolve) => this.queue.push(resolve));
        }
        this.active += 1;
        try {
            return await task();
        }
        finally {
            this.active -= 1;
            const next = this.queue.shift();
            if (next)
                next();
        }
    }
}
export class TranslationCache {
    limit;
    file;
    map = new Map();
    dirty = false;
    loaded = false;
    saveTimer;
    hits = 0;
    misses = 0;
    constructor(limit, file) {
        this.limit = limit;
        this.file = file;
    }
    async load() {
        if (this.loaded || !this.file)
            return;
        this.loaded = true;
        try {
            const raw = await fs.readFile(this.file, 'utf8');
            const data = JSON.parse(raw);
            for (const [k, v] of Object.entries(data)) {
                if (typeof v === 'string')
                    this.map.set(k, v);
            }
        }
        catch {
            // 首次加载无缓存文件，忽略
        }
    }
    async save() {
        if (!this.dirty || !this.file)
            return;
        this.dirty = false;
        try {
            const dir = path.dirname(this.file);
            await fs.mkdir(dir, { recursive: true });
            const obj = {};
            for (const [k, v] of this.map.entries()) {
                obj[k] = v;
            }
            await fs.writeFile(this.file, JSON.stringify(obj), 'utf8');
        }
        catch (e) {
            console.warn('[reasoning-translate] 保存翻译缓存失败:', e);
        }
    }
    get(key) {
        const val = this.map.get(key);
        if (val !== undefined) {
            this.hits += 1;
            // 刷新访问顺序
            this.map.delete(key);
            this.map.set(key, val);
            return val;
        }
        this.misses += 1;
        return undefined;
    }
    set(key, value) {
        if (this.map.has(key))
            this.map.delete(key);
        this.map.set(key, value);
        if (this.map.size > this.limit) {
            const oldest = this.map.keys().next().value;
            if (oldest !== undefined)
                this.map.delete(oldest);
        }
        this.dirty = true;
        if (!this.saveTimer) {
            this.saveTimer = setTimeout(() => {
                this.saveTimer = undefined;
                void this.save();
            }, 5000);
            this.saveTimer.unref?.();
        }
    }
    stats() {
        return {
            size: this.map.size,
            hits: this.hits,
            misses: this.misses,
        };
    }
}
export function defaultReasoningConfig() {
    return {
        enabled: true,
        engine: 'bing',
        showOriginal: true,
        defaultOpenOriginal: false,
        minChars: 30,
        migratedToBing: true,
        engines: {
            bing: {
                timeoutMs: 12_000,
            },
            ollama: {
                baseURL: 'http://127.0.0.1:11434',
                model: 'qwen2.5:1.5b',
                keepAlive: '30m',
                timeoutMs: 30_000,
            },
            'openai-compatible': {
                baseURL: '',
                model: '',
                apiKey: '',
                displayName: 'OpenAI-Compatible',
                timeoutMs: 60_000,
            },
            antigravity: {
                baseURL: 'https://generativelanguage.googleapis.com/v1beta',
                model: 'gemini-2.5-flash',
                timeoutMs: 30_000,
            },
        },
        glossary: [],
    };
}
export class ReasoningTranslator {
    engine;
    cache;
    config;
    limiter = new Limiter(MAX_INFLIGHT);
    circuitFailures = 0;
    circuitOpenedAt = 0;
    constructor(engine, cache, config) {
        this.engine = engine;
        this.cache = cache;
        this.config = config;
    }
    updateEngine(engine, config) {
        this.engine = engine;
        this.config = config;
    }
    getEngineId() {
        return this.engine.id;
    }
    getEngineLabel() {
        return this.engine.label;
    }
    getCircuitState() {
        if (this.circuitFailures >= BREAK_THRESHOLD) {
            if (Date.now() - this.circuitOpenedAt < BREAK_COOLDOWN_MS) {
                return 'open';
            }
            // 冷却时间到，恢复半开重试
            this.circuitFailures = 0;
        }
        return 'closed';
    }
    async translate(options) {
        const raw = String(options.text ?? '').trim();
        if (!raw) {
            return { fragments: [], text: '' };
        }
        if (!this.config.enabled) {
            return { fragments: [raw], text: raw, skipped: 'disabled' };
        }
        if (raw.length < (this.config.minChars ?? 30)) {
            return { fragments: [raw], text: raw, skipped: 'too-short' };
        }
        if (looksChinese(raw)) {
            return { fragments: [raw], text: raw, skipped: 'already-chinese' };
        }
        if (this.getCircuitState() === 'open') {
            return { fragments: [raw], text: raw, skipped: 'circuit-open' };
        }
        const { complete, tail } = splitUnits(raw);
        const translatedFragments = [];
        // 1. 批量处理完整句子（命中缓存或批量翻译入库）
        let batch = [];
        let batchLength = 0;
        const flushBatch = async () => {
            if (batch.length === 0)
                return;
            const currentBatch = [...batch];
            batch = [];
            batchLength = 0;
            // 检查当前 batch 中是否已有部分命中缓存
            const missingIndexes = [];
            const batchTranslations = new Array(currentBatch.length).fill(null);
            for (let i = 0; i < currentBatch.length; i++) {
                const cached = this.cache.get(currentBatch[i]);
                if (cached !== undefined) {
                    batchTranslations[i] = cached;
                }
                else {
                    missingIndexes.push(i);
                }
            }
            if (missingIndexes.length > 0) {
                const toTranslate = missingIndexes.map((idx) => currentBatch[idx]).join('\n\n');
                try {
                    const resultText = await this.limiter.run(() => this.engine.chat({
                        system: translationSystemPrompt({ glossary: this.config.glossary }),
                        user: toTranslate,
                        signal: options.signal,
                    }));
                    this.circuitFailures = 0;
                    // 将译文按换行对应或单条清洗
                    const parts = resultText.split(/\n{2,}/).map((s) => s.trim()).filter(Boolean);
                    if (parts.length === missingIndexes.length) {
                        for (let k = 0; k < parts.length; k++) {
                            const cleaned = sanitizeTranslation(parts[k], currentBatch[missingIndexes[k]]) ?? parts[k];
                            batchTranslations[missingIndexes[k]] = cleaned;
                            this.cache.set(currentBatch[missingIndexes[k]], cleaned);
                        }
                    }
                    else {
                        // 单独回退逐句保存或整段平摊
                        for (const idx of missingIndexes) {
                            const cleaned = sanitizeTranslation(resultText, currentBatch[idx]) ?? resultText;
                            batchTranslations[idx] = cleaned;
                            this.cache.set(currentBatch[idx], cleaned);
                        }
                    }
                }
                catch (err) {
                    this.circuitFailures += 1;
                    if (this.circuitFailures >= BREAK_THRESHOLD) {
                        this.circuitOpenedAt = Date.now();
                    }
                    console.warn('[reasoning-translate] 翻译批量失败，回退原文:', err);
                    for (const idx of missingIndexes) {
                        batchTranslations[idx] = currentBatch[idx];
                    }
                }
            }
            for (const t of batchTranslations) {
                if (t)
                    translatedFragments.push(t);
            }
        };
        for (const unit of complete) {
            batch.push(unit);
            batchLength += unit.length;
            if (batch.length >= BATCH_UNITS || batchLength >= BATCH_CHARS) {
                await flushBatch();
            }
        }
        await flushBatch();
        // 2. 处理流式尾随句子 (tail)
        if (tail && tail.length <= MAX_TAIL_CHARS) {
            const cachedTail = this.cache.get(tail);
            if (cachedTail) {
                translatedFragments.push(cachedTail);
            }
            else {
                try {
                    const tailResult = await this.limiter.run(() => this.engine.chat({
                        system: translationSystemPrompt({ glossary: this.config.glossary }),
                        user: tail,
                        signal: options.signal,
                    }));
                    this.circuitFailures = 0;
                    const cleanedTail = sanitizeTranslation(tailResult, tail) ?? tailResult;
                    translatedFragments.push(cleanedTail);
                    if (!options.streaming) {
                        this.cache.set(tail, cleanedTail);
                    }
                }
                catch (err) {
                    this.circuitFailures += 1;
                    translatedFragments.push(tail);
                }
            }
        }
        const finalText = joinTranslations(translatedFragments);
        return {
            fragments: translatedFragments,
            text: finalText,
        };
    }
    stats() {
        return {
            cache: this.cache.stats(),
            circuit: this.getCircuitState(),
        };
    }
}
//# sourceMappingURL=translator.service.js.map