import { useTranslation } from 'react-i18next';

import { useMobileMenuHandlers } from '@/modules/project-workspace/hooks/useMobileMenuHandlers';

type MobileMenuButtonProps = {
  onMenuClick: () => void;
  compact?: boolean;
};

/** Rendered by WorkspaceHeader and WorkspaceStateView to open the sidebar drawer on mobile. */
export default function MobileMenuButton({ onMenuClick, compact = false }: MobileMenuButtonProps) {
  const { t } = useTranslation();
  const { handleMobileMenuClick, handleMobileMenuTouchEnd } = useMobileMenuHandlers(onMenuClick);

  const buttonClasses = compact
    ? 'flex h-8 w-8 items-center justify-center rounded-xl border border-slate-200/75 bg-white/80 text-muted-foreground shadow-xs transition-all hover:bg-white hover:text-foreground active:scale-95 dark:border-white/[0.08] dark:bg-zinc-900/75 pwa-menu-button'
    : 'flex h-9 w-9 flex-shrink-0 touch-manipulation items-center justify-center rounded-xl border border-slate-200/75 bg-white/85 text-muted-foreground shadow-xs backdrop-blur-md transition-all hover:bg-white hover:text-foreground active:scale-95 dark:border-white/[0.08] dark:bg-zinc-900/80 pwa-menu-button';

  return (
    <button
      onClick={handleMobileMenuClick}
      onTouchEnd={handleMobileMenuTouchEnd}
      className={buttonClasses}
      aria-label={t('misc.openMenu')}
    >
      <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
      </svg>
    </button>
  );
}
