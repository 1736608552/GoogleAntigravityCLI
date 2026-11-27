import { useCallback, useEffect, useRef } from 'react';

import { api } from '@/shared/api';

/**
 * 两次预热请求之间的最小间隔。
 * 后端在代理已运行时只做状态判断，本身是幂等且零流量的；这里节流只是避免每敲一个键都发一次 HTTP。
 */
const THROTTLE_MS = 15_000;

/**
 * 用户「开始在输入框打字」时提前唤醒 Antigravity 的按需代理（Scale-to-Zero）。
 *
 * 背景：代理冷启动（进程启动 → 首个合约可用）中位 4.2s。原来是点了发送才唤醒，
 * 这段时间全算在用户等待里。提前到开始打字，就被输入的时间盖住了。
 *
 * 触发点：
 *  - 键盘按下（含中文输入法的 composition 开始——此时 key 是 'Process'，不是具体字符）
 *  - 粘贴
 *  - 输入框获得焦点
 *  - 页面从后台切回前台（用户大概率马上要继续对话）
 *
 * 调用方可放心传 enabled=false：此时所有触发点都直接返回，不发任何请求。
 */
export function useProxyPrewarm(enabled: boolean): {
  onKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onPaste: () => void;
  onFocus: () => void;
} {
  const lastSentAtRef = useRef(0);
  // 用 ref 保存最新开关，让回调保持稳定引用，不给下游 memo 添麻烦
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const fire = useCallback(() => {
    if (!enabledRef.current) return;
    const now = Date.now();
    if (now - lastSentAtRef.current < THROTTLE_MS) return;
    lastSentAtRef.current = now;
    // 预热是尽力而为：失败、超时、离线都静默，绝不打扰输入
    api.providers.prewarmAntigravityProxy().catch(() => {});
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') fire();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [enabled, fire]);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // 纯修饰键不算「开始输入」
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const key = event.key;
      // 普通字符（长度 1）、退格、回车，以及输入法组合态的 'Process'
      const isTyping = key.length === 1 || key === 'Backspace' || key === 'Enter' || key === 'Process';
      if (!isTyping) return;
      fire();
    },
    [fire],
  );

  return { onKeyDown, onPaste: fire, onFocus: fire };
}
