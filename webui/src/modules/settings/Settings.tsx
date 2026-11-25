import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { ProviderLoginModal } from '@/modules/provider-auth';
import { Button } from '@/shared/ui';
import { cn } from '@/shared/utils';
import SettingsSidebar from '@/modules/settings/SettingsSidebar';
import AgentsSettingsTab from '@/modules/settings/tabs/agents-settings/AgentsSettingsTab';
import AppearanceSettingsTab from '@/modules/settings/tabs/AppearanceSettingsTab';
import CredentialsSettingsTab from '@/modules/settings/tabs/api-settings/CredentialsSettingsTab';
import VoiceSettingsTab from '@/modules/settings/tabs/VoiceSettingsTab';
import GitSettingsTab from '@/modules/settings/tabs/git-settings/GitSettingsTab';
import BrowserUseSettingsTab from '@/modules/settings/tabs/browser-use-settings/BrowserUseSettingsTab';
import NotificationsSettingsTab from '@/modules/settings/tabs/NotificationsSettingsTab';
import { PluginSettingsTab } from '@/modules/plugins';
import AboutTab from '@/modules/settings/tabs/AboutTab';
import { useSettingsController } from '@/modules/settings/hooks/useSettingsController';
import { useWebPush } from '@/modules/settings/hooks/useWebPush';
import type { AgentSettingsProject } from '@/shared/types';

type SettingsProps = {
  isOpen: boolean;
  onClose: () => void;
  projects?: AgentSettingsProject[];
  initialTab?: string;
};

type DesktopNotificationsState = {
  enabled: boolean;
  supported: boolean;
  connectedCount?: number;
  targetCount?: number;
  lastError?: string | null;
};

