import { useEffect, useState } from 'react';
import type { HagemiSettings } from './types';

const STORAGE_KEY = 'hagemi_pet_settings_v1';

export const DEFAULT_HAGEMI_SETTINGS: HagemiSettings = {
  enabled: true,
  size: 'm',
  position: {
    x: 0.88,
    y: 0.72,
  },
  lang: 'zhs',
  chattiness: 'normal',
  quotaFish: true,
  dockingEnabled: true,
  soundEnabled: true,
};

let currentSettings: HagemiSettings = loadSettings();
const listeners = new Set<(settings: HagemiSettings) => void>();

function loadSettings(): HagemiSettings {
  if (typeof window === 'undefined') return DEFAULT_HAGEMI_SETTINGS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_HAGEMI_SETTINGS;
    const parsed = JSON.parse(raw);

    // 平滑升级策略：如果为历史旧版本缓存，将默认尺寸自动调整为手感最佳的标准手办 'm' (138px)
    let size = parsed?.size;
    if (parsed?._v !== 3) {
      if (!size || size === 's' || size === 'm') {
        size = 'm';
      }
    }
    if (!['xs', 's', 'm', 'l', 'xl'].includes(size)) {
      size = 'm';
    }

    return {
      ...DEFAULT_HAGEMI_SETTINGS,
      ...parsed,
      size,
      position: {
        x: typeof parsed?.position?.x === 'number' ? Math.max(0.02, Math.min(0.95, parsed.position.x)) : DEFAULT_HAGEMI_SETTINGS.position.x,
        y: typeof parsed?.position?.y === 'number' ? Math.max(0.02, Math.min(0.95, parsed.position.y)) : DEFAULT_HAGEMI_SETTINGS.position.y,
      },
    };
  } catch {
    return DEFAULT_HAGEMI_SETTINGS;
  }
}

function saveSettings(settings: HagemiSettings) {
  currentSettings = settings;
  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...settings, _v: 3 }));
    } catch {}
  }
  listeners.forEach((fn) => {
    try {
      fn(settings);
    } catch {}
  });
}

export function getHagemiSettings(): HagemiSettings {
  return currentSettings;
}

export function updateHagemiSettings(partial: Partial<HagemiSettings>) {
  const updated: HagemiSettings = {
    ...currentSettings,
    ...partial,
    position: partial.position
      ? {
          x: Math.max(0.02, Math.min(0.95, partial.position.x)),
          y: Math.max(0.02, Math.min(0.95, partial.position.y)),
        }
      : currentSettings.position,
  };
  saveSettings(updated);
}

export function resetHagemiPosition() {
  updateHagemiSettings({
    position: { ...DEFAULT_HAGEMI_SETTINGS.position },
  });
}

/** React Hook 用于组件订阅和响应设置变动 */
export function useHagemiSettings(): [HagemiSettings, (partial: Partial<HagemiSettings>) => void] {
  const [settings, setSettings] = useState<HagemiSettings>(currentSettings);

  useEffect(() => {
    const handler = (newSettings: HagemiSettings) => {
      setSettings(newSettings);
    };
    listeners.add(handler);
    return () => {
      listeners.delete(handler);
    };
  }, []);

  return [settings, updateHagemiSettings];
}
