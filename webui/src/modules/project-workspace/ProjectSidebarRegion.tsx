import { memo, useCallback } from 'react';
import type {
  MouseEvent as ReactMouseEvent,
  TouchEvent as ReactTouchEvent,
} from 'react';
import { useTranslation } from 'react-i18next';

import { useProjectSidebarState } from '@/modules/project-workspace/context/ProjectsStateContext';
import { Sidebar } from '@/modules/sidebar';
import type { ProjectWorkspaceShellProps } from '@/shared/types';

/** Rendered by ProjectWorkspaceShell to host the sidebar module, docked on desktop and as a drawer on mobile. */
function ProjectSidebarRegion({
  isMobile,
}: Pick<ProjectWorkspaceShellProps, 'isMobile'>) {
  const { t } = useTranslation('common');
  const { sidebarOpen, setSidebarOpen, sidebarSharedProps } = useProjectSidebarState();

  const handleBackdropClick = useCallback((event: ReactMouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    setSidebarOpen(false);
  }, [setSidebarOpen]);

  const handleBackdropTouch = useCallback((event: ReactTouchEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setSidebarOpen(false);
  }, [setSidebarOpen]);

  if (!isMobile) {
    return (
      <div className="h-full flex-shrink-0 border-r border-slate-200/75 bg-card/65 backdrop-blur-xl dark:border-white/[0.08] dark:bg-zinc-950/60">
        <Sidebar {...sidebarSharedProps} />
      </div>
    );
  }

  return (
    <div
      className={`fixed inset-0 z-50 flex transition-all duration-200 ease-out ${
        sidebarOpen ? 'visible opacity-100' : 'invisible opacity-0'
      }`}
    >
      <button
        className="backdrop-blur-xs fixed inset-0 bg-slate-900/25 transition-opacity duration-200 ease-out dark:bg-black/55"
        onClick={handleBackdropClick}
        onTouchStart={handleBackdropTouch}
        aria-label={t('versionUpdate.ariaLabels.closeSidebar')}
      />
      <div
        className={`relative h-full w-[86vw] max-w-[340px] transform overflow-hidden rounded-r-3xl border-r border-slate-200/80 bg-background/95 shadow-2xl backdrop-blur-2xl transition-transform duration-200 ease-out dark:border-white/[0.09] sm:w-80 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
        onClick={(event) => event.stopPropagation()}
        onTouchStart={(event) => event.stopPropagation()}
      >
        <Sidebar {...sidebarSharedProps} />
      </div>
    </div>
  );
}

export default memo(ProjectSidebarRegion);