/** Exported as the settings module's public entry point and rendered by the sidebar module as its settings dialog. */
function Settings({ isOpen, onClose, projects = [], initialTab = 'agents' }: SettingsProps) {
  const { t } = useTranslation('settings');
  const desktopNotificationsBridge = useMemo(() => (
    typeof window === 'undefined'
      ? null
      : ((window as any).cloudcliDesktopNotifications || null)
  ), []);
  const [desktopNotificationsState, setDesktopNotificationsState] = useState<DesktopNotificationsState | null>(null);
  const {
    activeTab,
    setActiveTab,
    saveStatus,
    projectSortOrder,
    setProjectSortOrder,
    codeEditorSettings,
    updateCodeEditorSetting,
    antigravityPermissions,
    setAntigravityPermissions,
    antigravityPermissionMode,
    setAntigravityPermissionMode,
    claudePermissions,
    setClaudePermissions,
    notificationPreferences,
    setNotificationPreferences,
    cursorPermissions,
    setCursorPermissions,
    codexPermissionMode,
    setCodexPermissionMode,
    providerAuthStatus,
    refreshProviderAuthStatuses,
    openLoginForProvider,
    showLoginModal,
    setShowLoginModal,
    loginProvider,
    handleLoginComplete,
  } = useSettingsController({
    isOpen,
    initialTab
  });

  const {
    permission: pushPermission,
    isSubscribed: isPushSubscribed,
    isLoading: isPushLoading,
    subscribe: pushSubscribe,
    unsubscribe: pushUnsubscribe,
  } = useWebPush();

  const handleEnablePush = async () => {
    await pushSubscribe();
    // Server sets webPush: true in preferences on subscribe; sync local state
    setNotificationPreferences({
      ...notificationPreferences,
      channels: { ...notificationPreferences.channels, webPush: true },
    });
  };

  const handleDisablePush = async () => {
    await pushUnsubscribe();
    // Server sets webPush: false in preferences on unsubscribe; sync local state
    setNotificationPreferences({
      ...notificationPreferences,
      channels: { ...notificationPreferences.channels, webPush: false },
    });
  };

  useEffect(() => {
    if (!desktopNotificationsBridge) return undefined;
    let mounted = true;
    desktopNotificationsBridge.getState().then((state: any) => {
      if (mounted) {
        setDesktopNotificationsState(state?.desktopNotifications || null);
      }
    }).catch(() => {});
    const unsubscribe = desktopNotificationsBridge.onStateUpdated?.((state: any) => {
      if (mounted) {
        setDesktopNotificationsState(state?.desktopNotifications || null);
      }
    });
    return () => {
      mounted = false;
      unsubscribe?.();
    };
  }, [desktopNotificationsBridge]);

  const handleEnableDesktopNotifications = async () => {
    if (!desktopNotificationsBridge) return;
    const state = await desktopNotificationsBridge.update({ enabled: true });
    setDesktopNotificationsState(state?.desktopNotifications || null);
    setNotificationPreferences({
      ...notificationPreferences,
      channels: { ...notificationPreferences.channels, desktop: true },
    });
  };

  const handleDisableDesktopNotifications = async () => {
    if (!desktopNotificationsBridge) return;
    const state = await desktopNotificationsBridge.update({ enabled: false });
    setDesktopNotificationsState(state?.desktopNotifications || null);
    setNotificationPreferences({
      ...notificationPreferences,
      channels: { ...notificationPreferences.channels, desktop: false },
    });
  };

  useEffect(() => {
    if (!isOpen || showLoginModal) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose, showLoginModal]);

  if (!isOpen) {
    return null;
  }

  const isAuthenticated = Boolean(loginProvider && providerAuthStatus[loginProvider].authenticated);

  return (
    <div
      className="modal-backdrop fixed inset-0 z-[9000] flex items-center justify-center bg-slate-900/25 backdrop-blur-md dark:bg-black/55 md:p-5"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="popover-enter flex h-full w-full flex-col overflow-hidden border border-slate-200/80 bg-background/95 shadow-2xl backdrop-blur-2xl dark:border-white/[0.09] md:h-[88vh] md:max-w-5xl md:rounded-2xl">
        {/* Header */}
        <div className="pwa-header-safe flex flex-shrink-0 items-center justify-between border-b border-border/60 bg-background/80 px-4 py-3 backdrop-blur-md md:px-6">
          <div className="flex items-center gap-2.5">
            <h2 className="text-base font-semibold tracking-tight text-foreground md:text-lg">{t('title')}</h2>
          </div>
          <div className="flex items-center gap-2">
            {saveStatus === 'success' && (
              <span className="animate-in fade-in bg-emerald-500/12 rounded-full px-2.5 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-300">
                {t('saveStatus.success')}
              </span>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              aria-label={t('common:actions.close', { defaultValue: 'Close' })}
              className="h-9 w-9 touch-manipulation rounded-xl bg-muted/60 p-0 text-muted-foreground transition-all hover:bg-muted hover:text-foreground active:scale-95"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Body: sidebar + content */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col md:flex-row">
          <SettingsSidebar activeTab={activeTab} onChange={setActiveTab} />

          {/* Content */}
          <main className={cn(
            "min-w-0 flex-1 overflow-x-hidden",
            activeTab === 'agents' ? "flex flex-col min-h-0 overflow-hidden" : "overflow-y-auto"
          )}>
            <div key={activeTab} className={cn(
              "settings-content-enter min-w-0 overflow-x-hidden",
              activeTab === 'agents'
                ? "flex flex-1 flex-col min-h-0 p-0"
                : "space-y-6 p-4 pb-safe-area-inset-bottom md:space-y-8 md:p-6"
            )}>
              {activeTab === 'appearance' && (
                <AppearanceSettingsTab
                  projectSortOrder={projectSortOrder}
                  onProjectSortOrderChange={setProjectSortOrder}
                  codeEditorSettings={codeEditorSettings}
                  onCodeEditorWordWrapChange={(value) => updateCodeEditorSetting('wordWrap', value)}
                  onCodeEditorShowMinimapChange={(value) => updateCodeEditorSetting('showMinimap', value)}
                  onCodeEditorLineNumbersChange={(value) => updateCodeEditorSetting('lineNumbers', value)}
                  onCodeEditorFontSizeChange={(value) => updateCodeEditorSetting('fontSize', value)}
                />
              )}

              {activeTab === 'git' && <GitSettingsTab />}

              {activeTab === 'agents' && (
                <AgentsSettingsTab
                  providerAuthStatus={providerAuthStatus}
                  onProviderLogin={openLoginForProvider}
                  antigravityPermissions={antigravityPermissions}
                  onAntigravityPermissionsChange={setAntigravityPermissions}
                  antigravityPermissionMode={antigravityPermissionMode}
                  onAntigravityPermissionModeChange={setAntigravityPermissionMode}
                  claudePermissions={claudePermissions}
                  onClaudePermissionsChange={setClaudePermissions}
                  cursorPermissions={cursorPermissions}
                  onCursorPermissionsChange={setCursorPermissions}
                  codexPermissionMode={codexPermissionMode}
                  onCodexPermissionModeChange={setCodexPermissionMode}
                  projects={projects}
                  onRefreshProviderAuth={refreshProviderAuthStatuses}
                />
              )}

              {activeTab === 'browser' && <BrowserUseSettingsTab />}

              {activeTab === 'notifications' && (
                <NotificationsSettingsTab
                  notificationPreferences={notificationPreferences}
                  onNotificationPreferencesChange={setNotificationPreferences}
                  pushPermission={pushPermission}
                  isPushSubscribed={isPushSubscribed}
                  isPushLoading={isPushLoading}
                  onEnablePush={handleEnablePush}
                  onDisablePush={handleDisablePush}
                  isDesktop={Boolean(desktopNotificationsBridge)}
                  desktopNotifications={desktopNotificationsState}
                  onEnableDesktopNotifications={handleEnableDesktopNotifications}
                  onDisableDesktopNotifications={handleDisableDesktopNotifications}
                />
              )}

              {activeTab === 'api' && <CredentialsSettingsTab />}

              {activeTab === 'voice' && <VoiceSettingsTab />}

              {activeTab === 'plugins' && <PluginSettingsTab />}

              {activeTab === 'about' && <AboutTab />}
            </div>
          </main>
        </div>
      </div>

      <ProviderLoginModal
        key={loginProvider || 'claude'}
        isOpen={showLoginModal}
        onClose={() => setShowLoginModal(false)}
        provider={loginProvider || 'claude'}
        onComplete={handleLoginComplete}
        isAuthenticated={isAuthenticated}
      />

    </div>
  );
}

export default Settings;
