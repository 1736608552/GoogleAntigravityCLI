import { Activity, Archive, Folder, FolderPlus, MessageSquare, Plus, RefreshCw, Search, X, PanelLeftClose } from 'lucide-react';
import type { TFunction } from 'i18next';

import { Input, Tooltip } from '@/shared/ui';
import { CLOUDCLI_WORDMARK_FONT_FAMILY } from '@/shared/constants';
import { IS_PLATFORM,cn } from '@/shared/utils';
import type { SidebarSearchMode } from '@/shared/types';
import GitHubStarBadge from '@/modules/sidebar/GitHubStarBadge';

const MOD_KEY =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl';

type SidebarHeaderProps = {
  isPWA: boolean;
  isMobile: boolean;
  isLoading: boolean;
  projectsCount: number;
  runningSessionsCount: number;
  archivedSessionsCount: number;
  isArchivedSessionsLoading: boolean;
  searchFilter: string;
  onSearchFilterChange: (value: string) => void;
  onClearSearchFilter: () => void;
  searchMode: SidebarSearchMode;
  onSearchModeChange: (mode: SidebarSearchMode) => void;
  onRefresh: () => void;
  isRefreshing: boolean;
  onCreateProject: () => void;
  onCollapseSidebar: () => void;
  t: TFunction;
};

/** Module-level, not a nested render function, so the wordmark is not remounted on every SidebarHeader render. */
function LogoBlock({ t }: { t: TFunction }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <img
        src="/logo.svg"
        alt="Antigravity"
        className="h-7 w-7 flex-shrink-0 select-none object-contain drop-shadow-sm"
      />
      <h1
        className="truncate text-sm font-bold tracking-tight text-foreground"
        style={{ fontFamily: CLOUDCLI_WORDMARK_FONT_FAMILY }}
      >
        {t('app.title')}
      </h1>
    </div>
  );
}

