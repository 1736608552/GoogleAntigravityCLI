import { useTranslation } from 'react-i18next';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  ChangeEvent,
  ClipboardEvent,
  FormEvent,
  KeyboardEvent,
  MouseEvent,
  ReactNode,
  RefObject,
  TouchEvent,
} from 'react';
import { PaperclipIcon, Loader2, ArrowUpIcon, PencilIcon } from 'lucide-react';

import { useVoiceInput } from '@/modules/chat/hooks/useVoiceInput';
import { useVoiceAvailable } from '@/modules/chat/hooks/useVoiceAvailable';
import type { BackgroundSendChoice, BackgroundSendPrompt, QueuedDraft, ScheduledMessage, SlashCommand,SessionActivity,PendingPermissionRequest,PermissionMode,ProviderModelOption } from '@/shared/types';
import {
  PromptInput,
  PromptInputHeader,
  PromptInputBody,
  PromptInputTextarea,
  PromptInputFooter,
  PromptInputTools,
  PromptInputButton,
  PromptInputSubmit,
} from '@/modules/chat/composer/PromptInput';
import CommandMenu from '@/modules/chat/composer/CommandMenu';
import ActivityIndicator from '@/modules/chat/composer/ActivityIndicator';
import ComposerAttachment from '@/modules/chat/composer/ComposerAttachment';
import VoiceInputButton from '@/modules/chat/composer/VoiceInputButton';
import PermissionRequestsBanner from '@/modules/chat/composer/PermissionRequestsBanner';
import TokenUsageSummary from '@/modules/chat/composer/TokenUsageSummary';
import QueuedMessageCard from '@/modules/chat/composer/QueuedMessageCard';
import BackgroundSendDialog from '@/modules/chat/composer/BackgroundSendDialog';
import ReasoningTranslateDialog from '@/modules/chat/composer/ReasoningTranslateDialog';
import { ScheduleMessagePopover } from '@/modules/chat/composer/ScheduleMessagePopover';
import { ScheduledMessageList } from '@/modules/chat/composer/ScheduledMessageList';
import ComposerModelMenu from '@/modules/chat/composer/ComposerModelMenu';
import ComposerMoreMenu from '@/modules/chat/composer/ComposerMoreMenu';
import ComposerPermissionMenu from '@/modules/chat/composer/ComposerPermissionMenu';

type MentionableFile = {
  name: string;
  path: string;
};

type ChatComposerProps = {
  pendingPermissionRequests: PendingPermissionRequest[];
  handlePermissionDecision: (
    requestIds: string | string[],
    decision: { allow?: boolean; message?: string; rememberEntry?: string | null; updatedInput?: unknown },
  ) => void;
  handleGrantToolPermission: (suggestion: { entry: string; toolName: string }) => { success: boolean };
  activity: SessionActivity | null;
  isLoading: boolean;
  onAbortSession: () => void;
  permissionMode: PermissionMode;
  availablePermissionModes: PermissionMode[];
  onSelectPermissionMode: (mode: PermissionMode) => void;
  providerLabel: string;
  effort: string;
  availableEffortOptions: NonNullable<ProviderModelOption['effort']>['values'];
  onSelectEffort: (effort: string) => void;
  model: string;
  availableModelOptions: ProviderModelOption[];
  onSelectModel: (model: string) => void;
  modelsLoading: boolean;
  tokenBudget: Record<string, unknown> | null;
  onShowTokenUsage: () => void;
  slashCommandsCount: number;
  onToggleCommandMenu: () => void;
  hasInput: boolean;
  onClearInput: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement> | MouseEvent<HTMLButtonElement> | TouchEvent<HTMLButtonElement>) => void;
  isDragActive: boolean;
  queuedDraft: QueuedDraft | null;
  backgroundSendPrompt: BackgroundSendPrompt | null;
  onResolveBackgroundSendPrompt: (choice: BackgroundSendChoice) => void;
  /** Set while the composer is replacing an already-sent message. */
  isEditingSentMessage: boolean;
  onCancelEditMessage: () => void;
  /** Messages waiting to be sent to this session later. */
  scheduledMessages: ScheduledMessage[];
  onScheduleMessage: (scheduledFor: Date) => void;
  onCancelScheduledMessage: (id: string) => void;
  onEditQueuedDraft: () => void;
  onDeleteQueuedDraft: () => void;
  onSendQueuedDraftNow?: () => void;
  attachedFiles: File[];
  onRemoveAttachment: (index: number) => void;
  fileErrors: Map<string, string>;
  showFileDropdown: boolean;
  filteredFiles: MentionableFile[];
  selectedFileIndex: number;
  onSelectFile: (file: MentionableFile) => void;
  filteredCommands: SlashCommand[];
  selectedCommandIndex: number;
  onCommandSelect: (command: SlashCommand, index: number, isHover: boolean) => void;
  onCloseCommandMenu: () => void;
  isCommandMenuOpen: boolean;
  frequentCommands: SlashCommand[];
  getRootProps: (...args: unknown[]) => Record<string, unknown>;
  getInputProps: (...args: unknown[]) => Record<string, unknown>;
  openAttachmentPicker: () => void;
  inputHighlightRef: RefObject<HTMLDivElement>;
  renderInputWithMentions: (text: string) => ReactNode;
  textareaRef: RefObject<HTMLTextAreaElement>;
  input: string;
  onVoiceTranscript?: (text: string, send?: boolean) => void;
  onInputChange: (event: ChangeEvent<HTMLTextAreaElement>) => void;
  onTextareaClick: (event: MouseEvent<HTMLTextAreaElement>) => void;
  onTextareaKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onTextareaPaste: (event: ClipboardEvent<HTMLTextAreaElement>) => void;
  onTextareaScrollSync: (target: HTMLTextAreaElement) => void;
  onTextareaInput: (event: FormEvent<HTMLTextAreaElement>) => void;
  isInputFocused?: boolean;
  onInputFocusChange?: (focused: boolean) => void;
  placeholder: string;
  isTextareaExpanded: boolean;
  sendByCtrlEnter?: boolean;
};

