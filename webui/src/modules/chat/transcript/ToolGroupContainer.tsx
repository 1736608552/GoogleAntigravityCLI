import { memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FileEdit,
  FolderSearch,
  Layers,
  ListChecks,
  Loader2,
  Terminal,
  Wrench,
  XCircle,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import type {
  ChatMessage,
  ClaudePermissionSuggestion,
  DiffLine,
  DiffStats,
  LLMProvider,
  PermissionGrantResult,
  Project,
  ToolGroupItem,
} from '@/shared/types';
import {
  formatToolDisplayName,
  getFileBasename,
  getToolConfig,
  translateActionPhrase,
} from '@/modules/chat/tools/configs/toolConfigs';
import { ToolErrorDisplay, ToolRenderer, shouldHideToolResult } from '@/modules/chat/tools';
import { useIsExportingTranscript } from '@/modules/chat/context/TranscriptRenderContext';
import { DiffStatsBadge } from '@/modules/chat/tools/DiffStatsBadge';
import { parseToolPayload, summarizeDiff } from '@/modules/chat/utils/messageTransforms';

type ToolGroupContainerProps = {
  group: ToolGroupItem;
  prevMessage: ChatMessage | null;
  createDiff: (oldStr: string, newStr: string) => DiffLine[];
  getMessageKey: (message: ChatMessage) => string;
  onFileOpen?: (filePath: string, diffInfo?: unknown) => void;
  onShowSettings?: () => void;
  onGrantToolPermission?: (suggestion: ClaudePermissionSuggestion) => PermissionGrantResult | null | undefined;
  showRawParameters?: boolean;
  showThinking?: boolean;
  selectedProject?: Project | null;
  provider: LLMProvider | string;
  /** True only when this exact group is the trailing active tool group of the current running turn. */
  isSessionProcessing?: boolean;
};

type StepStatus = 'running' | 'completed' | 'error';
type StepPhaseKey = 'inspect' | 'edit' | 'exec' | 'plan' | 'other';

type PreparedStep = {
  key: string;
  message: ChatMessage;
  originalIndex: number;
  status: StepStatus;
  phase: StepPhaseKey;
  title: string;
  subtitle: string;
  shortTarget: string;
  durationMs?: number;
};

type ParentStepLayer = {
  layerKey: string;
  phase: StepPhaseKey;
  label: string;
  icon: LucideIcon;
  steps: PreparedStep[];
  hasError: boolean;
  totalDurationMs?: number;
  summaryPreview: string;
};

const PHASE_META: Record<StepPhaseKey, { label: string; icon: LucideIcon }> = {
  inspect: { label: '查阅与检索代码', icon: FolderSearch },
  edit: { label: '编写与修改文件', icon: FileEdit },
  exec: { label: '执行命令与验证', icon: Terminal },
  plan: { label: '同步执行进度', icon: ListChecks },
  other: { label: '执行辅助工具', icon: Layers },
};

function classifyToolPhase(toolName: string): StepPhaseKey {
  switch (toolName) {
    case 'read_file':
    case 'view_file':
    case 'Read':
    case 'grep_search':
    case 'Grep':
    case 'find_by_name':
    case 'Glob':
    case 'list_dir':
    case 'read_url_content':
    case 'WebFetch':
    case 'search_web':
    case 'WebSearch':
      return 'inspect';
    case 'edit_file':
    case 'replace_file_content':
    case 'Edit':
    case 'ApplyPatch':
    case 'write_file':
    case 'write_to_file':
    case 'Write':
      return 'edit';
    case 'run_command':
    case 'Bash':
    case 'PowerShell':
    case 'exec':
    case 'manage_task':
      return 'exec';
    case 'update_steps':
    case 'TodoWrite':
    case 'TodoRead':
    case 'TaskCreate':
    case 'TaskUpdate':
    case 'TaskList':
    case 'TaskGet':
      return 'plan';
    default:
      return 'other';
  }
}

/**
 * Totals the lines added and removed across every diff-producing tool call in
 * the step group (works for both single-tool and mixed-tool execution runs).
 */
function useGroupDiffStats(
  messages: ChatMessage[],
  createDiff: (oldStr: string, newStr: string) => DiffLine[],
): DiffStats | null {
  return useMemo(() => {
    let added = 0;
    let removed = 0;
    let counted = 0;

    for (const message of messages) {
      const config = getToolConfig(message.toolName || 'UnknownTool').input;
      if (config.contentType !== 'diff' || !config.getContentProps) {
        continue;
      }

      const contentProps = config.getContentProps(parseToolPayload(message.toolInput) ?? {});
      if (typeof contentProps?.oldContent !== 'string' || typeof contentProps?.newContent !== 'string') {
        continue;
      }

      const stats = summarizeDiff(createDiff(contentProps.oldContent, contentProps.newContent));
      added += stats.added;
      removed += stats.removed;
      counted += 1;
    }

    return counted > 0 ? { added, removed } : null;
  }, [createDiff, messages]);
}

function resolveStepStatus(
  message: ChatMessage,
  isLastStepInGroup: boolean,
  isCurrentActiveGroup?: boolean,
): StepStatus {
  if (message.toolStatus === 'failed' || message.toolResult?.isError) {
    return 'error';
  }
  if (message.toolResult) {
    return 'completed';
  }
  // Never spin stale history turns or earlier completed steps inside the active group.
  if (!isCurrentActiveGroup) {
    return 'completed';
  }
  if (message.toolStatus === 'in_progress' || message.isStreaming || isLastStepInGroup) {
    return 'running';
  }
  return 'completed';
}

function formatStepDuration(durationMs?: number): string | null {
  if (typeof durationMs !== 'number' || !Number.isFinite(durationMs) || durationMs <= 0) {
    return null;
  }
  if (durationMs < 1000) {
    return `${Math.round(durationMs)}ms`;
  }
  if (durationMs < 60_000) {
    return `${(durationMs / 1000).toFixed(1)}s`;
  }
  const minutes = Math.floor(durationMs / 60_000);
  const seconds = Math.round((durationMs % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}

function stripSurroundingQuotes(text: string): string {
  return text.trim().replace(/^["'“”‘’]+|["'“”‘’]+$/g, '').trim();
}

function buildStepPresentation(
  message: ChatMessage,
  status: StepStatus,
): { title: string; subtitle: string; shortTarget: string } {
  const toolName = message.toolName || 'Tool';
  const inputObj = (parseToolPayload(message.toolInput) as Record<string, unknown> | null) ?? {};
  const config = getToolConfig(toolName).input;
  const prefix = status === 'running' ? '正在' : status === 'error' ? '异常 · ' : '已';

  const filePath = stripSurroundingQuotes(String(
    inputObj.AbsolutePath
      || inputObj.Path
      || inputObj.TargetFile
      || inputObj.target_file
      || inputObj.file_path
      || inputObj.filePath
      || inputObj.path
      || inputObj.DirectoryPath
      || '',
  ));
  const baseName = stripSurroundingQuotes(getFileBasename(filePath));
  const rawSummary = typeof inputObj.toolSummary === 'string' && inputObj.toolSummary.trim()
    ? inputObj.toolSummary.trim()
    : typeof inputObj.toolAction === 'string' && inputObj.toolAction.trim()
      ? inputObj.toolAction.trim()
      : '';
  const summaryText = rawSummary ? stripSurroundingQuotes(translateActionPhrase(rawSummary)) : '';

  let title = '';
  let subtitle = '';
  let shortTarget = baseName || '';

  switch (toolName) {
    case 'read_file':
    case 'view_file':
    case 'Read': {
      title = `${prefix}读取 ${baseName || '文件内容'}`;
      subtitle = filePath || summaryText;
      shortTarget = baseName || '文件';
      break;
    }
    case 'edit_file':
    case 'replace_file_content':
    case 'Edit':
    case 'ApplyPatch': {
      title = `${prefix}修改 ${baseName || '文件'}`;
      subtitle = (typeof inputObj.Instruction === 'string' && inputObj.Instruction.trim())
        || (typeof inputObj.Description === 'string' && inputObj.Description.trim())
        || filePath
        || summaryText;
      shortTarget = baseName || '文件';
      break;
    }
    case 'write_file':
    case 'write_to_file':
    case 'Write': {
      title = `${prefix}写入 ${baseName || '文件'}`;
      subtitle = (typeof inputObj.Description === 'string' && inputObj.Description.trim())
        || filePath
        || summaryText;
      shortTarget = baseName || '文件';
      break;
    }
    case 'update_steps': {
      const steps = Array.isArray(inputObj.steps) ? inputObj.steps : [];
      const doneCount = steps.filter((s: any) => s?.status === 'done').length;
      const activeStep = steps.find((s: any) => s?.status === 'in_progress') || steps[steps.length - 1];
      title = steps.length > 0
        ? `${prefix}更新执行进度 (${doneCount}/${steps.length})`
        : `${prefix}更新执行进度`;
      subtitle = typeof activeStep?.title === 'string' ? activeStep.title : '同步任务清单状态';
      shortTarget = typeof activeStep?.title === 'string' ? activeStep.title : '任务进度';
      break;
    }
    case 'run_command':
    case 'Bash':
    case 'PowerShell':
    case 'exec': {
      const cmd = String(inputObj.CommandLine || inputObj.command || inputObj.cmd || '').replace(/\s+/g, ' ').trim();
      const cleanedSummary = summaryText.replace(/^(正在|已)/, '');
      title = cleanedSummary ? `${prefix}${cleanedSummary}` : `${prefix}执行终端命令`;
      subtitle = cmd || String(inputObj.Description || '').trim();
      shortTarget = cleanedSummary || cmd.split(' ')[0] || '命令';
      break;
    }
    case 'grep_search':
    case 'Grep': {
      const query = String(inputObj.Query || inputObj.query || inputObj.pattern || '').trim();
      title = query ? `${prefix}检索 ${query.slice(0, 32)}` : `${prefix}搜索代码库`;
      subtitle = filePath || summaryText || String(inputObj.SearchPath || '').trim();
      shortTarget = query ? `"${query.slice(0, 18)}"` : '代码库';
      break;
    }
    case 'find_by_name':
    case 'Glob':
    case 'list_dir': {
      const target = baseName || String(inputObj.Pattern || inputObj.pattern || '').trim() || '工作区目录';
      title = `${prefix}扫描 ${target}`;
      subtitle = filePath || summaryText;
      shortTarget = target;
      break;
    }
    case 'search_web':
    case 'WebSearch':
    case 'read_url_content':
    case 'WebFetch': {
      const target = String(inputObj.query || inputObj.Query || inputObj.Url || inputObj.url || '').trim();
      title = `${prefix}${formatToolDisplayName(toolName)}`;
      subtitle = target || summaryText;
      shortTarget = target.slice(0, 24) || formatToolDisplayName(toolName);
      break;
    }
    default: {
      const rawValue = config.getValue?.(inputObj)
        || (typeof config.title === 'function' ? config.title(inputObj) : config.title)
        || formatToolDisplayName(toolName);
      const cleanValue = stripSurroundingQuotes(String(rawValue || formatToolDisplayName(toolName)));
      title = summaryText ? `${prefix}${summaryText.replace(/^(正在|已)/, '')}` : `${prefix}${cleanValue}`;
      subtitle = filePath || String(message.displayText || '').trim();
      shortTarget = cleanValue.slice(0, 24);
      break;
    }
  }

  if (!subtitle && message.toolResult?.isError) {
    subtitle = String(message.toolResult.content || '').split('\n')[0]?.trim() || '执行出现异常';
  }
  if (!subtitle && summaryText && summaryText !== title) {
    subtitle = summaryText;
  }
  if (!subtitle) {
    subtitle = formatToolDisplayName(toolName);
  }
  if (!shortTarget) {
    shortTarget = formatToolDisplayName(toolName);
  }

  return { title, subtitle, shortTarget };
}

function groupArchivedIntoParentLayers(steps: PreparedStep[]): ParentStepLayer[] {
  const layers: ParentStepLayer[] = [];

  for (const step of steps) {
    const prevLayer = layers[layers.length - 1];
    if (prevLayer && prevLayer.phase === step.phase) {
      prevLayer.steps.push(step);
      if (step.status === 'error') {
        prevLayer.hasError = true;
      }
      if (typeof step.durationMs === 'number' && step.durationMs > 0) {
        prevLayer.totalDurationMs = (prevLayer.totalDurationMs ?? 0) + step.durationMs;
      }
    } else {
      const meta = PHASE_META[step.phase];
      layers.push({
        layerKey: `${step.phase}-${step.key}`,
        phase: step.phase,
        label: meta.label,
        icon: meta.icon,
        steps: [step],
        hasError: step.status === 'error',
        totalDurationMs: typeof step.durationMs === 'number' && step.durationMs > 0 ? step.durationMs : undefined,
        summaryPreview: '',
      });
    }
  }

  for (const layer of layers) {
    const targets = Array.from(new Set(layer.steps.map((s) => s.shortTarget).filter(Boolean)));
    const head = targets.slice(0, 2).join('、');
    layer.summaryPreview = targets.length > 2 ? `${head} 等 ${layer.steps.length} 项` : head;
  }

  return layers;
}

/**
 * Rendered by chat's ChatMessagesPane and TranscriptExportDocument.
 * Archives completed steps into compact collapsible parent phase layers inside
 * a seamless white card, while rendering the currently executing tool as a
 * single subtle muted status line right beneath the card until it finishes.
 */
function ToolGroupContainer({
  group,
  createDiff,
  getMessageKey,
  onFileOpen,
  showRawParameters,
  selectedProject,
  isSessionProcessing,
}: ToolGroupContainerProps) {
  const { t } = useTranslation('chat');
  const isExporting = useIsExportingTranscript();
  // Controls overall visibility of parent phase layers inside the white card.
  const [isCardExpanded, setIsCardExpanded] = useState(true);
  // Tracks which parent layers have been opened to inspect their child steps.
  const [expandedLayerKeys, setExpandedLayerKeys] = useState<Record<string, boolean>>({});
  // Tracks which child step rows have been clicked open to inspect raw tool inputs, command logs, or diffs.
  const [expandedStepKeys, setExpandedStepKeys] = useState<Record<string, boolean>>({});

  const groupDiffStats = useGroupDiffStats(group.messages, createDiff);

  const { archivedSteps, liveRunningSteps } = useMemo(() => {
    const archived: PreparedStep[] = [];
    const running: PreparedStep[] = [];

    group.messages.forEach((msg, idx) => {
      const status = resolveStepStatus(msg, idx === group.messages.length - 1, isSessionProcessing);
      const { title, subtitle, shortTarget } = buildStepPresentation(msg, status);
      const item: PreparedStep = {
        key: getMessageKey(msg),
        message: msg,
        originalIndex: idx,
        status,
        phase: classifyToolPhase(msg.toolName || 'Tool'),
        title,
        subtitle,
        shortTarget,
        durationMs: msg.toolDurationMs,
      };

      if (status === 'running' && !isExporting) {
        running.push(item);
      } else {
        archived.push(item);
      }
    });

    return { archivedSteps: archived, liveRunningSteps: running };
  }, [getMessageKey, group.messages, isExporting, isSessionProcessing]);

  const parentLayers = useMemo(() => groupArchivedIntoParentLayers(archivedSteps), [archivedSteps]);

  const toggleLayer = useCallback((layerKey: string) => {
    setExpandedLayerKeys((prev) => ({ ...prev, [layerKey]: !prev[layerKey] }));
  }, []);

  const toggleStepDetail = useCallback((stepKey: string) => {
    setExpandedStepKeys((prev) => ({ ...prev, [stepKey]: !prev[stepKey] }));
  }, []);

  const showCardBody = isCardExpanded || isExporting;

  return (
    <div
      className="chat-message tool px-3 sm:px-0"
      data-message-timestamp={group.timestamp || undefined}
    >
      {archivedSteps.length > 0 && (
        <div className="rounded-2xl border border-slate-200/75 bg-white px-4 py-3 shadow-[0_2px_10px_rgba(15,23,42,0.03)] transition-all duration-200 dark:border-white/[0.08] dark:bg-zinc-900/85">
          <button
            type="button"
            className="flex w-full items-center justify-between gap-2 text-left"
            onClick={() => setIsCardExpanded((current) => !current)}
            aria-expanded={showCardBody}
          >
            <div className="flex min-w-0 items-center gap-2">
              <Wrench className="h-3.5 w-3.5 shrink-0 text-blue-500/85 dark:text-blue-400" strokeWidth={1.75} aria-hidden />
              <span className="truncate text-[13px] font-medium text-foreground/85">
                智能体执行步骤 ({archivedSteps.length})
              </span>
              {groupDiffStats && <DiffStatsBadge stats={groupDiffStats} className="ml-1 shrink-0" />}
            </div>

            <ChevronDown
              className={`h-4 w-4 shrink-0 text-muted-foreground/65 transition-transform duration-200 ${
                showCardBody ? 'rotate-0' : '-rotate-90'
              }`}
              strokeWidth={1.75}
              aria-hidden
            />
          </button>

          {showCardBody && (
            <div className="mt-2.5 space-y-1.5">
              {parentLayers.map((layer) => {
                const LayerIcon = layer.icon;
                const layerDurationText = formatStepDuration(layer.totalDurationMs);
                const isLayerOpen =
                  expandedLayerKeys[layer.layerKey] !== undefined
                    ? Boolean(expandedLayerKeys[layer.layerKey])
                    : layer.hasError || isExporting;

                return (
                  <div key={layer.layerKey} className="rounded-xl transition-colors">
                    <button
                      type="button"
                      onClick={() => toggleLayer(layer.layerKey)}
                      aria-expanded={isLayerOpen}
                      className="-mx-1.5 flex w-[calc(100%+0.75rem)] items-center justify-between gap-2 rounded-xl px-2 py-1.5 text-left transition-colors hover:bg-muted/40 dark:hover:bg-zinc-800/45"
                    >
                      <div className="flex min-w-0 flex-1 items-center gap-2">
                        {layer.hasError ? (
                          <XCircle className="h-4 w-4 shrink-0 text-rose-500/90" strokeWidth={1.75} aria-hidden />
                        ) : (
                          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500/90" strokeWidth={1.75} aria-hidden />
                        )}
                        <LayerIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" strokeWidth={1.75} aria-hidden />
                        <span className="shrink-0 text-[13px] font-medium text-foreground/85">
                          {layer.label}
                        </span>
                        <span className="shrink-0 text-[12px] text-muted-foreground/65">
                          · {layer.steps.length}
                        </span>
                        {!isLayerOpen && layer.summaryPreview && (
                          <span className="min-w-0 truncate text-[12px] text-muted-foreground/60">
                            ({layer.summaryPreview})
                          </span>
                        )}
                      </div>

                      <div className="flex shrink-0 items-center gap-1.5">
                        {layerDurationText && (
                          <span className="font-mono text-[11px] tabular-nums text-muted-foreground/65">
                            {layerDurationText}
                          </span>
                        )}
                        <ChevronRight
                          className={`h-3.5 w-3.5 text-muted-foreground/55 transition-transform duration-150 ${
                            isLayerOpen ? 'rotate-90' : ''
                          }`}
                          strokeWidth={1.75}
                          aria-hidden
                        />
                      </div>
                    </button>

                    {isLayerOpen && (
                      <div className="ml-2.5 mt-1 space-y-1.5 border-l border-border/50 pl-3 dark:border-zinc-800">
                        {layer.steps.map((step) => {
                          const durationText = formatStepDuration(step.durationMs);
                          const isStepOpen = Boolean(expandedStepKeys[step.key]) || isExporting;

                          return (
                            <div key={step.key}>
                              <button
                                type="button"
                                onClick={() => toggleStepDetail(step.key)}
                                aria-expanded={isStepOpen}
                                className="-mx-1.5 flex w-[calc(100%+0.75rem)] items-start gap-2 rounded-lg px-1.5 py-1 text-left transition-colors hover:bg-muted/35 dark:hover:bg-zinc-800/40"
                              >
                                <span className="mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center">
                                  {step.status === 'error' ? (
                                    <XCircle className="h-3.5 w-3.5 text-rose-500/90" strokeWidth={1.75} aria-hidden />
                                  ) : (
                                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500/85" strokeWidth={1.75} aria-hidden />
                                  )}
                                </span>

                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="truncate text-[12.5px] font-normal leading-5 text-foreground/90">
                                      {step.title}
                                    </span>
                                    {durationText && (
                                      <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground/60">
                                        {durationText}
                                      </span>
                                    )}
                                  </div>

                                  {step.subtitle && (
                                    <p className="truncate text-[11.5px] leading-4 text-muted-foreground/70">
                                      {step.subtitle}
                                    </p>
                                  )}
                                </div>
                              </button>

                              {isStepOpen && (
                                <div className="mt-1 space-y-2 rounded-xl border border-border/40 bg-muted/25 p-2.5 dark:border-zinc-800/70 dark:bg-zinc-950/45">
                                  {Boolean(step.message.displayText) && (
                                    <p className="text-xs leading-5 text-muted-foreground">
                                      {String(step.message.displayText)}
                                    </p>
                                  )}

                                  {Boolean(step.message.toolInput) && (
                                    <ToolRenderer
                                      toolName={step.message.toolName || 'UnknownTool'}
                                      toolInput={step.message.toolInput}
                                      toolResult={step.message.toolResult}
                                      toolId={step.message.toolId}
                                      mode="input"
                                      onFileOpen={onFileOpen}
                                      createDiff={createDiff}
                                      selectedProject={selectedProject}
                                      showRawParameters={showRawParameters}
                                      rawToolInput={typeof step.message.toolInput === 'string' ? step.message.toolInput : undefined}
                                      toolStatus={step.message.toolStatus}
                                    />
                                  )}

                                  {step.message.toolResult
                                    && step.message.toolName !== 'Bash'
                                    && !shouldHideToolResult(step.message.toolName || 'UnknownTool', step.message.toolResult) && (
                                      step.message.toolResult.isError ? (
                                        <div id={`tool-result-${step.message.toolId}`} className="scroll-mt-4">
                                          <ToolErrorDisplay
                                            label={t('messageTypes.error')}
                                            content={String(step.message.toolResult.content || '')}
                                          />
                                        </div>
                                      ) : (
                                        <div id={`tool-result-${step.message.toolId}`} className="scroll-mt-4">
                                          <ToolRenderer
                                            toolName={step.message.toolName || 'UnknownTool'}
                                            toolInput={step.message.toolInput}
                                            toolResult={step.message.toolResult}
                                            toolId={step.message.toolId}
                                            mode="result"
                                            onFileOpen={onFileOpen}
                                            createDiff={createDiff}
                                            selectedProject={selectedProject}
                                          />
                                        </div>
                                      )
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {liveRunningSteps.length > 0 && (
        <div className={archivedSteps.length > 0 ? 'mt-2 space-y-1 px-1.5' : 'space-y-1 px-1.5'}>
          {liveRunningSteps.map((live) => (
            <div
              key={live.key}
              className="flex items-center gap-2 text-xs text-muted-foreground/75 transition-opacity duration-200"
            >
              <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground/70" strokeWidth={1.75} aria-hidden />
              <span className="truncate">{live.title}</span>
              {live.subtitle && live.subtitle !== live.title && (
                <span className="hidden min-w-0 truncate text-[11px] text-muted-foreground/50 sm:inline">
                  · {live.subtitle}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Memoized for transcript stability when unrelated UI flags toggle.
 */
export default memo(ToolGroupContainer);