/** Rendered by SidebarContent at the top of the panel for the search box, search-mode tabs, refresh and new-project actions. */
export default function SidebarHeader({
  isPWA,
  isMobile,
  isLoading,
  projectsCount,
  runningSessionsCount,
  archivedSessionsCount,
  isArchivedSessionsLoading,
  searchFilter,
  onSearchFilterChange,
  onClearSearchFilter,
  searchMode,
  onSearchModeChange,
  onRefresh,
  isRefreshing,
  onCreateProject,
  onCollapseSidebar,
  t,
}: SidebarHeaderProps) {
  const showSearchTools = (projectsCount > 0 || runningSessionsCount > 0 || archivedSessionsCount > 0 || isArchivedSessionsLoading) && !isLoading;
  const searchPlaceholder = searchMode === 'conversations'
    ? t('search.conversationsPlaceholder')
    : searchMode === 'archived'
      ? t('search.archivedPlaceholder', 'Search archived sessions...')
      : searchMode === 'running'
        ? t('search.runningPlaceholder', 'Search running sessions...')
        : t('projects.searchPlaceholder');
  const runningBadgeText = runningSessionsCount > 99 ? '99+' : String(runningSessionsCount);

  return (
    <div className="flex-shrink-0 border-b border-border/50">
      {/* Unified responsive header */}
      <div
        className="px-3.5 pb-3 pt-3.5"
        style={isPWA && isMobile ? { paddingTop: 'calc(14px + env(safe-area-inset-top, 0px))' } : {}}
      >
        <div className="flex items-center justify-between gap-2">
          {IS_PLATFORM ? (
            <a
              href="https://cloudcli.ai/dashboard"
              className="flex min-w-0 items-center gap-2.5 transition-opacity hover:opacity-80"
              title={t('tooltips.viewEnvironments')}
            >
              <LogoBlock t={t} />
            </a>
          ) : (
            <LogoBlock t={t} />
          )}

          <div className="flex flex-shrink-0 items-center gap-1">
            <button
              type="button"
              className="shadow-xs flex h-8 w-8 items-center justify-center rounded-xl border border-slate-200/75 bg-card/85 text-muted-foreground transition-all hover:bg-card hover:text-foreground active:scale-95 dark:border-white/[0.08]"
              onClick={onRefresh}
              disabled={isRefreshing}
              title={t('tooltips.refresh')}
              aria-label={t('tooltips.refresh')}
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${
                  isRefreshing ? 'animate-spin' : ''
                }`}
              />
            </button>
            <button
              type="button"
              className="shadow-xs flex h-8 w-8 items-center justify-center rounded-xl bg-primary text-primary-foreground transition-all hover:bg-primary/90 active:scale-95"
              onClick={onCreateProject}
              title={t('tooltips.createProject')}
              aria-label={t('tooltips.createProject')}
            >
              {isMobile ? <FolderPlus className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
            </button>
            {!isMobile && (
              <button
                type="button"
                className="shadow-xs hidden h-8 w-8 items-center justify-center rounded-xl border border-slate-200/75 bg-card/85 text-muted-foreground transition-all hover:bg-card hover:text-foreground active:scale-95 dark:border-white/[0.08] md:flex"
                onClick={onCollapseSidebar}
                title={t('tooltips.hideSidebar')}
                aria-label={t('tooltips.hideSidebar')}
              >
                <PanelLeftClose className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>

        <GitHubStarBadge />

        {/* Search mode & input */}
        {showSearchTools && (
          <div className="mt-3 space-y-2.5">
            {/* Search mode segmented bar */}
            <div className="flex items-center gap-0.5 rounded-xl border border-slate-200/70 bg-muted/55 p-1 dark:border-white/[0.08]">
              <button
                type="button"
                onClick={() => onSearchModeChange('projects')}
                aria-pressed={searchMode === 'projects'}
                className={cn(
                  'flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium transition-all',
                  searchMode === 'projects'
                    ? 'bg-card text-foreground shadow-xs'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <Folder className="h-3.5 w-3.5" />
                <span className="truncate">{t('search.modeProjects')}</span>
              </button>
              <button
                type="button"
                onClick={() => onSearchModeChange('conversations')}
                aria-pressed={searchMode === 'conversations'}
                className={cn(
                  'flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium transition-all',
                  searchMode === 'conversations'
                    ? 'bg-card text-foreground shadow-xs'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <MessageSquare className="h-3.5 w-3.5" />
                <span className="truncate">{t('search.modeConversations')}</span>
              </button>
              <Tooltip content={t('search.runningTooltip', 'Running sessions')} position="top">
                <button
                  type="button"
                  onClick={() => onSearchModeChange('running')}
                  aria-pressed={searchMode === 'running'}
                  aria-label={t('search.runningTooltip', 'Running sessions')}
                  title={t('search.runningTooltip', 'Running sessions')}
                  className={cn(
                    'flex items-center justify-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium transition-all',
                    searchMode === 'running'
                      ? 'bg-card text-foreground shadow-xs ring-1 ring-emerald-500/20'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  <Activity className={cn('h-3.5 w-3.5', runningSessionsCount > 0 && 'text-emerald-500')} />
                  {runningSessionsCount > 0 && (
                    <span className="rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums leading-none text-emerald-700 dark:text-emerald-300">
                      {runningBadgeText}
                    </span>
                  )}
                  <span className="sr-only">{t('search.modeRunning', 'Running')}</span>
                </button>
              </Tooltip>
              <Tooltip content={t('search.archiveOnlyTooltip', 'Archive only')} position="top">
                <button
                  type="button"
                  onClick={() => onSearchModeChange('archived')}
                  aria-pressed={searchMode === 'archived'}
                  aria-label={t('search.archiveOnlyTooltip', 'Archive only')}
                  title={t('search.archiveOnlyTooltip', 'Archive only')}
                  className={cn(
                    'flex items-center justify-center rounded-lg px-2.5 py-1.5 text-xs font-medium transition-all',
                    searchMode === 'archived'
                      ? 'bg-card text-foreground shadow-xs'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  <Archive className="h-3.5 w-3.5" />
                </button>
              </Tooltip>
            </div>

            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/55" />
              <Input
                type="text"
                placeholder={searchPlaceholder}
                value={searchFilter}
                onChange={(event) => onSearchFilterChange(event.target.value)}
                className="shadow-xs h-9 rounded-xl border border-slate-200/75 bg-card/85 pl-9 pr-12 text-sm transition-all duration-150 placeholder:text-muted-foreground/45 focus-visible:border-primary/35 focus-visible:ring-2 focus-visible:ring-primary/15 dark:border-white/[0.08]"
              />
              {searchFilter ? (
                <button
                  type="button"
                  onClick={onClearSearchFilter}
                  aria-label={t('tooltips.clearSearch')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-lg p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              ) : (
                <kbd
                  aria-hidden
                  title={t('tooltips.openCommandPalette')}
                  className="pointer-events-none absolute right-2.5 top-1/2 hidden -translate-y-1/2 items-center gap-0.5 rounded-md border border-border/60 bg-muted/50 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground md:inline-flex"
                >
                  {MOD_KEY}
                  <span>K</span>
                </kbd>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
