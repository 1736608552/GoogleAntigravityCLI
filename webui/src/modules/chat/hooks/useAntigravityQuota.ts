import { useCallback, useEffect, useState } from 'react';
import { api, readApiJson } from '@/shared/api';
import type { AntigravityQuotaSnapshot } from '@/shared/types';

let cachedQuotaSnapshot: AntigravityQuotaSnapshot | null = null;
let lastFetchTime = 0;
const listeners = new Set<(quota: AntigravityQuotaSnapshot | null) => void>();

function unwrapQuotaSnapshot(raw: any): AntigravityQuotaSnapshot | null {
  if (!raw) return null;
  if (typeof raw === 'object' && 'data' in raw && raw.data) {
    return raw.data as AntigravityQuotaSnapshot;
  }
  return raw as AntigravityQuotaSnapshot;
}

const perAccountSnapshots = new Map<string, AntigravityQuotaSnapshot>();

function notifyListeners(quota: any) {
  const unwrapped = unwrapQuotaSnapshot(quota);
  if (unwrapped) {
    cachedQuotaSnapshot = unwrapped;
    if (unwrapped.accountEmail) {
      perAccountSnapshots.set(unwrapped.accountEmail.toLowerCase(), unwrapped);
    }
  }
  listeners.forEach((listener) => listener(unwrapped));
}

export function cleanAndTranslateResetDesc(text?: string | null): string {
  if (!text) return '正常';
  const s = String(text).trim();
  if (!s || s === '正常' || s === '随时可用' || s === '即将重置') return s;

  // 1. 匹配 Google 官方描述中的刷新时间: "(...) fully refresh in 3 hours" / "reset in 2 hours" / "access again in 1 hour"
  const mRefresh = s.match(/(?:fully\s+refresh|resets?|access\s+again)\s+in\s+(\d+)\s*(?:hours?|h)(?:\s*(?:and\s*)?(\d+)\s*(?:min(?:ute)?s?|m))?/i);
  if (mRefresh) {
    const h = mRefresh[1];
    const m = mRefresh[2];
    if (h && m) return `${h}小时 ${m}分钟`;
    if (h) return `${h}小时`;
  }
  const mMinOnly = s.match(/(?:fully\s+refresh|resets?|access\s+again)\s+in\s+(\d+)\s*(?:min(?:ute)?s?|m)/i);
  if (mMinOnly) {
    return `${mMinOnly[1]}分钟`;
  }

  // 2. 英文天数 + 小时: "6 days, 7 hours" / "6 days"
  const mDayHour = s.match(/(\d+)\s*days?(?:\s*,?\s*(\d+)\s*hours?)?/i);
  if (mDayHour) {
    const d = mDayHour[1];
    const h = mDayHour[2];
    return h && h !== '0' ? `${d}天 ${h}小时` : `${d}天`;
  }

  // 3. 英文小时 + 分钟: "4 hours, 30 minutes" / "4h 30m" / "4 hours" / "30 minutes"
  const mHourMin = s.match(/(?:(\d+)\s*(?:hours?|h))?\s*,?\s*(?:(\d+)\s*(?:min(?:ute)?s?|m))?/i);
  if (mHourMin && (mHourMin[1] || mHourMin[2])) {
    const h = mHourMin[1];
    const m = mHourMin[2];
    if (h && m) return `${h}小时 ${m}分钟`;
    if (h) return `${h}小时`;
    if (m) return `${m}分钟`;
  }

  // 4. 中文天/小时/分钟已正常的情况，直接返回
  if (/(\d+)\s*天|(\d+)\s*小时|(\d+)\s*分钟/.test(s)) {
    return s;
  }

  // 5. 其他英文提示保底翻译
  if (/limit|quota|refresh|used|reach/i.test(s)) {
    return '即将重置';
  }

  return s;
}

export function formatDynamicCountdown(
  isoString?: string | null,
  fallbackText?: string,
  _is5h: boolean = false,
  _percent?: number
): string {
  // 100% 纯实时根据 Google 官方云端返回的时间戳计算，绝不使用任何本地模拟、取模或脑补
  if (isoString) {
    const target = new Date(isoString).getTime();
    if (!isNaN(target)) {
      const diff = target - Date.now();
      if (diff > 60 * 1000) {
        const d = Math.floor(diff / (24 * 3600 * 1000));
        const rem = diff % (24 * 3600 * 1000);
        const h = Math.floor(rem / (3600 * 1000));
        const m = Math.floor((rem % (3600 * 1000)) / (60 * 1000));
        if (d > 0) return h > 0 ? `${d}天 ${h}小时` : `${d}天`;
        if (h > 0) return m > 0 ? `${h}小时 ${m}分钟` : `${h}小时`;
        return `${m}分钟`;
      }
      if (diff > 0) return '即将重置';
    }
  }

  if (fallbackText && !fallbackText.includes('查询中') && !fallbackText.includes('计算中') && !fallbackText.includes('即将')) {
    return cleanAndTranslateResetDesc(fallbackText);
  }

  return '正常';
}

