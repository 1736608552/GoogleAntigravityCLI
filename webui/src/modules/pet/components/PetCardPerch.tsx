import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { RefreshCw } from 'lucide-react';

import {
  fetchAntigravityQuota,
  getCachedAccountQuota,
} from '@/modules/chat/hooks/useAntigravityQuota';
import { useHagemiSettings } from '../petSettingsStore';

type QuotaSnapshot = Awaited<ReturnType<typeof fetchAntigravityQuota>>;

type AnchorKind = 'card' | 'stop' | 'queue' | 'input';

function formatQuotaColor(percent: number): string {
  if (percent <= 15) return 'bg-rose-500';
  if (percent <= 35) return 'bg-amber-500';
  return 'bg-emerald-500';
}

function formatQuotaBadge(percent: number): { text: string; cls: string } {
  if (percent <= 15) return { text: '告急', cls: 'bg-rose-500/15 text-rose-600 dark:text-rose-400' };
  if (percent <= 35) return { text: '注意', cls: 'bg-amber-500/15 text-amber-600 dark:text-amber-400' };
  return { text: '安全', cls: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' };
}

function pickTargetElement(): { el: HTMLElement; kind: AnchorKind } | null {
  const vh = window.innerHeight;

  const cards = Array.from(document.querySelectorAll<HTMLElement>('[data-pet-anchor="card"]'));
  for (let i = cards.length - 1; i >= 0; i -= 1) {
    const r = cards[i].getBoundingClientRect();
    if (r.width > 0 && r.height > 0 && r.bottom > 56 && r.top < vh - 70) {
      return { el: cards[i], kind: 'card' };
    }
  }

  const stopBtn = document.querySelector<HTMLElement>('[data-pet-anchor="stop"]');
  if (stopBtn) {
    const r = stopBtn.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return { el: stopBtn, kind: 'stop' };
  }

  const queueCard = document.querySelector<HTMLElement>('[data-pet-anchor="queue"]');
  if (queueCard) {
    const r = queueCard.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return { el: queueCard, kind: 'queue' };
  }

  const inputBox = document.querySelector<HTMLElement>('[data-pet-anchor="input"]');
  if (inputBox) {
    const r = inputBox.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return { el: inputBox, kind: 'input' };
  }

  return null;
}

/**
 * Global viewport-level pet stage that perches on the latest step card
 * (slowly crawling down tall cards), hops to the stop button, queue card,
 * or input box, wanders along edges when idle, and reveals live quota on tap.
 */
const IDLE_LINES = [
  '我在这儿巡逻呢~',
  '点我可以看实时额度哦',
  '呼噜呼噜…好困呀',
  '随时待命中 ✨',
  '主人怎么不理我呀~',
  '偷偷告诉你，我很厉害的',
  '无聊到开始数像素点了…',
  '今天也是元气满满的一天！',
];

const TAP_LINES = [
  '诶嘿，被你点到啦！',
  '再戳我就要收费了哦~ 💰',
  '哎呀，痒死了啦~',
  '别光顾着调戏我，快去干活！',
  '摸摸头，元气满满 ♥',
  '哼，不理你了…才怪！',
  '今天也要被我迷倒了吗？✨',
  '主人，额度还够不够呀？',
  '轻点轻点，发型要乱啦！',
  '你再点一下试试？我就…给你比个心 ♥',
];

type TrickSpec = {
  id: string;
  cls: string;
  prop?: string;
  line: string;
  durationMs: number;
};

const TRICKS: TrickSpec[] = [
  { id: 'backflip', cls: 'agy-trick-backflip', prop: '✨', line: '看我超级后空翻！', durationMs: 850 },
  { id: 'fire', cls: 'agy-trick-shake', prop: '🔥', line: '啊呜——喷火！！🔥', durationMs: 1100 },
  { id: 'tiger', cls: 'agy-trick-bounce', prop: '🐯', line: '乖，给大王坐下！训老虎中…', durationMs: 1300 },
  { id: 'face', cls: 'agy-trick-spin-y', prop: '🎭', line: '川剧变脸！猜我现在是谁？', durationMs: 1000 },
  { id: 'handstand', cls: 'agy-trick-handstand', prop: '🤸', line: '单手倒立！稳不稳？', durationMs: 1300 },
  { id: 'levitate', cls: 'agy-trick-levitate', prop: '🪄', line: '悬浮打坐，悟道中…', durationMs: 1400 },
  { id: 'rainbow', cls: 'agy-trick-rainbow', prop: '🌈', line: '彩虹星云模式启动！', durationMs: 1300 },
  { id: 'teleport', cls: 'agy-trick-blink-fast', prop: '⚡', line: '咻——瞬移失败，还在原地！', durationMs: 900 },
  { id: 'moonwalk', cls: 'agy-trick-moonwalk', prop: '🕺', line: '来段丝滑太空漫步~', durationMs: 1200 },
  { id: 'juggle', cls: 'agy-trick-bounce', prop: '🤹', line: '看我杂耍抛三个 Bug！', durationMs: 1200 },
  { id: 'saiyan', cls: 'agy-trick-shake', prop: '💥', line: '哈啊啊——超级赛亚宠充能！', durationMs: 1100 },
  { id: 'sleep', cls: 'agy-trick-sleep', prop: '💤', line: 'Zzz…代码写完了叫我…', durationMs: 1500 },
  { id: 'salute', cls: 'agy-trick-tilt', prop: '🫡', line: '收到！保证完成巡逻任务！', durationMs: 1000 },
  { id: 'love', cls: 'agy-trick-bounce', prop: '💖', line: '发射爱心光波哔哔哔~', durationMs: 1100 },
  { id: 'sneeze', cls: 'agy-trick-sneeze', prop: '🤧', line: '阿嚏！谁在想我？', durationMs: 850 },
  { id: 'top', cls: 'agy-trick-spin', prop: '🌀', line: '化身高速旋转小陀螺！', durationMs: 950 },
  { id: 'spring', cls: 'agy-trick-spring', prop: '🦘', line: '超级弹簧跳！起飞！', durationMs: 950 },
  { id: 'stealth', cls: 'agy-trick-stealth', prop: '🥷', line: '隐身术！你看不见我~', durationMs: 1300 },
  { id: 'rocket', cls: 'agy-trick-levitate', prop: '🚀', line: '点火！准备发射去火星！', durationMs: 1200 },
  { id: 'magic', cls: 'agy-trick-spin-y', prop: '🎩', line: '变个魔术，把报错全变没！', durationMs: 1100 },
];

const ANCHOR_LINES: Record<AnchorKind, string> = {
  card: '新步骤来啦，我先趴这儿~',
  stop: '正在努力执行中…',
  queue: '消息排队中，等一等~',
  input: '任务告一段落，出来透透气~',
};

export function PetStageOverlay() {
  const [petSettings] = useHagemiSettings();
  const [open, setOpen] = useState(false);
  const [quota, setQuota] = useState<QuotaSnapshot>(() => getCachedAccountQuota());
  const [loading, setLoading] = useState(false);
  const [happyBurst, setHappyBurst] = useState(0);
  const [visible, setVisible] = useState(false);
  const [bubbleText, setBubbleText] = useState<string | null>(null);
  const [trickClass, setTrickClass] = useState('');
  const [trickProp, setTrickProp] = useState<string | null>(null);
  const bubbleTimerRef = useRef<number | null>(null);

  const showBubble = useCallback((text: string, durationMs = 2400) => {
    setBubbleText(text);
    if (bubbleTimerRef.current) {
      window.clearTimeout(bubbleTimerRef.current);
    }
    bubbleTimerRef.current = window.setTimeout(() => {
      setBubbleText(null);
      bubbleTimerRef.current = null;
    }, durationMs);
  }, []);

  const petBoxRef = useRef<HTMLDivElement | null>(null);
  const petVisualRef = useRef<HTMLDivElement | null>(null);
  const popupRef = useRef<HTMLDivElement | null>(null);

  const stateRef = useRef({
    x: 0,
    y: 0,
    initialized: false,
    lastEl: null as HTMLElement | null,
    lastKind: null as AnchorKind | null,
    hopProgress: 1,
    hopStartX: 0,
    hopStartY: 0,
    cardCrawlY: 0,
    idleOffsetX: 0,
    idleDir: -1,
    facingLeft: false,
    stepPhase: 0,
    pauseUntil: 0,
    wanderDir: 1,
    wanderOffset: 0,
    rotationDeg: 0,
  });

  const refresh = useCallback(async (force = true) => {
    setLoading(true);
    try {
      const snap = await fetchAntigravityQuota(force);
      if (snap) setQuota(snap);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    if (!quota) {
      void refresh(false);
    }
    const handleOutside = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node;
      if (
        popupRef.current &&
        !popupRef.current.contains(target) &&
        petBoxRef.current &&
        !petBoxRef.current.contains(target)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('touchstart', handleOutside);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('touchstart', handleOutside);
    };
  }, [open, quota, refresh]);

  useEffect(() => {
    if (!petSettings.enabled) {
      setVisible(false);
      return;
    }

    let rafId = 0;
    let lastTime = performance.now();

    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - lastTime) / 1000);
      lastTime = now;

      const target = pickTargetElement();
      const s = stateRef.current;

      if (!target) {
        if (visible) setVisible(false);
        rafId = requestAnimationFrame(tick);
        return;
      }

      if (!visible) setVisible(true);

      const rect = target.el.getBoundingClientRect();
      let goalX = rect.right - 44;
      let goalY = rect.top - 26;

      if (target.el !== s.lastEl) {
        if (s.initialized) {
          s.hopProgress = 0;
          s.hopStartX = s.x;
          s.hopStartY = s.y;
          if (s.lastKind !== target.kind) {
            showBubble(ANCHOR_LINES[target.kind], 2000);
          }
        }
        s.lastEl = target.el;
        s.lastKind = target.kind;
        s.cardCrawlY = 0;
        s.idleOffsetX = 0;
      }

      if (target.kind === 'card') {
        const isPaused = now < s.pauseUntil;
        if (!isPaused && Math.random() < 0.006) {
          s.pauseUntil = now + 1500 + Math.random() * 2200;
        }

        if (rect.top >= 110) {
          goalX = rect.right - 34;
          goalY = rect.top - 26;
          s.cardCrawlY = 0;
          s.facingLeft = false;
          s.rotationDeg = 0;
        } else {
          const visTop = Math.max(68, rect.top);
          const visBottom = Math.min(window.innerHeight - 120, rect.bottom - 34);
          const midY = Math.max(68, (visTop + visBottom) * 0.5);

          if (!isPaused) {
            if (Math.abs(s.cardCrawlY - midY) > 6 && s.cardCrawlY < midY) {
              s.cardCrawlY = Math.min(midY, (s.cardCrawlY || visTop) + dt * 20);
            } else {
              s.wanderOffset += s.wanderDir * dt * 14;
              if (s.wanderOffset > 28) {
                s.wanderOffset = 28;
                s.wanderDir = -1;
              } else if (s.wanderOffset < -28) {
                s.wanderOffset = -28;
                s.wanderDir = 1;
              }
              s.cardCrawlY = Math.max(68, Math.min(visBottom, midY + s.wanderOffset));
            }
          }
          goalX = rect.right - 5;
          goalY = s.cardCrawlY || midY;
          s.facingLeft = false;
          s.rotationDeg = 90;
        }
      } else {
        s.rotationDeg = 0;
        const minOffset = -(Math.max(0, rect.width - 72));
        if (minOffset < -12) {
          s.idleOffsetX += s.idleDir * dt * 18;
          if (s.idleOffsetX <= minOffset) {
            s.idleOffsetX = minOffset;
            s.idleDir = 1;
          } else if (s.idleOffsetX >= 0) {
            s.idleOffsetX = 0;
            s.idleDir = -1;
          }
          s.facingLeft = s.idleDir < 0;
        } else {
          s.idleOffsetX = 0;
          s.facingLeft = false;
        }
        goalX = Math.max(12, rect.right - 44 + s.idleOffsetX);
        goalY = Math.max(56, rect.top - 26);
      }

      if (!s.initialized) {
        s.x = goalX;
        s.y = goalY;
        s.initialized = true;
      } else if (s.hopProgress < 1) {
        s.hopProgress = Math.min(1, s.hopProgress + dt * 2.4);
        const t = s.hopProgress;
        const ease = 1 - Math.pow(1 - t, 3);
        const arc = Math.sin(t * Math.PI) * 34;
        s.x = s.hopStartX + (goalX - s.hopStartX) * ease;
        s.y = s.hopStartY + (goalY - s.hopStartY) * ease - arc;
      } else {
        s.x += (goalX - s.x) * Math.min(1, dt * 10);
        s.y += (goalY - s.y) * Math.min(1, dt * 10);
      }

      s.stepPhase += dt * 6;
      const bob = s.hopProgress >= 1 ? Math.abs(Math.sin(s.stepPhase)) * 1.5 : 0;

      if (petBoxRef.current) {
        petBoxRef.current.style.transform = `translate3d(${s.x.toFixed(1)}px, ${(s.y - bob).toFixed(1)}px, 0)`;
      }
      if (petVisualRef.current) {
        petVisualRef.current.style.transform = `rotate(${s.rotationDeg}deg)`;
      }

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [petSettings.enabled, visible]);

  if (!petSettings.enabled) {
    return null;
  }

  const handleTap = (e: React.MouseEvent) => {
    e.stopPropagation();
    setHappyBurst((c) => c + 1);
    const line = TAP_LINES[Math.floor(Math.random() * TAP_LINES.length)];
    showBubble(line, 2400);
    setOpen((prev) => !prev);
  };

  useEffect(() => {
    if (!petSettings.enabled) return;
    const timer = window.setInterval(() => {
      if (open) return;
      const roll = Math.random();
      if (roll < 0.65) {
        const trick = TRICKS[Math.floor(Math.random() * TRICKS.length)];
        setTrickClass(trick.cls);
        setTrickProp(trick.prop || null);
        showBubble(trick.line, Math.max(1800, trick.durationMs + 500));
        window.setTimeout(() => {
          setTrickClass('');
          setTrickProp(null);
        }, trick.durationMs);
      } else if (roll < 0.9) {
        const line = IDLE_LINES[Math.floor(Math.random() * IDLE_LINES.length)];
        showBubble(line, 2400);
      }
    }, 7500);
    return () => window.clearInterval(timer);
  }, [petSettings.enabled, open, showBubble]);

  return (
    <>
      <style>{`
        @keyframes agy-pet-breathe {
          0%, 100% { transform: scaleY(1) scaleX(1); }
          50% { transform: scaleY(1.04) scaleX(0.98); }
        }
        @keyframes agy-pet-blink {
          0%, 92%, 100% { transform: scaleY(1); }
          96% { transform: scaleY(0.1); }
        }
        @keyframes agy-pet-tail {
          0%, 100% { transform: rotate(-6deg); }
          50% { transform: rotate(10deg); }
        }
        @keyframes agy-pet-heart {
          0% { opacity: 0; transform: translateY(4px) scale(0.6); }
          25% { opacity: 1; transform: translateY(-6px) scale(1.05); }
          100% { opacity: 0; transform: translateY(-20px) scale(0.8); }
        }
        @keyframes agy-trick-backflip {
          0% { transform: translateY(0) rotate(0deg); }
          45% { transform: translateY(-20px) rotate(-180deg); }
          100% { transform: translateY(0) rotate(-360deg); }
        }
        @keyframes agy-trick-spin {
          0% { transform: rotate(0deg) scale(1); }
          50% { transform: rotate(360deg) scale(1.08); }
          100% { transform: rotate(720deg) scale(1); }
        }
        @keyframes agy-trick-spin-y {
          0% { transform: rotateY(0deg); }
          50% { transform: rotateY(180deg) scale(1.1); }
          100% { transform: rotateY(360deg); }
        }
        @keyframes agy-trick-handstand {
          0%, 100% { transform: translateY(0) rotate(0deg); }
          25%, 75% { transform: translateY(-4px) rotate(180deg); }
        }
        @keyframes agy-trick-levitate {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-14px); }
        }
        @keyframes agy-trick-shake {
          0%, 100% { transform: translateX(0); }
          20% { transform: translateX(-3px) rotate(-5deg); }
          40% { transform: translateX(3px) rotate(5deg); }
          60% { transform: translateX(-3px) rotate(-5deg); }
          80% { transform: translateX(3px) rotate(5deg); }
        }
        @keyframes agy-trick-rainbow {
          0%, 100% { filter: hue-rotate(0deg); transform: scale(1); }
          50% { filter: hue-rotate(180deg); transform: scale(1.12); }
        }
        @keyframes agy-trick-blink-fast {
          0%, 100% { opacity: 1; }
          25%, 75% { opacity: 0.15; }
          50% { opacity: 0.9; }
        }
        @keyframes agy-trick-moonwalk {
          0%, 100% { transform: translateX(0); }
          33% { transform: translateX(-10px) skewX(8deg); }
          66% { transform: translateX(6px) skewX(-8deg); }
        }
        @keyframes agy-trick-sleep {
          0%, 100% { transform: scaleY(0.88) translateY(2px); }
          50% { transform: scaleY(0.96) translateY(1px); }
        }
        @keyframes agy-trick-tilt {
          0%, 100% { transform: rotate(0deg); }
          40%, 70% { transform: rotate(-16deg) translateY(-3px); }
        }
        @keyframes agy-trick-sneeze {
          0%, 100% { transform: scale(1); }
          35% { transform: scale(0.86) translateY(2px); }
          60% { transform: scale(1.18) translateY(-8px) rotate(12deg); }
        }
        @keyframes agy-trick-spring {
          0%, 100% { transform: scaleY(1) translateY(0); }
          20% { transform: scaleY(0.75) translateY(4px); }
          55% { transform: scaleY(1.15) translateY(-22px); }
          80% { transform: scaleY(0.9) translateY(2px); }
        }
        @keyframes agy-trick-stealth {
          0%, 100% { opacity: 1; }
          30%, 70% { opacity: 0.22; }
        }
        @keyframes agy-trick-bounce {
          0%, 100% { transform: translateY(0) scale(1); }
          40% { transform: translateY(-12px) scale(1.08); }
          70% { transform: translateY(2px) scale(0.95); }
        }
        .agy-pet-body { transform-origin: 20px 26px; animation: agy-pet-breathe 2.6s ease-in-out infinite; }
        .agy-pet-eye { transform-origin: 20px 18px; animation: agy-pet-blink 4.2s ease-in-out infinite; }
        .agy-pet-tail { transform-origin: 30px 25px; animation: agy-pet-tail 2.2s ease-in-out infinite; }
        .agy-pet-heart { animation: agy-pet-heart 0.9s ease-out forwards; }
        .agy-trick-backflip { animation: agy-trick-backflip 0.8s cubic-bezier(0.22, 1, 0.36, 1); }
        .agy-trick-spin { animation: agy-trick-spin 0.9s ease-in-out; }
        .agy-trick-spin-y { animation: agy-trick-spin-y 0.95s ease-in-out; }
        .agy-trick-handstand { animation: agy-trick-handstand 1.25s ease-in-out; }
        .agy-trick-levitate { animation: agy-trick-levitate 1.3s ease-in-out; }
        .agy-trick-shake { animation: agy-trick-shake 0.5s ease-in-out 2; }
        .agy-trick-rainbow { animation: agy-trick-rainbow 1.2s linear; }
        .agy-trick-blink-fast { animation: agy-trick-blink-fast 0.85s ease-in-out; }
        .agy-trick-moonwalk { animation: agy-trick-moonwalk 1.1s ease-in-out; }
        .agy-trick-sleep { animation: agy-trick-sleep 1.4s ease-in-out; }
        .agy-trick-tilt { animation: agy-trick-tilt 0.95s ease-in-out; }
        .agy-trick-sneeze { animation: agy-trick-sneeze 0.8s ease-out; }
        .agy-trick-spring { animation: agy-trick-spring 0.9s cubic-bezier(0.22, 1, 0.36, 1); }
        .agy-trick-stealth { animation: agy-trick-stealth 1.2s ease-in-out; }
        .agy-trick-bounce { animation: agy-trick-bounce 0.6s ease-out; }
      `}</style>

      {createPortal(
        <div
          ref={petBoxRef}
          style={{
            position: 'fixed',
            left: 0,
            top: 0,
            zIndex: 45,
            opacity: visible ? 1 : 0,
            transition: 'opacity 180ms ease',
            pointerEvents: visible ? 'auto' : 'none',
          }}
          className="select-none"
        >
          {bubbleText && (
            <div
              className="pointer-events-none absolute -top-8 right-0 max-w-[180px] whitespace-nowrap rounded-full border border-border/70 bg-card/95 px-2.5 py-1 text-[11px] font-medium text-foreground shadow-md backdrop-blur-md"
              role="status"
            >
              {bubbleText}
            </div>
          )}

          {trickProp && (
            <span
              className="pointer-events-none absolute -left-4 -top-2 text-sm drop-shadow-sm animate-bounce"
              aria-hidden
            >
              {trickProp}
            </span>
          )}

          {happyBurst > 0 && (
            <span
              key={happyBurst}
              className="agy-pet-heart pointer-events-none absolute -top-3 left-3 text-xs text-rose-400"
              aria-hidden
            >
              ♥
            </span>
          )}

          <button
            type="button"
            onClick={handleTap}
            title="点击查看实时额度 / 摸摸小灵宠"
            aria-label="星云小灵宠，点击查看实时额度"
            className="group relative flex h-8 w-10 cursor-pointer items-end justify-center focus:outline-none active:scale-95"
          >
          <div
            ref={petVisualRef}
            style={{ transition: 'transform 260ms ease' }}
            className="origin-center"
          >
            <svg
              viewBox="0 0 40 32"
              className={`h-8 w-10 drop-shadow-[0_3px_6px_rgba(79,70,229,0.28)] transition-transform duration-200 group-hover:-translate-y-0.5 ${trickClass}`}
              aria-hidden
            >
              <defs>
                <linearGradient id="agyPetBodyGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#60a5fa" />
                  <stop offset="55%" stopColor="#818cf8" />
                  <stop offset="100%" stopColor="#a78bfa" />
                </linearGradient>
                <linearGradient id="agyPetEarInner" x1="0%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stopColor="#fbcfe8" />
                  <stop offset="100%" stopColor="#c4b5fd" />
                </linearGradient>
              </defs>

              <path
                d="M29 25 Q37 22 36 14 Q35 11 33 13"
                fill="none"
                stroke="#818cf8"
                strokeWidth="3.2"
                strokeLinecap="round"
                className="agy-pet-tail"
              />

              <g className="agy-pet-body">
                <path
                  d="M9 26 C9 17, 13 13, 20 13 C27 13, 31 17, 31 26 C31 28.5, 29 29.5, 26.5 29.5 L13.5 29.5 C11 29.5, 9 28.5, 9 26 Z"
                  fill="url(#agyPetBodyGrad)"
                />
                <path d="M11 16 L9.5 6.5 L17 12 Z" fill="url(#agyPetBodyGrad)" strokeLinejoin="round" />
                <path d="M11.6 14.5 L10.8 8.8 L15.5 12.2 Z" fill="url(#agyPetEarInner)" />
                <path d="M29 16 L30.5 6.5 L23 12 Z" fill="url(#agyPetBodyGrad)" strokeLinejoin="round" />
                <path d="M28.4 14.5 L29.2 8.8 L24.5 12.2 Z" fill="url(#agyPetEarInner)" />

                <ellipse cx="20" cy="24.5" rx="6.2" ry="3.6" fill="#eff6ff" opacity="0.92" />

                <g className="agy-pet-eye">
                  <ellipse cx="15.8" cy="18.2" rx="1.5" ry="1.8" fill="#ffffff" />
                  <circle cx="16.1" cy="18.4" r="0.85" fill="#1e1b4b" />
                  <ellipse cx="24.2" cy="18.2" rx="1.5" ry="1.8" fill="#ffffff" />
                  <circle cx="24.5" cy="18.4" r="0.85" fill="#1e1b4b" />
                </g>

                <ellipse cx="12.6" cy="20.2" rx="1.4" ry="0.8" fill="#fda4af" opacity="0.7" />
                <ellipse cx="27.4" cy="20.2" rx="1.4" ry="0.8" fill="#fda4af" opacity="0.7" />

                <ellipse cx="14" cy="29.4" rx="2.6" ry="1.6" fill="#dbeafe" />
                <ellipse cx="26" cy="29.4" rx="2.6" ry="1.6" fill="#dbeafe" />
              </g>
            </svg>
          </div>
          </button>
        </div>,
        document.body
      )}

      {open &&
        createPortal(
          <div
            ref={popupRef}
            onClick={(e) => e.stopPropagation()}
            className="fixed inset-x-4 bottom-24 z-50 mx-auto w-[min(300px,calc(100vw-2rem))] rounded-2xl border border-border/75 bg-card/95 p-3.5 text-xs shadow-2xl backdrop-blur-md"
          >
            <div className="flex items-center justify-between gap-2 border-b border-border/50 pb-2">
              <div className="min-w-0">
                <div className="font-semibold text-foreground">实时额度概览</div>
                <div className="truncate text-[11px] text-muted-foreground">
                  {quota?.accountEmail || '正在读取当前账号...'}
                </div>
              </div>
              <button
                type="button"
                onClick={() => void refresh(true)}
                disabled={loading}
                title="刷新实时额度"
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border/60 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
              </button>
            </div>

            {!quota ? (
              <div className="py-3 text-center text-muted-foreground">
                {loading ? '正在查询额度...' : '暂无额度数据，点击右上角刷新'}
              </div>
            ) : (
              <div className="mt-2.5 space-y-2.5">
                {quota.gemini5h && (
                  <div>
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-foreground">Gemini 5h</span>
                      <div className="flex items-center gap-1.5">
                        <span className="tabular-nums font-semibold text-foreground">
                          {quota.gemini5h.percent.toFixed(1)}%
                        </span>
                        <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${formatQuotaBadge(quota.gemini5h.percent).cls}`}>
                          {formatQuotaBadge(quota.gemini5h.percent).text}
                        </span>
                      </div>
                    </div>
                    <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className={`h-full rounded-full transition-all duration-300 ${formatQuotaColor(quota.gemini5h.percent)}`}
                        style={{ width: `${Math.max(2, Math.min(100, quota.gemini5h.percent))}%` }}
                      />
                    </div>
                    {quota.gemini5h.resetsIn && (
                      <div className="mt-0.5 text-[10px] text-muted-foreground">
                        重置剩余：{quota.gemini5h.resetsIn}
                      </div>
                    )}
                  </div>
                )}

                {quota.geminiWeekly && (
                  <div>
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-foreground">Gemini 周额度</span>
                      <div className="flex items-center gap-1.5">
                        <span className="tabular-nums font-semibold text-foreground">
                          {quota.geminiWeekly.percent.toFixed(1)}%
                        </span>
                        <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${formatQuotaBadge(quota.geminiWeekly.percent).cls}`}>
                          {formatQuotaBadge(quota.geminiWeekly.percent).text}
                        </span>
                      </div>
                    </div>
                    <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className={`h-full rounded-full transition-all duration-300 ${formatQuotaColor(quota.geminiWeekly.percent)}`}
                        style={{ width: `${Math.max(2, Math.min(100, quota.geminiWeekly.percent))}%` }}
                      />
                    </div>
                    {quota.geminiWeekly.resetsIn && (
                      <div className="mt-0.5 text-[10px] text-muted-foreground">
                        重置剩余：{quota.geminiWeekly.resetsIn}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>,
          document.body
        )}
    </>
  );
}

export const PetCardPerch = PetStageOverlay;
