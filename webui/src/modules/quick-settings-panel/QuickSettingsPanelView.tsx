import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';

import { useDeviceSettings } from '@/shared/hooks/useDeviceSettings';
import { useUiPreferences, useSetUiPreference } from '@/shared/context/UiPreferencesContext';
import { useTheme } from '@/shared/context/ThemeContext';
import { useQuickSettingsDrag } from '@/modules/quick-settings-panel/hooks/useQuickSettingsDrag';
import { cn } from '@/shared/utils';
import type { PreferenceToggleKey, QuickSettingsPreferences } from '@/shared/types';
import QuickSettingsContent from '@/modules/quick-settings-panel/QuickSettingsContent';
import QuickSettingsHandle from '@/modules/quick-settings-panel/QuickSettingsHandle';
import QuickSettingsPanelHeader from '@/modules/quick-settings-panel/QuickSettingsPanelHeader';

type QuickSettingsPanelProps = {
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  onOpenFullSettings?: () => void;
  showEdgeHandle?: boolean;
};

/**
 * Exported as QuickSettingsPanel and rendered by ProjectQuickSettingsRegion (via WorkspaceHeader
 * trigger) as a modern floating control center drawer on desktop and bottom sheet on mobile.
 */
function QuickSettingsPanelView({
  isOpen: controlledOpen,
  onOpenChange,
  onOpenFullSettings,
  showEdgeHandle = true,
}: QuickSettingsPanelProps) {
  // Manages visibility when rendered standalone without controlled props from the workspace header.
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const isOpen = isControlled ? controlledOpen : uncontrolledOpen;
  const setOpen = useCallback(
    (next: boolean) => {
      if (!isControlled) {
        setUncontrolledOpen(next);
      }
      onOpenChange?.(next);
    },
    [isControlled, onOpenChange],
  );

  const { isMobile } = useDeviceSettings({ trackPWA: false });
  const { isDarkMode } = useTheme();
  const preferences = useUiPreferences();
  const setPreference = useSetUiPreference();
  const {
    isDragging,
    handleStyle,
    startDrag,
    consumeSuppressedClick,
  } = useQuickSettingsDrag({ isMobile });

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, setOpen]);

  const quickSettingsPreferences = useMemo<QuickSettingsPreferences>(() => ({
    showRawParameters: preferences.showRawParameters,
    showThinking: preferences.showThinking,
    sendByCtrlEnter: preferences.sendByCtrlEnter,
    voiceEnabled: preferences.voiceEnabled,
  }), [
    preferences.sendByCtrlEnter,
    preferences.showRawParameters,
    preferences.showThinking,
    preferences.voiceEnabled,
  ]);

  const handlePreferenceChange = useCallback(
    (key: PreferenceToggleKey, value: boolean) => {
      setPreference(key, value);
    },
    [setPreference],
  );

  const handleToggleFromHandle = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>) => {
      // A drag releases a click event as well; this guard prevents accidental toggles.
      if (consumeSuppressedClick()) {
        event.preventDefault();
        return;
      }

      setOpen(!isOpen);
    },
    [consumeSuppressedClick, isOpen, setOpen],
  );

  return (
    <>
      {showEdgeHandle && (
        <QuickSettingsHandle
          isOpen={isOpen}
          isDragging={isDragging}
          style={handleStyle}
          onClick={handleToggleFromHandle}
          onMouseDown={startDrag}
          onTouchStart={startDrag}
        />
      )}

      {isOpen && (
        <>
          <div
            className="backdrop-blur-xs fixed inset-0 z-[9050] bg-slate-900/25 transition-opacity duration-200 dark:bg-black/55"
            onClick={() => setOpen(false)}
          />

          <div
            role="dialog"
            aria-modal="true"
            className={cn(
              'fixed z-[9100] flex flex-col overflow-hidden border border-slate-200/80 bg-card/95 text-card-foreground shadow-2xl backdrop-blur-2xl dark:border-white/[0.09] dark:bg-zinc-900/95',
              isMobile
                ? 'sheet-enter inset-x-2 bottom-2 max-h-[84vh] rounded-3xl'
                : 'popover-enter bottom-3 right-3 top-3 w-80 rounded-2xl',
            )}
          >
            <QuickSettingsPanelHeader
              isMobile={isMobile}
              onClose={() => setOpen(false)}
            />
            <QuickSettingsContent
              isDarkMode={isDarkMode}
              preferences={quickSettingsPreferences}
              onPreferenceChange={handlePreferenceChange}
              onOpenFullSettings={onOpenFullSettings}
              isMobile={isMobile}
            />
          </div>
        </>
      )}
    </>
  );
}

export default memo(QuickSettingsPanelView);