export function formatPreciseTimeTag(str?: string | null): string {
  if (!str) return '即将重置';
  const cleanStr = cleanAndTranslateResetDesc(str);
  const s = String(cleanStr).trim();
  if (s === '即将重置' || s.includes('即将') || s.includes('计算中') || s.includes('查询中')) return '即将重置';
  
  // 1. Chinese day + hour: "6天 23小时" / "6天"
  const mDayHour = s.match(/(\d+)\s*天\s*(?:(\d+)\s*小时)?/);
  if (mDayHour) {
    const d = mDayHour[1];
    const h = mDayHour[2];
    return h && h !== '0' ? `${d}天${h}h` : `${d}天`;
  }
  
  // 2. Chinese hour + min: "4小时 59分钟" / "4小时" / "59分钟"
  const mHourMin = s.match(/(?:(\d+)\s*小时)?\s*(?:(\d+)\s*分钟)?/);
  if (mHourMin && (mHourMin[1] || mHourMin[2])) {
    const h = mHourMin[1];
    const m = mHourMin[2];
    if (h && m) return `${h}h ${m}m`;
    if (h) return `${h}h`;
    if (m) return `${m}m`;
  }

  // 3. English day + hour: "6 days, 23 hours"
  const mEngDayHour = s.match(/(\d+)\s*days?(?:\s*,?\s*(\d+)\s*hours?)?/i);
  if (mEngDayHour) {
    const d = mEngDayHour[1];
    const h = mEngDayHour[2];
    return h && h !== '0' ? `${d}天${h}h` : `${d}天`;
  }

  // 4. English hour + min: "4 hours, 35 minutes" / "4h 35m"
  const mEngHourMin = s.match(/(?:(\d+)\s*(?:hours?|h))?\s*,?\s*(?:(\d+)\s*(?:min(?:ute)?s?|m))?/i);
  if (mEngHourMin && (mEngHourMin[1] || mEngHourMin[2])) {
    const h = mEngHourMin[1];
    const m = mEngHourMin[2];
    if (h && m) return `${h}h ${m}m`;
    if (h) return `${h}h`;
    if (m) return `${m}m`;
  }

  return s;
}

export function getCachedAccountQuota(email?: string | null): AntigravityQuotaSnapshot | null {
  if (email) {
    const found = perAccountSnapshots.get(email.toLowerCase());
    if (found) return found;
    if (cachedQuotaSnapshot?.accountEmail && cachedQuotaSnapshot.accountEmail.toLowerCase() === email.toLowerCase()) {
      return cachedQuotaSnapshot;
    }
    return null;
  }
  return cachedQuotaSnapshot;
}

export async function fetchAntigravityQuota(force = false, email?: string): Promise<AntigravityQuotaSnapshot | null> {
  const now = Date.now();
  const cached = email ? perAccountSnapshots.get(email.toLowerCase()) : cachedQuotaSnapshot;
  // 10 秒轻度防抖，避免同一秒内并发击穿；但若指定账号无缓存或强制刷新，立刻穿透请求上游
  if (!force && cached && now - lastFetchTime < 10000) {
    return cached;
  }

  try {
    const res = await api.providers.antigravityQuota(force, email);
    if (res.ok) {
      const raw = await readApiJson<any>(res);
      const payload = unwrapQuotaSnapshot(raw);
      if (payload) {
        lastFetchTime = Date.now();
        notifyListeners(payload);
        return payload;
      }
    }
  } catch (_) {
    // ignore
  }
  return cached || cachedQuotaSnapshot;
}

export function updateCachedAntigravityQuota(snapshot: any) {
  if (snapshot) {
    const payload = unwrapQuotaSnapshot(snapshot);
    lastFetchTime = Date.now();
    notifyListeners(payload);
  }
}

export function useAntigravityQuota(targetEmail?: string) {
  const [quota, setQuota] = useState<AntigravityQuotaSnapshot | null>(() => {
    if (targetEmail) {
      const perAcc = perAccountSnapshots.get(targetEmail.toLowerCase());
      if (perAcc) return perAcc;
      if (cachedQuotaSnapshot?.accountEmail && cachedQuotaSnapshot.accountEmail.toLowerCase() === targetEmail.toLowerCase()) {
        return unwrapQuotaSnapshot(cachedQuotaSnapshot);
      }
      return null;
    }
    return unwrapQuotaSnapshot(cachedQuotaSnapshot);
  });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const handleUpdate = (nextQuota: any) => {
      const unwrapped = unwrapQuotaSnapshot(nextQuota);
      if (targetEmail && unwrapped?.accountEmail) {
        if (unwrapped.accountEmail.toLowerCase() === targetEmail.toLowerCase()) {
          setQuota(unwrapped);
        }
      } else {
        setQuota(unwrapped);
      }
    };
    listeners.add(handleUpdate);
    return () => {
      listeners.delete(handleUpdate);
    };
  }, [targetEmail]);

  const refreshQuota = useCallback(async (force = true, email?: string): Promise<AntigravityQuotaSnapshot | null> => {
    setLoading(true);
    try {
      return await fetchAntigravityQuota(force, email || targetEmail);
    } finally {
      setLoading(false);
    }
  }, [targetEmail]);

  useEffect(() => {
    const cached = targetEmail ? perAccountSnapshots.get(targetEmail.toLowerCase()) : cachedQuotaSnapshot;
    const shouldForce = !cached || (cached.percent ?? 0) >= 99.9;
    if (shouldForce || Date.now() - lastFetchTime > 15000) {
      void refreshQuota(shouldForce, targetEmail);
    }

    // Refresh every 30s
    const interval = setInterval(() => {
      void refreshQuota(false, targetEmail);
    }, 30000);

    return () => clearInterval(interval);
  }, [refreshQuota, targetEmail]);

  return {
    quota,
    loading,
    isLoading: loading,
    isRefreshing: loading,
    refreshQuota,
  };
}
