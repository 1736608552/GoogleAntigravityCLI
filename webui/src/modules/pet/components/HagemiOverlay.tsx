import React, { useEffect, useRef, useState } from 'react';
import { bootHagemi, type HagemiPetInstance } from '../engine/hagemiEngine';
import { useHagemiSettings } from '../petSettingsStore';
import { useHagemiDirector } from '../hooks/useHagemiDirector';

export const HagemiOverlay: React.FC = () => {
  const [settings, updateSettings] = useHagemiSettings();
  const [pet, setPet] = useState<HagemiPetInstance | null>(null);
  const mountedRef = useRef(false);

  // 1. 初始化并挂载桌宠渲染器
  useEffect(() => {
    if (mountedRef.current) return;
    mountedRef.current = true;

    let instance: HagemiPetInstance | null = null;

    bootHagemi({
      initialSettings: settings,
      onPositionChange: (pos) => {
        // 拖动释放后保存新坐标到 localStorage
        if (typeof pos?.x === 'number' && typeof pos?.y === 'number') {
          updateSettings({
            position: { x: pos.x, y: pos.y },
          });
        }
      },
      onSettingsChange: (patch) => {
        // 用户在桌宠长按弹窗中修改设置时，双向同步回 WebUI 的状态与 localStorage
        const updates: any = {};
        if (patch.size) updates.size = patch.size;
        if (patch.language) updates.lang = patch.language === 'en' ? 'en' : 'zhs';
        if (patch.chattiness) updates.chattiness = patch.chattiness;
        if (patch.muted !== undefined) updates.chattiness = patch.muted ? 'silent' : 'normal';
        updateSettings(updates);
      },
      onError: (err) => {
        console.warn('[HagemiOverlay] Engine initialization warning:', err);
      },
    }).then((created) => {
      instance = created;
      setPet(created);
    });

    return () => {
      mountedRef.current = false;
      if (instance) {
        instance.dispose();
      }
    };
  }, []);

  // 2. 状态指挥与配额事件监听
  useHagemiDirector({ pet, settings });

  // 本组件由内部 WebGL & Closed Shadow DOM 独立接管渲染，对外零 DOM 树侵入
  return null;
};

export default HagemiOverlay;
