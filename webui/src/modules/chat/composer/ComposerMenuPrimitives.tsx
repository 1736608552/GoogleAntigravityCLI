import type { CSSProperties, ReactNode, Ref } from 'react';
import { Check } from 'lucide-react';

import { cn } from '@/shared/utils';
import type { ComposerMenuAnchor } from '@/shared/types';

/**
 * Shared shell for the composer popovers (model/effort, permissions, schedule,
 * and '+' tools menu). Renders as a single-hand bottom sheet on narrow mobile
 * screens and an anchored mica popover on wider viewports.
 *
 * Used by chat's ComposerModelMenu, ComposerPermissionMenu, ScheduleMessagePopover, and ComposerMoreMenu.
 */
export function ComposerMenuSurface({
  anchor,
  menuRef,
  ariaLabel,
  onClose,
  children,
}: {
  anchor: ComposerMenuAnchor;
  menuRef: Ref<HTMLDivElement>;
  ariaLabel: string;
  onClose?: () => void;
  children: ReactNode;
}) {
  const isLeftAligned = anchor.left !== undefined;
  const anchorVars = {
    '--anchor-left': `${anchor.left ?? 8}px`,
    '--anchor-right': `${anchor.right ?? 8}px`,
    '--anchor-bottom': `${anchor.bottom}px`,
    '--anchor-max-h': `${anchor.maxHeight}px`,
    '--anchor-max-w': `${anchor.maxWidth}px`,
  } as CSSProperties;

  return (
    <>
      <div
        aria-hidden
        onClick={onClose}
        className="backdrop-blur-xs fixed inset-0 z-[105] bg-slate-900/25 transition-opacity duration-150 dark:bg-black/50 sm:hidden"
      />
      <div
        ref={menuRef}
        role="menu"
        aria-label={ariaLabel}
        className={cn(
          'fixed inset-x-2 bottom-2 z-[110] max-h-[82vh] overflow-y-auto overscroll-contain rounded-3xl border border-slate-200/80 bg-popover/95 p-3 pb-[calc(0.875rem+env(safe-area-inset-bottom,0px))] text-popover-foreground shadow-2xl backdrop-blur-2xl dark:border-white/[0.09] sheet-enter',
          'sm:inset-x-auto sm:bottom-[var(--anchor-bottom)] sm:max-h-[var(--anchor-max-h)] sm:min-w-[296px] sm:max-w-[var(--anchor-max-w)] sm:rounded-2xl sm:p-2 sm:pb-2 sm:popover-enter',
          isLeftAligned
            ? 'sm:left-[var(--anchor-left)] sm:right-auto'
            : 'sm:left-auto sm:right-[var(--anchor-right)]',
        )}
        style={anchorVars}
      >
        <div className="mx-auto mb-2.5 h-1 w-10 rounded-full bg-muted-foreground/25 sm:hidden" aria-hidden />
        {children}
      </div>
    </>
  );
}

/** Used by chat's ComposerModelMenu, ComposerPermissionMenu and ComposerMoreMenu to label a section. */
export function ComposerMenuHeading({ children }: { children: ReactNode }) {
  return (
    <p className="px-2.5 pb-1.5 pt-1 text-[11px] font-semibold tracking-wide text-muted-foreground/85">{children}</p>
  );
}

/** Used by chat's composer menus to divide logical sections. */
export function ComposerMenuSeparator() {
  return <div className="my-2 h-px bg-border/60" aria-hidden />;
}

/** Used by chat's ComposerModelMenu, ComposerPermissionMenu and ComposerMoreMenu to render one selectable row. */
export function ComposerMenuItem({
  label,
  description,
  icon,
  isSelected,
  onSelect,
  role = 'menuitemradio',
  trailing,
  disabled = false,
  className,
}: {
  label: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  isSelected: boolean;
  onSelect: () => void;
  role?: 'menuitemradio' | 'menuitem';
  trailing?: ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      role={role}
      disabled={disabled}
      aria-checked={role === 'menuitemradio' ? isSelected : undefined}
      onClick={onSelect}
      className={cn(
        'flex w-full touch-manipulation items-start gap-2.5 rounded-xl px-2.5 py-2 text-left text-sm transition-all duration-150',
        disabled
          ? 'cursor-not-allowed opacity-45'
          : 'hover:bg-accent/70 active:scale-[0.99] focus-visible:bg-accent focus-visible:outline-none',
        isSelected
          ? 'bg-primary/[0.08] font-medium text-primary ring-1 ring-primary/20'
          : 'text-foreground/90',
        className,
      )}
    >
      {icon && (
        <span
          className={cn(
            'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-lg',
            isSelected ? 'bg-primary/15 text-primary' : 'bg-muted/70 text-muted-foreground',
          )}
        >
          {icon}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate leading-5">{label}</span>
        {description && (
          <span className="mt-0.5 line-clamp-1 block text-xs leading-4 text-muted-foreground">{description}</span>
        )}
      </span>
      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center">
        {trailing ?? (isSelected ? (
          <span className="flex h-4 w-4 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <Check className="h-2.5 w-2.5" strokeWidth={3} />
          </span>
        ) : null)}
      </span>
    </button>
  );
}
