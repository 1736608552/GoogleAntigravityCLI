import { memo, useCallback, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { ChevronDown, Sparkles } from 'lucide-react';

import type { ProviderModelOption } from '@/shared/types';
import { DEFAULT_EFFORT_VALUE } from '@/shared/constants';
import { cn } from '@/shared/utils';
import { useComposerMenuAnchor } from '@/modules/chat/hooks/useComposerMenuAnchor';
import {
  ComposerMenuHeading,
  ComposerMenuItem,
  ComposerMenuSeparator,
  ComposerMenuSurface,
} from '@/modules/chat/composer/ComposerMenuPrimitives';

type EffortOption = NonNullable<ProviderModelOption['effort']>['values'][number];

type ComposerModelMenuProps = {
  effort: string;
  /** Effort values the active provider/model actually accepts; empty hides the section. */
  effortOptions: EffortOption[];
  onSelectEffort: (effort: string) => void;
  model: string;
  /** Model catalog for the active provider; empty hides the section. */
  modelOptions: ProviderModelOption[];
  onSelectModel: (model: string) => void;
  modelsLoading: boolean;
};

/**
 * Rendered by chat's ChatComposer as the model & reasoning sheet/popover for
 * choosing the active provider's model and horizontal effort pills for the next turn.
 */
function ComposerModelMenu({
  effort,
  effortOptions,
  onSelectEffort,
  model,
  modelOptions,
  onSelectModel,
  modelsLoading,
}: ComposerModelMenuProps) {
  const { t } = useTranslation('chat');
  // Controls visibility of the model and reasoning effort bottom sheet / popover.
  const [isOpen, setIsOpen] = useState(false);
  const close = useCallback(() => setIsOpen(false), []);
  const { triggerRef, menuRef, anchor, updateAnchor } = useComposerMenuAnchor(isOpen, close, 360, 'right');

  const defaultEffortLabel = t('composer.effortDefault', { defaultValue: '默认' });
  const resolvedEffortOptions = useMemo<EffortOption[]>(
    () => effortOptions,
    [effortOptions],
  );
  const effortLabel = effort === DEFAULT_EFFORT_VALUE ? (effortOptions[0]?.value || 'high') : effort;

  const selectedModelOption = useMemo(
    () => modelOptions.find((option) => option.value === model) ?? null,
    [model, modelOptions],
  );
  const modelLabel = selectedModelOption?.label || model;

  const hasEffortSection = resolvedEffortOptions.length > 0;
  const hasModelSection = modelOptions.length > 0 || modelsLoading;
  if (!hasEffortSection && !hasModelSection) {
    return null;
  }

  const triggerLabel = hasModelSection ? modelLabel : effortLabel;
  const ariaLabel = t('composer.modelMenu', {
    defaultValue: 'Select model and reasoning effort',
  });

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          updateAnchor();
          setIsOpen((current) => !current);
        }}
        className={cn(
          'flex h-9 max-w-[176px] shrink-0 touch-manipulation items-center gap-1.5 rounded-2xl border px-2.5 text-xs font-medium transition-all active:scale-[0.98] sm:max-w-[260px]',
          isOpen
            ? 'border-primary/35 bg-primary/[0.08] text-foreground shadow-xs'
            : 'border-slate-200/80 bg-muted/50 text-foreground hover:bg-muted dark:border-white/[0.08]',
        )}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-label={ariaLabel}
        title={ariaLabel}
      >
        <span className="min-w-0 truncate">{triggerLabel}</span>
        {hasModelSection && hasEffortSection && effort !== DEFAULT_EFFORT_VALUE && (
          <span className="bg-primary/12 shrink-0 rounded-lg px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
            {effortLabel}
          </span>
        )}
        <ChevronDown className={cn('h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform', isOpen && 'rotate-180')} />
      </button>

      {isOpen && anchor && createPortal(
        <ComposerMenuSurface anchor={anchor} menuRef={menuRef} ariaLabel={ariaLabel} onClose={close}>
          {hasEffortSection && (
            <div className="px-1">
              <ComposerMenuHeading>
                <span className="inline-flex items-center gap-1.5">
                  <Sparkles className="h-3 w-3 text-primary" />
                  {t('composer.reasoning', { defaultValue: '深度思考（推理）' })}
                </span>
              </ComposerMenuHeading>
              <div className="flex flex-wrap gap-1.5 rounded-2xl bg-muted/55 p-1.5">
                {resolvedEffortOptions.map((option) => {
                  const isSelected = option.value === effort;
                  const optionText = option.value === DEFAULT_EFFORT_VALUE ? defaultEffortLabel : option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      role="menuitemradio"
                      aria-checked={isSelected}
                      onClick={() => {
                        onSelectEffort(option.value);
                        setIsOpen(false);
                      }}
                      className={cn(
                        'min-w-[54px] flex-1 touch-manipulation rounded-xl px-2.5 py-2 text-xs font-medium capitalize transition-all active:scale-95',
                        isSelected
                          ? 'bg-card font-semibold text-primary shadow-xs ring-1 ring-primary/25'
                          : 'text-muted-foreground hover:bg-card/60 hover:text-foreground',
                      )}
                    >
                      {optionText}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {hasModelSection && (
            <>
              {hasEffortSection && <ComposerMenuSeparator />}
              <div className="px-0.5">
                <ComposerMenuHeading>
                  {t('composer.model', { defaultValue: '模型' })}
                </ComposerMenuHeading>
                {modelOptions.length === 0 && modelsLoading && (
                  <p className="px-2.5 py-2 text-sm text-muted-foreground">
                    {t('composer.loadingModels', { defaultValue: 'Loading models…' })}
                  </p>
                )}
                <div className="space-y-1">
                  {modelOptions.map((option) => (
                    <ComposerMenuItem
                      key={option.value}
                      label={option.label || option.value}
                      description={option.description}
                      isSelected={option.value === model}
                      onSelect={() => {
                        onSelectModel(option.value);
                        setIsOpen(false);
                      }}
                    />
                  ))}
                </div>
              </div>
            </>
          )}
        </ComposerMenuSurface>,
        document.body,
      )}
    </>
  );
}

/** Memoized: the composer re-renders on every keystroke and none of this menu's props change while typing. */
export default memo(ComposerModelMenu);
