import { Router, type Request, type Response } from 'express';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import {
  ReasoningTranslator,
  TranslationCache,
  defaultReasoningConfig,
  type AppReasoningConfig,
} from './translator.service.js';
import { createEngine, probeEngine } from './engine.service.js';

const router = Router();

// 配置文件持久化路径：~/.gemini/config/reasoning-translate/
const CONFIG_DIR = path.join(os.homedir(), '.gemini', 'config', 'reasoning-translate');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
const CACHE_FILE = path.join(CONFIG_DIR, 'cache.json');

let appConfig: AppReasoningConfig = defaultReasoningConfig();
const cache = new TranslationCache(4000, CACHE_FILE);
let translator: ReasoningTranslator;

// 初始化加载配置与缓存
async function initTranslator() {
  await cache.load();
  try {
    const raw = await fs.readFile(CONFIG_FILE, 'utf8');
    const parsed = JSON.parse(raw) as Partial<AppReasoningConfig>;
    appConfig = {
      ...defaultReasoningConfig(),
      ...parsed,
      engines: {
        ...defaultReasoningConfig().engines,
        ...(parsed.engines || {}),
      },
    };
    // 首次升级平滑迁移：默认改用 Microsoft Bing 免费翻译，不再强依赖模型配置
    if (!appConfig.migratedToBing) {
      appConfig.engine = 'bing';
      appConfig.migratedToBing = true;
      await fs.mkdir(CONFIG_DIR, { recursive: true });
      await fs.writeFile(CONFIG_FILE, JSON.stringify(appConfig, null, 2), 'utf8');
    }
  } catch {
    appConfig = defaultReasoningConfig();
  }

  const currentEngineConfig = appConfig.engines[appConfig.engine] || {};
  const engine = createEngine({
    engine: appConfig.engine,
    config: currentEngineConfig,
  });

  translator = new ReasoningTranslator(engine, cache, appConfig);
}

void initTranslator();

async function persistConfig(newConfig: AppReasoningConfig) {
  appConfig = newConfig;
  await fs.mkdir(CONFIG_DIR, { recursive: true });
  await fs.writeFile(CONFIG_FILE, JSON.stringify(appConfig, null, 2), 'utf8');
  const engine = createEngine({
    engine: appConfig.engine,
    config: appConfig.engines[appConfig.engine] || {},
  });
  translator.updateEngine(engine, appConfig);
}

// 1. 获取当前翻译配置与引擎状态
router.get('/config', async (_req: Request, res: Response) => {
  res.json({
    config: appConfig,
    engine: {
      id: translator?.getEngineId() || appConfig.engine,
      label: translator?.getEngineLabel() || '未初始化',
    },
    stats: translator?.stats() || null,
  });
});

// 2. 更新配置
router.post('/config', async (req: Request, res: Response) => {
  try {
    const patch = req.body as Partial<AppReasoningConfig>;
    const updated = {
      ...appConfig,
      ...patch,
      engines: {
        ...appConfig.engines,
        ...(patch.engines || {}),
      },
    };
    await persistConfig(updated);
    res.json({
      ok: true,
      config: appConfig,
      engine: {
        id: translator.getEngineId(),
        label: translator.getEngineLabel(),
      },
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// 3. 执行思考过程文本翻译
router.post('/translate', async (req: Request, res: Response) => {
  try {
    const { text, streaming } = req.body as { text?: string; streaming?: boolean };
    if (!translator) {
      res.json({ fragments: [text || ''], text: text || '', skipped: 'not-ready' });
      return;
    }
    const result = await translator.translate({
      text: text || '',
      streaming: Boolean(streaming),
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// 4. 连通性测试 (Probe)
router.post('/probe', async (req: Request, res: Response) => {
  try {
    const { engine: probeEngineType, config: probeConfig } = req.body as {
      engine?: string;
      config?: Record<string, unknown>;
    };
    const targetType = probeEngineType || appConfig.engine;
    const targetConfig = probeConfig || appConfig.engines[targetType as keyof typeof appConfig.engines] || {};

    const testEngine = createEngine({
      engine: targetType,
      config: targetConfig,
    });
    const result = await probeEngine(testEngine);
    res.json({
      ...result,
      engine: testEngine.label,
    });
  } catch (err) {
    res.json({
      ok: false,
      ms: 0,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

export default router;
