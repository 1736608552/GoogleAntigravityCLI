import { Settings, Sparkles, PanelLeftOpen, AlertTriangle } from 'lucide-react';
import type { TFunction } from 'i18next';

type SidebarCollapsedProps = {
  onExpand: () => void;
  onShowSettings: () => void;
  updateAvailable: boolean;
  restartRequired: boolean;
  onShowVersionModal: () => void;
  t: TFunction;
};

/** Rendered by Sidebar instead of SidebarContent when the panel is collapsed to its icon rail. */
export default function SidebarCollapsed({
  onExpand,
  onShowSettings,
  updateAvailable,
  restartRequired,
  onShowVersionModal,
  t,
}: SidebarCollapsedProps) {
  return (
    <div className="flex h-full w-14 flex-col items-center gap-1.5 bg-transparent py-3">
      {/* Expand button with brand logo */}
      <button
        onClick={onExpand}
        className="hover:shadow-xs group flex h-9 w-9 items-center justify-center rounded-xl text-muted-foreground transition-all hover:bg-card hover:text-foreground active:scale-95"
        aria-label={t('common:versionUpdate.ariaLabels.showSidebar')}
        title={t('common:versionUpdate.ariaLabels.showSidebar')}
      >
        <PanelLeftOpen className="h-4 w-4 transition-colors" />
      </button>

      <div className="nav-divider my-1 w-7" />

      {/* Settings */}
      <button
        onClick={onShowSettings}
        className="hover:shadow-xs group flex h-9 w-9 items-center justify-center rounded-xl text-muted-foreground transition-all hover:bg-card hover:text-foreground active:scale-95"
        aria-label={t('actions.settings')}
        title={t('actions.settings')}
      >
        <Settings className="h-4 w-4 transition-colors" />
      </button>

      {/* Restart-required indicator */}
      {restartRequired && (
        <div
          className="relative flex h-8 w-8 items-center justify-center rounded-lg"
          aria-label={t('version.restartRequired')}
          title={t('version.restartRequired')}
        >
          <AlertTriangle className="h-4 w-4 text-amber-500" />
          <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500" />
        </div>
      )}

      {/* Update indicator */}
      {updateAvailable && (
        <button
          onClick={onShowVersionModal}
          className="relative flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-accent/80"
          aria-label={t('common:versionUpdate.ariaLabels.updateAvailable')}
          title={t('common:versionUpdate.ariaLabels.updateAvailable')}
        >
          <Sparkles className="h-4 w-4 text-blue-500" />
          <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 animate-pulse rounded-full bg-blue-500" />
        </button>
      )}
    </div>
  );
}