/**
 * Rendered by chat's ChatInterface as the whole input area: textarea, pending
 * attachments, queued message, permission banner, voice input and the
 * model/permission popovers that drive the next turn.
 */
export default function ChatComposer({
  pendingPermissionRequests,
  handlePermissionDecision,
  handleGrantToolPermission,
  activity,
  isLoading,
  onAbortSession,
  permissionMode,
  availablePermissionModes,
  onSelectPermissionMode,
  providerLabel,
  effort,
  availableEffortOptions,
  onSelectEffort,
  model,
  availableModelOptions,
  onSelectModel,
  modelsLoading,
  tokenBudget,
  onShowTokenUsage,
  slashCommandsCount,
  onToggleCommandMenu,
  hasInput,
  onClearInput,
  onSubmit,
  isDragActive,
  queuedDraft,
  backgroundSendPrompt,
  onResolveBackgroundSendPrompt,
  isEditingSentMessage,
  onCancelEditMessage,
  scheduledMessages,
  onScheduleMessage,
  onCancelScheduledMessage,
  onEditQueuedDraft,
  onDeleteQueuedDraft,
  onSendQueuedDraftNow,
  attachedFiles,
  onRemoveAttachment,
  fileErrors,
  showFileDropdown,
  filteredFiles,
  selectedFileIndex,
  onSelectFile,
  filteredCommands,
  selectedCommandIndex,
  onCommandSelect,
  onCloseCommandMenu,
  isCommandMenuOpen,
  frequentCommands,
  getRootProps,
  getInputProps,
  openAttachmentPicker,
  inputHighlightRef,
  renderInputWithMentions,
  textareaRef,
  input,
  onVoiceTranscript,
  onInputChange,
  onTextareaClick,
  onTextareaKeyDown,
  onTextareaPaste,
  onTextareaScrollSync,
  onTextareaInput,
  isInputFocused = false,
  onInputFocusChange,
  placeholder,
  isTextareaExpanded,
  sendByCtrlEnter,
}: ChatComposerProps) {
  const { t } = useTranslation('chat');
  const fileDropdownRef = useRef<HTMLDivElement | null>(null);
  const selectedFileRef = useRef<HTMLDivElement | null>(null);
  const [isTranslateDialogOpen, setIsTranslateDialogOpen] = useState(false);
  const commandMenuPosition = useMemo(() => {
    if (!isCommandMenuOpen) {
      return { top: 0, left: 16, bottom: 90 };
    }
    const textareaRect = textareaRef.current?.getBoundingClientRect();
    return {
      top: textareaRect ? Math.max(16, textareaRect.top - 316) : 0,
      left: textareaRect ? textareaRect.left : 16,
      bottom: textareaRect ? window.innerHeight - textareaRect.top + 8 : 90,
    };
  }, [isCommandMenuOpen, textareaRef]);

  useEffect(() => {
    const dropdown = fileDropdownRef.current;
    const selectedFile = selectedFileRef.current;
    if (!showFileDropdown || !dropdown || !selectedFile) {
      return;
    }

    const itemTop = selectedFile.offsetTop;
    const itemBottom = itemTop + selectedFile.offsetHeight;
    const visibleTop = dropdown.scrollTop;
    const visibleBottom = visibleTop + dropdown.clientHeight;

    if (itemTop < visibleTop) {
      dropdown.scrollTop = itemTop;
    } else if (itemBottom > visibleBottom) {
      dropdown.scrollTop = itemBottom - dropdown.clientHeight;
    }
  }, [selectedFileIndex, showFileDropdown]);

  // Voice state is hosted here (not in the mic button) so the main Send button can stop
  // recording and send the transcript in one tap, the way the mic button drops it in the box.
  const voiceAvailable = useVoiceAvailable();
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const voiceErrorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleVoiceError = useCallback((msg: string) => {
    setVoiceError(msg);
    if (voiceErrorTimer.current) clearTimeout(voiceErrorTimer.current);
    voiceErrorTimer.current = setTimeout(() => setVoiceError(null), 4000);
  }, []);
  useEffect(() => () => {
    if (voiceErrorTimer.current) clearTimeout(voiceErrorTimer.current);
  }, []);
  const noopTranscript = useCallback(() => {}, []);
  const { state: voiceState, toggle: voiceToggle, stop: voiceStop } = useVoiceInput(
    onVoiceTranscript ?? noopTranscript,
    handleVoiceError,
  );
  const isRecording = voiceState === 'recording';
  const isTranscribing = voiceState === 'transcribing';

  // Detect if the AskUserQuestion interactive panel is active
  const hasQuestionPanel = pendingPermissionRequests.some(
    (r) => r.toolName === 'AskUserQuestion'
  );

  // Hide the thinking/status bar while any permission request is pending
  const hasPendingPermissions = pendingPermissionRequests.length > 0;

  const hasQueuedDraft = Boolean(queuedDraft);
  const canQueueDraft = isLoading && Boolean(input?.trim() || attachedFiles.length > 0);
  const submitHint = canQueueDraft
    ? hasQueuedDraft
      ? t('input.hintText.updateQueued', { defaultValue: 'Enter to update queued message' })
      : t('input.hintText.queue', { defaultValue: 'Enter to queue your next message' })
    : sendByCtrlEnter
      ? t('input.hintText.ctrlEnter')
      : t('input.hintText.enter');
  const submitAriaLabel = canQueueDraft
    ? hasQueuedDraft
      ? t('input.queue.update', { defaultValue: 'Update queued message' })
      : t('input.queue.sendNext', { defaultValue: 'Queue next message' })
    : isLoading
      ? t('input.stop')
      : t('input.send');

  return (
    <div className="chat-composer-shell relative flex-shrink-0 px-2 pb-[max(0.625rem,calc(env(safe-area-inset-bottom,0px)+0.25rem))] pt-0 sm:px-4 sm:pb-4 md:px-4 md:pb-6">
      {!hasPendingPermissions && (
        <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 w-[calc(100%-1rem)] max-w-[54.25rem] -translate-x-1/2 bg-transparent sm:w-[calc(100%-2rem)]">
          <ActivityIndicator activity={activity} onAbort={onAbortSession} isInputFocused={isInputFocused} />
        </div>
      )}

      {(pendingPermissionRequests.length > 0 || scheduledMessages.length > 0 || isEditingSentMessage || queuedDraft) && (
      <div className="mx-auto mb-2 flex w-full max-w-[54.25rem] flex-col gap-2">

        {pendingPermissionRequests.length > 0 && (
          <div className="pointer-events-auto">
            <PermissionRequestsBanner
              pendingPermissionRequests={pendingPermissionRequests}
              handlePermissionDecision={handlePermissionDecision}
              handleGrantToolPermission={handleGrantToolPermission}
            />
          </div>
        )}

        <div className="pointer-events-auto">
          <ScheduledMessageList
            scheduledMessages={scheduledMessages}
            onCancel={onCancelScheduledMessage}
          />
        </div>

        {isEditingSentMessage && (
          <div className="pointer-events-auto flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-foreground backdrop-blur-md">
            <PencilIcon className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
            <span className="min-w-0 flex-1">
              {t('composer.editing.title')}
              {' — '}
              <span className="text-muted-foreground">{t('composer.editing.filesNotReverted')}</span>
            </span>
            <button
              type="button"
              onClick={onCancelEditMessage}
              className="shrink-0 rounded-md px-2 py-1 font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              {t('composer.editing.cancel')}
            </button>
          </div>
        )}

        {queuedDraft && (
          <div className="pointer-events-auto">
            <QueuedMessageCard
              content={queuedDraft.content}
              attachmentCount={
                queuedDraft.uploadedAttachments?.length ?? queuedDraft.attachments.length
              }
              onSendNow={onSendQueuedDraftNow}
              onEdit={onEditQueuedDraft}
              onDelete={onDeleteQueuedDraft}
            />
          </div>
        )}
      </div>
      )}

      <BackgroundSendDialog
        prompt={backgroundSendPrompt}
        onResolve={onResolveBackgroundSendPrompt}
      />

      <ReasoningTranslateDialog
        open={isTranslateDialogOpen}
        onOpenChange={setIsTranslateDialogOpen}
      />

      {!hasQuestionPanel && <div className="pointer-events-auto relative mx-auto max-w-[54.25rem]">
        {showFileDropdown && filteredFiles.length > 0 && (
          <div
            ref={fileDropdownRef}
            className="absolute bottom-full left-0 right-0 z-50 mb-2 max-h-48 overflow-y-auto rounded-xl border border-border/50 bg-card/95 shadow-lg backdrop-blur-md"
          >
            {filteredFiles.map((file, index) => (
              <div
                key={file.path}
                ref={index === selectedFileIndex ? selectedFileRef : undefined}
                className={`cursor-pointer touch-manipulation border-b border-border/30 px-4 py-3 last:border-b-0 ${
                  index === selectedFileIndex
                    ? 'bg-primary/8 text-primary'
                    : 'text-foreground hover:bg-accent/50'
                }`}
                onMouseDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                }}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onSelectFile(file);
                }}
              >
                <div className="text-sm font-medium">{file.name}</div>
                <div className="font-mono text-xs text-muted-foreground">{file.path}</div>
              </div>
            ))}
          </div>
        )}

        <CommandMenu
          commands={filteredCommands}
          selectedIndex={selectedCommandIndex}
          onSelect={onCommandSelect}
          onClose={onCloseCommandMenu}
          position={commandMenuPosition}
          isOpen={isCommandMenuOpen}
          frequentCommands={frequentCommands}
        />

        <PromptInput
          onSubmit={onSubmit as (event: FormEvent<HTMLFormElement>) => void}
          status={isLoading ? 'streaming' : 'ready'}
          className={isTextareaExpanded ? 'chat-input-expanded' : ''}
          {...getRootProps()}
        >
          {isDragActive && (
            <div className="absolute inset-0 z-50 flex items-center justify-center rounded-2xl border-2 border-dashed border-primary/50 bg-primary/15">
              <div className="rounded-xl border border-border/30 bg-card p-4 shadow-lg">
                <svg className="mx-auto mb-2 h-8 w-8 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                  />
                </svg>
                <p className="text-sm font-medium">Drop files here</p>
              </div>
            </div>
          )}

          {attachedFiles.length > 0 && (
            <PromptInputHeader>
              <div className="rounded-xl bg-muted/40 p-2">
                <div className="flex flex-wrap gap-2">
                  {attachedFiles.map((file, index) => (
                    <ComposerAttachment
                      key={`${file.name}-${file.lastModified}-${index}`}
                      file={file}
                      onRemove={() => onRemoveAttachment(index)}
                      error={fileErrors.get(file.name)}
                    />
                  ))}
                </div>
              </div>
            </PromptInputHeader>
          )}

          <input {...getInputProps()} />

          <PromptInputBody>
            <div ref={inputHighlightRef} aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden rounded-xl">
              <div className="chat-input-placeholder block w-full whitespace-pre-wrap break-words px-4 py-2 text-sm leading-6 text-transparent">
                {renderInputWithMentions(input)}
              </div>
            </div>

            <PromptInputTextarea
              ref={textareaRef}
              dir="auto"
              value={input}
              onChange={onInputChange}
              onClick={onTextareaClick}
              onKeyDown={onTextareaKeyDown}
              onPaste={onTextareaPaste}
              onScroll={(event) => onTextareaScrollSync(event.target as HTMLTextAreaElement)}
              onFocus={() => onInputFocusChange?.(true)}
              onBlur={() => onInputFocusChange?.(false)}
              onInput={onTextareaInput}
              placeholder={placeholder}
            />
        </PromptInputBody>

        <PromptInputFooter className="w-full flex-col items-stretch gap-1 border-t-0 px-3 pb-2.5 pt-1">
          <div className="flex w-full items-center justify-between gap-2">
            <PromptInputTools className="min-w-0 shrink items-center gap-1.5">
              <ComposerMoreMenu
                hasInput={hasInput}
                slashCommandsCount={slashCommandsCount}
                tokenBudget={tokenBudget}
                onOpenAttachmentPicker={openAttachmentPicker}
                onToggleCommandMenu={onToggleCommandMenu}
                onOpenTranslateDialog={() => setIsTranslateDialogOpen(true)}
                onShowTokenUsage={onShowTokenUsage}
                onScheduleMessage={onScheduleMessage}
                onClearInput={onClearInput}
              />

              <PromptInputButton
                tooltip={{ content: t('input.attachFiles') }}
                onClick={openAttachmentPicker}
                aria-label={t('input.attachFiles')}
                className="hidden h-9 w-9 shrink-0 rounded-2xl border border-slate-200/80 bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground dark:border-white/[0.08] sm:inline-flex"
              >
                <PaperclipIcon />
              </PromptInputButton>

              {onVoiceTranscript && (
                <VoiceInputButton state={voiceState} onToggle={voiceToggle} errorMsg={voiceError} />
              )}

              <div className="hidden sm:inline-flex">
                <TokenUsageSummary usage={tokenBudget} onClick={onShowTokenUsage} />
              </div>
            </PromptInputTools>

            <div className="ml-auto flex shrink-0 items-center gap-1.5">
              <ScheduleMessagePopover
                disabled={!input?.trim()}
                onSchedule={onScheduleMessage}
              />

              <ComposerModelMenu
                effort={effort}
                effortOptions={availableEffortOptions}
                onSelectEffort={onSelectEffort}
                model={model}
                modelOptions={availableModelOptions}
                onSelectModel={onSelectModel}
                modelsLoading={modelsLoading}
              />

              <ComposerPermissionMenu
                permissionMode={permissionMode}
                permissionModes={availablePermissionModes}
                onSelectPermissionMode={onSelectPermissionMode}
                providerLabel={providerLabel}
              />

              <PromptInputSubmit
                onClick={
                  canQueueDraft
                    ? (e: MouseEvent<HTMLButtonElement>) => {
                        e.preventDefault();
                        onSubmit(e);
                      }
                    : isLoading
                      ? onAbortSession
                      : isRecording
                        ? (e: MouseEvent<HTMLButtonElement>) => {
                            e.preventDefault();
                            voiceStop({ send: true });
                          }
                        : undefined
                }
                disabled={
                  isLoading
                    ? false
                    : isRecording
                      ? false
                      : isTranscribing
                        ? true
                        : !input?.trim() && attachedFiles.length === 0
                }
                aria-label={submitAriaLabel}
                title={submitAriaLabel}
                className="h-10 w-10 shrink-0 rounded-2xl shadow-sm"
              >
                {isTranscribing ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : canQueueDraft ? (
                  <ArrowUpIcon className="h-5 w-5" strokeWidth={2.2} />
                ) : undefined}
              </PromptInputSubmit>
            </div>
          </div>

          <div
            className={`hidden px-2 text-center text-xs leading-4 text-muted-foreground/50 transition-opacity duration-200 lg:block ${
              input?.trim() && !canQueueDraft ? 'opacity-0' : 'opacity-100'
            }`}
          >
            {submitHint}
          </div>
        </PromptInputFooter>
      </PromptInput>
      </div>}
    </div>
  );
}
