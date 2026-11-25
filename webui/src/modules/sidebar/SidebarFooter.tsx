import { Settings, ArrowUpCircle, AlertTriangle } from 'lucide-react';
import type { TFunction } from 'i18next';

import { IS_PLATFORM } from '@/shared/utils';
import type { ReleaseInfo } from '@/shared/types';


type SidebarFooterProps = {
  updateAvailable: boolean;
  restartRequired: boolean;
  releaseInfo: ReleaseInfo | null;
  latestVersion: string | null;
  currentVersion: string;
  onShowVersionModal: () => void;
  onShowSettings: () => void;
  t: TFunction;
};

/** Rendered by SidebarContent at the bottom of the panel for settings and update status. */
export default function SidebarFooter({
  updateAvailable,
  restartRequired,
  releaseInfo,
  latestVersion,
  currentVersion,
  onShowVersionModal,
  onShowSettings,
  t,
}: SidebarFooterProps) {
  return (
    <div className="flex-shrink-0" style={{ paddingBottom: 'env(safe-area-inset-bottom, 0)' }}>
      {/* Restart-required banner: the running server version differs from the
          installed/frontend version (updated but not restarted). */}
      {restartRequired && (
        <div className="px-3 pb-1.5 pt-2">
          <div className="shadow-xs flex items-center gap-2.5 rounded-2xl border border-amber-300/60 bg-amber-50/90 px-3 py-2 dark:border-amber-700/40 dark:bg-amber-900/20">
            <AlertTriangle className="h-4 w-4 flex-shrink-0 text-amber-500 dark:text-amber-400" />
            <span className="min-w-0 flex-1 text-xs font-medium text-amber-800 dark:text-amber-200">
              {t('version.restartRequired')}
            </span>
          </div>
        </div>
      )}

      {/* Update banner */}
      {updateAvailable && (
        <div className="px-3 pb-1.5 pt-1">
          <button
            type="button"
            className="shadow-xs group flex w-full items-center gap-3 rounded-2xl border border-blue-200/70 bg-blue-50/85 px-3.5 py-2.5 text-left transition-all hover:bg-blue-100/70 active:scale-[0.98] dark:border-blue-700/40 dark:bg-blue-900/20 dark:hover:bg-blue-900/30"
            onClick={onShowVersionModal}
          >
            <div className="relative flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl bg-blue-500/10">
              <ArrowUpCircle className="h-4 w-4 text-blue-600 dark:text-blue-400" />
              <span className="absolute right-1 top-1 h-1.5 w-1.5 animate-pulse rounded-full bg-blue-500" />
            </div>
            <div className="min-w-0 flex-1">
              <span className="block truncate text-xs font-semibold text-blue-700 dark:text-blue-300">
                {releaseInfo?.title || `v${latestVersion}`}
              </span>
              <span className="text-[11px] text-blue-600/80 dark:text-blue-400/75">
                {t('version.updateAvailable')}
              </span>
            </div>
          </button>
        </div>
      )}

      {/* Settings & brand */}
      <div className="border-t border-border/50 px-3 py-2.5">
        <button
          type="button"
          className="shadow-xs flex w-full touch-manipulation items-center justify-between gap-2.5 rounded-2xl border border-slate-200/75 bg-card/85 px-3 py-2.5 text-left transition-all hover:border-primary/25 hover:bg-card active:scale-[0.99] dark:border-white/[0.08]"
          onClick={onShowSettings}
        >
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl bg-muted/80 text-muted-foreground">
              <Settings className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <span className="block truncate text-sm font-medium text-foreground">
                {t('actions.settings')}
              </span>
              {!IS_PLATFORM && (
                <span className="block truncate text-[10px] text-muted-foreground/70">
                  Antigravity CLI v{currentVersion}
                </span>
              )}
            </div>
          </div>
        </button>
      </div>
    </div>
  );
}

