import { useEffect, useRef } from 'react';
import type { HagemiPetInstance } from '../engine/hagemiEngine';
import type { HagemiFacts, HagemiSettings, HagemiState } from '../types';
import { getRandomLine } from '../engine/lines';
import { useAntigravityQuota, fetchAntigravityQuota, cleanAndTranslateResetDesc, formatDynamicCountdown } from '@/modules/chat/hooks/useAntigravityQuota';
import { useWebSocket } from '@/shared/context/WebSocketContext';
import type { ServerEvent } from '@/shared/types';

interface UseHagemiDirectorProps {
  pet: HagemiPetInstance | null;
  settings: HagemiSettings;
}

export function useHagemiDirector({ pet, settings }: UseHagemiDirectorProps) {
  const { quota } = useAntigravityQuota();
  const { subscribe } = useWebSocket();
  const lastStateRef = useRef<HagemiState>('idle');
  const lastSayTimeRef = useRef<number>(0);
  const prevQuotaPercentRef = useRef<number | null>(null);

  // 1. 同步设置（显隐、尺寸、静音、位置）与模型列表
  useEffect(() => {
    if (!pet) return;
    pet.receive({
      t: 'settings',
      settings: {
        hidden: !settings.enabled,
        size: settings.size,
        language: settings.lang,
        muted: settings.chattiness === 'silent',
        position: settings.position,
      },
    });

    // 向桌宠注入当前系统真实拥有的模型列表
    pet.receive({
      t: 'models',
      models: [
        'gemini-3.8-flash',
      ],
    });
  }, [pet, settings.enabled, settings.size, settings.lang, settings.chattiness, settings.position]);

  // 辅助函数：根据频率设置决定是否发表气泡吐槽
  const trySay = (category: Parameters<typeof getRandomLine>[0], force = false) => {
    if (!pet || !settings.enabled || settings.chattiness === 'silent') return;
    const now = Date.now();
    const intervals: Record<HagemiSettings['chattiness'], number> = {
      silent: Infinity,
      quiet: 90000,   // 1.5分钟
      normal: 35000,  // 35秒
      chatty: 15000,  // 15秒
    };
    const minGap = intervals[settings.chattiness] || 35000;
    if (!force && now - lastSayTimeRef.current < minGap) return;

    lastSayTimeRef.current = now;
    const msg = getRandomLine(category, settings.lang);
    pet.receive({
      t: 'say',
      text: msg.text,
      mood: msg.mood,
    });
  };

  // 自动确保小鱼干配额数据已加载，并定时刷新保持与主站同步
  useEffect(() => {
    if (settings.quotaFish) {
      void fetchAntigravityQuota(true);
      const timer = setInterval(() => {
        void fetchAntigravityQuota(false);
      }, 30000);
      return () => clearInterval(timer);
    }
  }, [settings.quotaFish]);

  // 2. 配额鱼干系统联动
  useEffect(() => {
    if (!pet || !settings.quotaFish) return;

    // 优先提取 5h 算力池与周度算力池（支持 gemini5h / active5h / claude5h 任何存在形式）
    const pool5h = quota?.active5h || quota?.gemini5h || quota?.claude5h;
    const poolWeekly = quota?.activeWeekly || quota?.geminiWeekly || quota?.claudeWeekly;

    const pct = typeof pool5h?.percent === 'number'
      ? pool5h.percent
      : (typeof quota?.percent === 'number' ? quota.percent : 100);

    const weeklyPct = typeof poolWeekly?.percent === 'number'
      ? poolWeekly.percent
      : (typeof quota?.weeklyPercent === 'number' ? quota.weeklyPercent : undefined);

    // 动态精确计算中文倒计时（如 "2小时 17分钟"、"6天 6小时"）
    const h5Countdown = formatDynamicCountdown(pool5h?.resetTime, pool5h?.resetsIn || quota?.resetsIn, true, pct);
    const weeklyCountdown = formatDynamicCountdown(poolWeekly?.resetTime, poolWeekly?.resetsIn || quota?.weeklyResetIn, false, weeklyPct ?? 100);

    const clean5hReset = cleanAndTranslateResetDesc(h5Countdown);
    const cleanWeeklyReset = cleanAndTranslateResetDesc(weeklyCountdown);

    const resetsIn = clean5hReset && clean5hReset !== '正常' && clean5hReset !== '随时可用' && !clean5hReset.includes('查询中') ? clean5hReset : '';
    const weeklyResetIn = cleanWeeklyReset && cleanWeeklyReset !== '正常' && cleanWeeklyReset !== '随时可用' && !cleanWeeklyReset.includes('查询中') ? cleanWeeklyReset : '';
    const ratio = Math.max(0, Math.min(1, pct / 100));

    let quotaLevel: HagemiFacts['quota'] = 'ok';
    if (pct <= 5) quotaLevel = 'critical';
    else if (pct <= 20) quotaLevel = 'low';
    else if (pct <= 50) quotaLevel = 'half';

    // 检测配额刷新或大额增长
    if (prevQuotaPercentRef.current !== null && pct > prevQuotaPercentRef.current + 25) {
      pet.receive({ t: 'react', burst: 'fish' });
      trySay('quotaRefreshed', true);
    } else if (prevQuotaPercentRef.current !== null && pct <= 15 && prevQuotaPercentRef.current > 15) {
      trySay('quotaLow', true);
    }
    prevQuotaPercentRef.current = pct;

    const hudList = [
      {
        label: '5h小鱼干',
        level: ratio,
        value: `${Math.round(pct)}%${resetsIn ? ` (${resetsIn})` : ''}`,
      },
    ];

    if (weeklyPct !== undefined) {
      hudList.push({
        label: '周度小鱼干',
        level: Math.max(0, Math.min(1, weeklyPct / 100)),
        value: `${Math.round(weeklyPct)}%${weeklyResetIn ? ` (${weeklyResetIn})` : ''}`,
      });
    }

    const facts: HagemiFacts = {
      state: lastStateRef.current,
      quota: quotaLevel,
      stashLevel: ratio,
      stashLabel: `${Math.round(pct)}%`,
      subagents: 0,
      hud: hudList,
    };

    pet.receive({ t: 'facts', ...facts });
  }, [pet, quota, settings.quotaFish]);

  // 3. 订阅 WebSocket Agent 事件联动
  useEffect(() => {
    if (!pet || !settings.enabled) return;

    const handleServerEvent = (event: ServerEvent) => {
      const msg = event as any;
      if (!msg || !msg.kind) return;

      let nextState: HagemiState | null = null;

      switch (msg.kind) {
        case 'thinking':
          nextState = 'thinking';
          trySay('thinking');
          break;
        case 'tool_use': {
          const tool = (msg.toolName || msg.name || '').toLowerCase();
          if (tool.includes('read') || tool.includes('cat') || tool.includes('file')) {
            nextState = 'reading';
            trySay('reading');
          } else if (tool.includes('write') || tool.includes('edit') || tool.includes('patch')) {
            nextState = 'writing';
            trySay('writing');
          } else if (tool.includes('run') || tool.includes('command') || tool.includes('exec') || tool.includes('bash')) {
            nextState = 'running';
            trySay('running');
          } else if (tool.includes('search') || tool.includes('web') || tool.includes('find')) {
            nextState = 'searching';
            trySay('searching');
          } else {
            nextState = 'running';
          }
          break;
        }
        case 'error':
        case 'protocol_error':
          nextState = 'oops';
          pet.receive({ t: 'react', burst: 'sweat' });
          trySay('oops', true);
          break;
        case 'complete':
          nextState = 'happy';
          pet.receive({ t: 'react', burst: 'confetti' });
          trySay('happy', true);
          // 4秒后自动恢复到 idle
          setTimeout(() => {
            if (lastStateRef.current === 'happy') {
              lastStateRef.current = 'idle';
              pet.receive({ t: 'facts', state: 'idle' });
            }
          }, 4500);
          break;
        default:
          break;
      }

      if (nextState && nextState !== lastStateRef.current) {
        lastStateRef.current = nextState;
        pet.receive({ t: 'facts', state: nextState });
      }
    };

    return subscribe(handleServerEvent);
  }, [pet, settings.enabled, subscribe, settings.chattiness]);

  // 4. 空闲自发吐槽与元气陪伴轮询（根据设置的话痨频率自发冒泡互动）
  useEffect(() => {
    if (!pet || !settings.enabled || settings.chattiness === 'silent') return;

    // 频率映射（毫秒）：
    // chatty (话痨): 16 ~ 20 秒自发说话或伸懒腰
    // normal (正常): 35 ~ 45 秒自发说话
    // quiet (偶尔): 90 ~ 120 秒偶尔冒泡
    const idleIntervals: Record<HagemiSettings['chattiness'], number> = {
      silent: Infinity,
      quiet: 90000,
      normal: 38000,
      chatty: 18000,
    };

    const intervalMs = idleIntervals[settings.chattiness];
    if (!Number.isFinite(intervalMs)) return;

    const timer = setInterval(() => {
      // 仅在当前处于 idle 状态时发表日常趣味自言自语与猫咪动作
      if (lastStateRef.current === 'idle') {
        const hour = new Date().getHours();
        const category = (hour >= 23 || hour <= 4) ? 'lateNight' : 'idle';
        trySay(category, false);
      }
    }, intervalMs);

    return () => clearInterval(timer);
  }, [pet, settings.enabled, settings.chattiness, settings.lang]);
}
