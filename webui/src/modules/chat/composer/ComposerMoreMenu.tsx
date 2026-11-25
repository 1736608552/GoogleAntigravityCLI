import { memo, useCallback, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import {
  ActivityIcon,
  ChevronLeft,
  Clock,
  Eraser,
  Languages,
  MessageSquare,
  Paperclip,
  Plus,
} from 'lucide-react';

import { cn } from '@/shared/utils';
import { useComposerMenuAnchor } from '@/modules/chat/hooks/useComposerMenuAnchor';
import {
  ComposerMenuHeading,
  ComposerMenuItem,
  ComposerMenuSeparator,
  ComposerMenuSurface,
} from '@/modules/chat/composer/ComposerMenuPrimitives';

const QUICK_SCHEDULE_MINUTES = [15, 60, 8 * 60, 24 * 60];

const formatCompactTokens = (usage: Record<string, unknown> | null): string => {
  if (!usage) return '0';
  const breakdown =
    usage.breakdown && typeof usage.breakdown === 'object'
      ? (usage.breakdown as Record<string, unknown>)
      : null;
  const inputTokens = Number(usage.inputTokens ?? breakdown?.input ?? 0);
  const outputTokens = Number(usage.outputTokens ?? breakdown?.output ?? 0);
  const used = Number(usage.used) || (Number.isFinite(inputTokens + outputTokens) ? inputTokens + outputTokens : 0);
  if (!Number.isFinite(used) || used <= 0) return '0';
  if (used >= 1_000_000) return `${(used / 1_000_000).toFixed(used >= 10_000_000 ? 0 : 1)}M`;
  if (used >= 10_000) return `${Math.round(used / 1_000)}K`;
  if (used >= 1_000) return `${(used / 1_000).toFixed(1)}K`;
  return used.toLocaleString();
};

const toLocalDatetimeInput = (date: Date): string =>
  new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

type ComposerMoreMenuProps = {
  hasInput: boolean;
  slashCommandsCount: number;
  tokenBudget: Record<string, unknown> | null;
  onOpenAttachmentPicker: () => void;
  onToggleCommandMenu: () => void;
  onOpenTranslateDialog: () => void;
  onShowTokenUsage: () => void;
  onScheduleMessage: (scheduledFor: Date) => void;
  onClearInput: () => void;
};

/**
 * Rendered by chat's ChatComposer as the compact '+' tools sheet/popover that
 * consolidates attachments, slash commands, scheduled send, translation, token
 * budget details, and draft clearing so the footer stays single-hand friendly.
 */
function ComposerMoreMenu({
  hasInput,
  slashCommandsCount,
  tokenBudget,
  onOpenAttachmentPicker,
  onToggleCommandMenu,
  onOpenTranslateDialog,
  onShowTokenUsage,
  onScheduleMessage,
  onClearInput,
}: ComposerMoreMenuProps) {
  const { t } = useTranslation('chat');
  // Controls whether the '+' tools popover/bottom sheet is currently open.
  const [isOpen, setIsOpen] = useState(false);
  // Switches the tools menu cleanly to the inline scheduled-send time picker view on mobile/desktop.
  const [showScheduleView, setShowScheduleView] = useState(false);
  // Captures opening timestamp on user interaction so quick offset previews stay pure during render.
  const [openedAtMs, setOpenedAtMs] = useState(() => Date.now());
  // Stores the editable datetime-local string for custom scheduled send; defaults to 1h out.
  const [customScheduleValue, setCustomScheduleValue] = useState(() =>
    toLocalDatetimeInput(new Date(Date.now() + 3_600_000)),
  );

  const close = useCallback(() => {
    setIsOpen(false);
    setShowScheduleView(false);
  }, []);

  const { triggerRef, menuRef, anchor, updateAnchor } = useComposerMenuAnchor(isOpen, close, 320, 'left');
  const formattedTokens = formatCompactTokens(tokenBudget);
  const ariaLabel = t('composer.toolsMenu', { defaultValue: '更多工具与功能' });

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          if (isOpen) {
            close();
          } else {
            updateAnchor();
            const now = Date.now();
            setOpenedAtMs(now);
            setCustomScheduleValue(toLocalDatetimeInput(new Date(now + 3_600_000)));
            setIsOpen(true);
          }
        }}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-label={ariaLabel}
        title={ariaLabel}
        className={cn(
          'flex h-9 w-9 shrink-0 touch-manipulation items-center justify-center rounded-2xl border transition-all active:scale-95',
          isOpen
            ? 'rotate-45 border-primary/35 bg-primary/[0.1] text-primary shadow-xs'
            : 'border-slate-200/80 bg-muted/50 text-foreground hover:bg-muted dark:border-white/[0.08]',
        )}
      >
        <Plus className="h-4 w-4" />
      </button>

      {isOpen && anchor && createPortal(
        <ComposerMenuSurface anchor={anchor} menuRef={menuRef} ariaLabel={ariaLabel} onClose={close}>
          {showScheduleView ? (
            <div className="space-y-1.5">
              <div className="flex items-center gap-1 px-1 pb-1">
                <button
                  type="button"
                  onClick={() => setShowScheduleView(false)}
                  className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
                  aria-label={t('actions.back', { defaultValue: '返回' })}
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <ComposerMenuHeading>{t('schedule.heading')}</ComposerMenuHeading>
              </div>
              {QUICK_SCHEDULE_MINUTES.map((minutes) => (
                <ComposerMenuItem
                  key={minutes}
                  role="menuitem"
                  icon={<Clock className="h-3.5 w-3.5" />}
                  label={t(`schedule.in.${minutes}`)}
                  description={new Date(openedAtMs + minutes * 60_000).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                  isSelected={false}
                  onSelect={() => {
                    onScheduleMessage(new Date(Date.now() + minutes * 60_000));
                    close();
                  }}
                />
              ))}
              <ComposerMenuSeparator />
              <div className="px-2 pb-1">
                <label className="block text-[11px] font-medium text-muted-foreground" htmlFor="more-schedule-at">
                  {t('schedule.customLabel')}
                </label>
                <input
                  id="more-schedule-at"
                  type="datetime-local"
                  value={customScheduleValue}
                  onChange={(event) => setCustomScheduleValue(event.target.value)}
                  className="mt-1.5 w-full rounded-xl border border-border/70 bg-background px-2.5 py-2 text-xs text-foreground"
                />
                <button
                  type="button"
                  onClick={() => {
                    const parsed = new Date(customScheduleValue);
                    if (!Number.isNaN(parsed.getTime())) {
                      onScheduleMessage(parsed);
                      close();
                    }
                  }}
                  className="mt-2 w-full rounded-xl bg-primary px-3 py-2 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 active:scale-[0.99]"
                >
                  {t('schedule.confirm')}
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-1">
              <ComposerMenuHeading>
                {t('composer.toolsHeading', { defaultValue: '创作工具与上下文' })}
              </ComposerMenuHeading>

              <ComposerMenuItem
                role="menuitem"
                icon={<Paperclip className="h-3.5 w-3.5" />}
                label={t('input.attachFiles')}
                isSelected={false}
                onSelect={() => {
                  close();
                  onOpenAttachmentPicker();
                }}
              />

              <ComposerMenuItem
                role="menuitem"
                icon={<MessageSquare className="h-3.5 w-3.5" />}
                label={t('input.showAllCommands')}
                trailing={slashCommandsCount > 0 ? (
                  <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-muted-foreground">
                    {slashCommandsCount}
                  </span>
                ) : undefined}
                isSelected={false}
                onSelect={() => {
                  close();
                  onToggleCommandMenu();
                }}
              />

              <ComposerMenuItem
                role="menuitem"
                icon={<Clock className="h-3.5 w-3.5" />}
                label={t('schedule.trigger')}
                description={!hasInput ? t('schedule.needInputHint', { defaultValue: '输入消息内容后可定时发送' }) : undefined}
                disabled={!hasInput}
                isSelected={false}
                onSelect={() => setShowScheduleView(true)}
              />

              <ComposerMenuItem
                role="menuitem"
                icon={<Languages className="h-3.5 w-3.5" />}
                label="思考过程翻译"
                isSelected={false}
                onSelect={() => {
                  close();
                  onOpenTranslateDialog();
                }}
              />

              <ComposerMenuSeparator />

              <ComposerMenuItem
                role="menuitem"
                icon={<ActivityIcon className="h-3.5 w-3.5 text-primary" />}
                label={t('misc.showTokenUsage')}
                trailing={(
                  <span className="rounded-lg bg-primary/10 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-primary">
                    {formattedTokens}
                  </span>
                )}
                isSelected={false}
                onSelect={() => {
                  close();
                  onShowTokenUsage();
                }}
              />

              {hasInput && (
                <ComposerMenuItem
                  role="menuitem"
                  icon={<Eraser className="h-3.5 w-3.5 text-destructive" />}
                  label={t('input.clearInput', { defaultValue: '清空输入框' })}
                  className="text-destructive hover:bg-destructive/10"
                  isSelected={false}
                  onSelect={() => {
                    close();
                    onClearInput();
                  }}
                />
              )}
            </div>
          )}
        </ComposerMenuSurface>,
        document.body,
      )}
    </>
  );
}

export default memo(ComposerMoreMenu);
