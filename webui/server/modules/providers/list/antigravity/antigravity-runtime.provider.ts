import { exec, execFileSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import crossSpawn from 'cross-spawn';

import {
  appendFilesInputTag,
  appendImagesInputTag,
  normalizeAttachmentDescriptors,
} from '@/shared/image-attachments.js';
import { notifyRunFailed, notifyRunStopped } from '@/modules/notifications/index.js';
import {
  createCompleteMessage,
  createNormalizedMessage,
  generateMessageId,
} from '@/shared/utils.js';
import type { IProviderRuntime } from '@/shared/interfaces.js';
import type { AnyRecord, ProviderRuntimeContext, ProviderRuntimeWriter } from '@/shared/types.js';
import { resolveAntigravityBinary } from './antigravity-auth.provider.js';
import {
  getProxyToggle,
  resolveAntigravityProxyEnv,
  notifyTurnStarted,
  notifyTurnEnded,
} from './antigravity-proxy.js';
import { antigravityAccountsService } from './antigravity-accounts.service.js';
import { localizeEnglishThought, humanizeAntigravityError } from './antigravity-chinese-filter.js';
export { localizeEnglishThought, humanizeAntigravityError };

const spawnFunction = crossSpawn;
const activeAntigravityProcesses = new Map<string, ChildProcess>();
const activeAbortControllers = new Map<string, AbortController>();

let lastProxyRestartTime = 0;

/**
 * Kills Antigravity CLI processes left over from a previous server lifecycle.
 *
 * Each run is spawned with `--print-timeout`, so a CLI whose turn ended does
 * NOT exit on its own — it waits for the next stdin prompt. The runtime
 * SIGKILLs it ~4s after a turn resolves, but that safety timer lives in the
 * server's event loop. If the server crashes or is restarted mid-run (EADDRINUSE,
 * supervisor respawn, a deploy), the timer is lost and the child is reparented
 * to init, lingering for the full print-timeout. On every fresh boot this scans
 * /proc and reaps orphans spawned with THIS binary, so they can never pile up.
 * Safe because at boot the new server has not spawned anything yet — every
 * matching process is, by definition, an orphan.
 */
function reapOrphanedAntigravityProcesses(): void {
  const binPath = resolveAntigravityBinary();
  if (!binPath) return;
  const realBinPath = fs.existsSync(binPath) ? fs.realpathSync(binPath) : binPath;
  let reapedCount = 0;
  try {
    for (const entry of fs.readdirSync('/proc')) {
      if (!/^\d+$/.test(entry)) continue;
      const pid = Number(entry);
      if (pid === process.pid) continue;
      let cmdline = '';
      try { cmdline = fs.readFileSync(`/proc/${entry}/cmdline`, 'utf8'); } catch { continue; }
      // cmdline is NUL-separated; rebuild contains() works across the whole string.
      if ((cmdline.includes(binPath) || cmdline.includes(realBinPath)) && cmdline.includes('--input-format')) {
        try {
          process.kill(pid, 'SIGKILL');
          reapedCount++;
        } catch { /* already gone */ }
      }
    }
    if (reapedCount > 0) {
      console.log(`[Antigravity Runtime] 🧹 启动清理: 成功回收 ${reapedCount} 个上代遗留孤儿 CLI 进程`);
    }
  } catch { /* /proc not available (non-Linux) — no-op */ }
}

// 禁用模块加载时顶层无差别强杀：防止在多会话或长任务执行时，误杀当前活跃进程与后台子任务
// reapOrphanedAntigravityProcesses();

function resolveAntigravityPermissionArgs(permissionMode?: string, skipPermissions?: boolean): string[] {
  if (skipPermissions || permissionMode === 'bypassPermissions' || permissionMode === 'auto') {
    return ['--dangerously-skip-permissions'];
  }
  switch (permissionMode) {
    case 'plan':
      return ['--mode', 'plan'];
    case 'accept-edits':
    case 'acceptEdits':
      return ['--mode', 'accept-edits'];
    case 'sandbox':
      return ['--sandbox'];
    default:
      // In web streaming non-interactive mode, auto-approve commands and edits
      // so tools do not hang waiting for interactive TTY prompts that never arrive.
      return ['--dangerously-skip-permissions'];
  }
}

function resolveAntigravityModelAndEffort(
  model?: string,
  effort?: string,
): { resolvedModel?: string; resolvedEffort?: string } {
  if (!model || typeof model !== 'string') {
    return { resolvedModel: undefined, resolvedEffort: undefined };
  }

  let resolvedModel = model.trim();
  let resolvedEffort =
    effort && typeof effort === 'string' && effort.toLowerCase() !== 'default' && effort.trim() !== ''
      ? effort.toLowerCase().trim()
      : undefined;

  // 关键修复：仅针对 Google 原生 gemini-* 模型剥离历史后缀（如 gemini-3.8-flash-high -> gemini-3.8-flash）
  // 严禁将三方模型 gpt-oss-120b-medium 截断为不存在的 gpt-oss-120b
  if (resolvedModel.startsWith('gemini-')) {
    const legacyMatch = resolvedModel.match(/^(.+)-(high|medium|low)$/);
    if (legacyMatch) {
      resolvedModel = legacyMatch[1];
      if (!resolvedEffort) {
        resolvedEffort = legacyMatch[2];
      }
    }
  }

  // Antigravity CLI 规范：仅原生 gemini-* 模型支持并强制要求 --effort 参数 (low/medium/high)
  // 严禁向所有三方模型（claude-opus-4-6-thinking、claude-sonnet-4-6、gpt-oss-120b-medium 等）传递 --effort，否则 CLI 立即报错拒绝启动
  const supportsEffort = resolvedModel.startsWith('gemini-');
  if (supportsEffort) {
    // 关键修复：Antigravity CLI 对所有 gemini-* 模型强制要求 --effort (low/medium/high)
    // 如果前端未指定或传入了 'default' / 空值，默认设定为 'high' (深度思考)
    if (!resolvedEffort || !['low', 'medium', 'high'].includes(resolvedEffort)) {
      resolvedEffort = 'high';
    }
    // gemini-3.1-pro 仅支持 high 和 low
    if (resolvedModel === 'gemini-3.1-pro' && resolvedEffort === 'medium') {
      resolvedEffort = 'high';
    }
  } else {
    resolvedEffort = undefined;
  }

  return { resolvedModel, resolvedEffort };
}

const CHINESE_LANGUAGE_RULE_CONTENT = `# Antigravity 全局语言与思维规范 (Global Language & Reasoning Guidelines)

无论在任何场景、处理何种任务或项目，必须严格执行以下准则：

## 1. 深度思考过程 (Thinking Process / Chain-of-Thought)
- **必须全程使用中文思考**：模型内部的所有思维推理过程（包括 <thinking> 内部的逻辑分析、推导演进、工具调用规划、风险研判与反思），**一律且必须使用中文**。
- **严禁英文思考**：除代码标识符、系统指令、函数名称或错误原文字符串外，禁止在思考过程中使用英文组织语言。

## 2. 回复与交互 (Output & Responses)
- **始终使用中文回复用户**：所有对用户的解释、总结、方案陈述、执行汇报均使用规范、流畅、通俗易懂的中文。
- **工具调用摘要**：所有工具调用的 toolAction 与 toolSummary 尽可能使用规范中文表达。
- **技术名词规范**：常见行业标准词汇（如 Git, Docker, API, JSON, SOCKS5, Token 等）可保留英文原词，其余文本一律使用中文。
`;

export const CHINESE_ENFORCEMENT_PREFIX = '【系统要求：本轮交互所有思维推理(<thinking>)与任务执行分析必须全程100%使用中文撰写，严禁使用任何英文组织思路】\n\n';


export function ensureChineseRules(workingDir?: string) {
  try {
    const homeDir = process.env.AGY_HOME || process.env.HOME || '/tmp/agy-test/home';
    const targetDirs = [
      homeDir,
      path.join(homeDir, '.gemini', 'config'),
      path.join(homeDir, '.gemini', 'antigravity-cli'),
    ];

    if (workingDir) {
      targetDirs.push(workingDir);
    }

    for (const dir of targetDirs) {
      if (!fs.existsSync(dir)) {
        try {
          fs.mkdirSync(dir, { recursive: true });
        } catch (_) {}
      }

      for (const filename of ['GEMINI.md', 'AGENTS.md']) {
        const filePath = path.join(dir, filename);
        if (!fs.existsSync(filePath)) {
          fs.writeFileSync(filePath, CHINESE_LANGUAGE_RULE_CONTENT, 'utf8');
        } else {
          try {
            const content = fs.readFileSync(filePath, 'utf8');
            if (!content.includes('必须全程使用中文思考') && !content.includes('必须 100% 始终使用中文')) {
              fs.appendFileSync(filePath, '\n\n' + CHINESE_LANGUAGE_RULE_CONTENT, 'utf8');
            }
          } catch (_) {}
        }
      }
    }
  } catch (err: any) {
    console.warn('[Antigravity Runtime] ensureChineseRules error:', err?.message);
  }
}

type TurnAttemptParams = {
  command: string;
  workingDir: string;
  model?: string;
  effort?: string;
  permissionMode?: string;
  skipPermissions?: boolean;
  images?: unknown;
  files?: unknown;
  capturedSessionId: string | null;
  accumulatedText: string;
  ws: ProviderRuntimeWriter;
  currentSessionKey: string;
  abortSignal: AbortSignal;
  onSessionDiscovered: (id: string) => void;
  onTextDelta: (delta: string) => void;
  onFullText: (full: string) => void;
  onProcessSpawned: (proc: ChildProcess) => void;
};

type TurnAttemptResult = {
  exitCode: number;
  conversationId: string | null;
  usage?: AnyRecord;
  spawnedSubagentsCount?: number;
  lastAssistantContent?: string;
};

class QuotaExhaustedError extends Error {
  public resetTimeMsg?: string;
  public rawText?: string;
  constructor(message: string, resetTimeMsg?: string, rawText?: string) {
    super(message);
    this.name = 'QuotaExhaustedError';
    this.resetTimeMsg = resetTimeMsg;
    this.rawText = rawText;
  }
}

const CHINESE_RULES_CONTENT = `# Antigravity 全局语言与思维规范 (Global Language & Reasoning Guidelines)

无论在任何场景、处理何种任务或项目，必须严格执行以下准则：

## 1. 深度思考过程 (Thinking Process / Chain-of-Thought)
- **必须全程使用中文思考**：模型内部的所有思维推理过程（包括 <thinking> 内部的逻辑分析、推导演进、工具调用规划、风险研判与反思），**一律且必须使用中文**。
- **严禁英文思考**：除代码标识符、系统指令、函数名称或错误原文字符串外，禁止在思考过程中使用英文组织语言。

## 2. 回复与交互 (Output & Responses)
- **始终使用中文回复用户**：所有对用户的解释、总结、方案陈述、执行汇报均使用规范、流畅、通俗易懂的中文。
- **技术名词规范**：常见行业标准词汇（如 Git, Docker, API, JSON, SOCKS5, Token 等）可保留英文原词，其余文本一律使用中文。
`;

function ensureAntigravityGlobalRules(workingDir?: string): void {
  try {
    const homeDir = process.env.HOME || process.env.USERPROFILE || '/tmp/agy-test/home';
    const targetDirs = [
      homeDir,
      path.join(homeDir, '.gemini'),
      path.join(homeDir, '.gemini', 'config'),
      path.join(homeDir, '.gemini', 'antigravity-cli'),
    ];

    if (workingDir && fs.existsSync(workingDir)) {
      targetDirs.push(workingDir);
    }

    for (const dir of targetDirs) {
      try {
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        const ruleFile = path.join(dir, 'GEMINI.md');
        if (!fs.existsSync(ruleFile)) {
          fs.writeFileSync(ruleFile, CHINESE_RULES_CONTENT, 'utf8');
        } else {
          const content = fs.readFileSync(ruleFile, 'utf8');
          if (!content.includes('必须全程使用中文思考')) {
            fs.appendFileSync(ruleFile, '\n\n' + CHINESE_RULES_CONTENT, 'utf8');
          }
        }
      } catch (_) {}
    }
  } catch (err) {
    console.warn('[Antigravity Runtime] ensureAntigravityGlobalRules error:', err);
  }
}

/**
 * Executes a single Antigravity CLI process turn.
 * Implements delta deduplication against \`accumulatedText\` so any re-generated text
 * from retries is smoothly deduplicated without emitting redundant tokens to the client.
 */
function runAntigravityTurnOnce(params: TurnAttemptParams): Promise<TurnAttemptResult> {
  return new Promise((resolve, reject) => {
    const {
      command,
      workingDir,
      model,
      effort,
      permissionMode,
      skipPermissions,
      images,
      files,
      capturedSessionId,
      accumulatedText,
      ws,
      currentSessionKey,
      abortSignal,
      onSessionDiscovered,
      onTextDelta,
      onFullText,
      onProcessSpawned,
    } = params;

    if (abortSignal.aborted) {
      reject(new Error('context canceled'));
      return;
    }

    // Ensure Chinese reasoning rules are permanently present in workspace and user configs
    ensureAntigravityGlobalRules(workingDir);

    const baseArgs = [
      '--input-format', 'stream-json',
      '--output-format', 'stream-json',
      // 单回合最大执行超时放宽至 24 小时，彻底支持过夜挂机、深度自动化分析与超大工程重构
      '--print-timeout', process.env.AGY_PRINT_TIMEOUT || '24h',
    ];

    const isBoostCommand = Boolean(command && /^\/boost\b/i.test(command.trim()));
    const effectiveEffort = isBoostCommand ? 'high' : effort;

    const { resolvedModel, resolvedEffort } = resolveAntigravityModelAndEffort(model, effectiveEffort);
    if (resolvedModel) {
      baseArgs.push('--model', resolvedModel);
    }

    if (resolvedEffort && ['low', 'medium', 'high'].includes(resolvedEffort)) {
      baseArgs.push('--effort', resolvedEffort);
    }

    if (capturedSessionId) {
      baseArgs.push('--conversation', capturedSessionId);
    }

    const permArgs = resolveAntigravityPermissionArgs(permissionMode, skipPermissions);
    baseArgs.push(...permArgs);

    const BOOST_MODE_INSTRUCTION = `【🚀 Antigravity Boost 极致攻坚模式已激活】
你当前正处于 Boost 深度推演与高精度攻坚模式，请严格执行以下准则：
1. 【全链路自主推进】：针对用户需求进行全链路深度思考与多维度推演，全自主调度工具完成方案设计、代码编写、边界排查与自检验证，严禁只做一半就停止等待用户。
2. 【严格自检与零报错】：修改后必须主动使用运行命令、测试或静态检查工具验证成果，确保高质量无回归。
3. 【持续攻坚不中断】：若遇到中间工具报错或异常，必须自主反思并连续自愈推进，直到任务目标完全达成。`;

    let prompt = command || '';
    if (prompt && !prompt.includes(CHINESE_ENFORCEMENT_PREFIX)) {
      if (isBoostCommand) {
        if (prompt.startsWith('/')) {
          const firstLineEnd = prompt.indexOf('\n');
          if (firstLineEnd !== -1) {
            const firstLine = prompt.slice(0, firstLineEnd);
            const rest = prompt.slice(firstLineEnd + 1);
            prompt = `${firstLine}\n\n${BOOST_MODE_INSTRUCTION}\n\n${CHINESE_ENFORCEMENT_PREFIX}${rest}`;
          } else {
            prompt = `${prompt}\n\n${BOOST_MODE_INSTRUCTION}\n\n${CHINESE_ENFORCEMENT_PREFIX}`;
          }
        } else {
          prompt = `${BOOST_MODE_INSTRUCTION}\n\n${CHINESE_ENFORCEMENT_PREFIX}${prompt}`;
        }
      } else {
        prompt = CHINESE_ENFORCEMENT_PREFIX + prompt;
      }
    }
    const hasAttachments =
      normalizeAttachmentDescriptors(images).length > 0 ||
      normalizeAttachmentDescriptors(files).length > 0;
    if (hasAttachments) {
      prompt = appendFilesInputTag(appendImagesInputTag(prompt, images), files);
    }

    const binPath = resolveAntigravityBinary();
    const childEnv = resolveAntigravityProxyEnv({
      ...process.env,
      HOME: process.env.AGY_HOME || process.env.HOME,
    });

    // 关键自愈优化：单会话单实例保障，启动新轮次前先强制终结同 conversation 的历史残留孤儿进程
    const targetConvId = capturedSessionId;
    if (targetConvId) {
      try {
        const oldProc = activeAntigravityProcesses.get(targetConvId);
        if (oldProc && !oldProc.killed) {
          try { oldProc.kill('SIGTERM'); } catch (_) {}
        }
        execFileSync('pkill', ['-9', '-f', `conversation ${targetConvId}`]);
      } catch (_) {}
    }

    let antigravityProcess: ChildProcess;
    try {
      antigravityProcess = spawnFunction(binPath, baseArgs, {
        cwd: workingDir,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: childEnv,
      });
    } catch (err: any) {
      reject(err);
      return;
    }

    onProcessSpawned(antigravityProcess);

    let isSettled = false;
    let watchdogTimer: NodeJS.Timeout | null = null;
    let settleDebounceTimer: NodeJS.Timeout | null = null;
    let turnConversationId = capturedSessionId;
    let turnUsage: AnyRecord | undefined = undefined;
    let spawnedSubagentsCount = 0;

    const clearSettleTimer = () => {
      if (settleDebounceTimer) {
        clearTimeout(settleDebounceTimer);
        settleDebounceTimer = null;
      }
    };

    const onAbort = () => {
      clearSettleTimer();
      if (watchdogTimer) {
        clearInterval(watchdogTimer);
        watchdogTimer = null;
      }
      if (isSettled) return;
      isSettled = true;
      try { antigravityProcess.kill('SIGTERM'); } catch (_) {}
      reject(new Error('context canceled'));
    };
    abortSignal.addEventListener('abort', onAbort, { once: true });

    const finishSuccess = () => {
      if (isSettled) return;
      isSettled = true;
      abortSignal.removeEventListener('abort', onAbort);
      clearSettleTimer();

      if (watchdogTimer) {
        clearInterval(watchdogTimer);
        watchdogTimer = null;
      }

      // 注意：绝不强制关闭 stdin 或强杀子进程，以保证子代理与长程推演的生命周期完整
      resolve({
        exitCode: 0,
        conversationId: turnConversationId,
        usage: turnUsage,
        spawnedSubagentsCount,
        lastAssistantContent: turnEmitted,
      });
    };

    let stdoutLineBuffer = '';
    let turnEmitted = '';
    let turnHasSucceeded = false;
    let lastStderrError = '';
    let quotaErrorDetails: { message: string; resetMsg?: string; rawText?: string } | null = null;
    const seenToolCallIds = new Set<string>();
    let lastActiveToolCall: { id: string; name: string } | null = null;
    let turnStepCounter = 0;

    const processOutputLine = (line: string) => {
      if (!line || !line.trim()) return;

      // Parse JSON stream event
      let obj: AnyRecord;
      try {
        obj = JSON.parse(line);
      } catch {
        // Non-JSON line from stdout: capture as potential error or diagnostic text
        if (line.includes('ERROR') || line.includes('error') || line.includes('failed') || line.includes('RESOURCE_EXHAUSTED')) {
          lastStderrError = line.trim();
        }
        return;
      }

      const activeSession = turnConversationId || currentSessionKey;

      // Handle top-level error event
      if (obj.event === 'error' || (obj.error && obj.event !== 'result')) {
        const errText = String(obj.error || obj.message || 'Antigravity error');
        lastStderrError = errText;
        return;
      }

      // Handle 'init' event
      if (obj.event === 'init') {
        const initData = obj.init as AnyRecord | undefined;
        const convId = (obj.conversation_id as string) || (initData?.conversation_id as string);
        if (convId) {
          turnConversationId = convId;
          onSessionDiscovered(convId);
        }
        return;
      }

      // Handle 'step_update' event
      if (obj.event === 'step_update' && obj.step_update) {
        const update = obj.step_update as AnyRecord;
        const convId = update.conversation_id as string;
        if (convId) {
          turnConversationId = convId;
          onSessionDiscovered(convId);
        }

        turnStepCounter++;
        const stepIdx = update.step_index ?? update.step_number ?? turnStepCounter;
        const stepType = String(update.step_type || update.type || '').toLowerCase();
        const errText = String(update.error || (stepType.includes('error') ? update.content : '') || '');
        if (errText) {
          lastStderrError = errText;
        }

        const isQuotaErr =
          errText.includes('RESOURCE_EXHAUSTED') ||
          errText.includes('Individual quota reached') ||
          (typeof update.content === 'string' &&
            (update.content.includes('RESOURCE_EXHAUSTED') || update.content.includes('Individual quota reached')));

        if (isQuotaErr) {
          const rawErr = errText || String(update.content || '');
          const match = rawErr.match(/Resets in ([^).]+)/i);
          const resetDuration = match ? match[1].trim() : '';
          const resetMsg = resetDuration ? `，将在约 ${resetDuration} 后自动恢复` : '';
          const activeEmail = antigravityAccountsService.getActiveEmail();
          const others = antigravityAccountsService.getOtherAvailableAccounts(activeEmail || '');
          let suggestion = '';
          if (others.length > 0) {
            suggestion = `。检测到已配置备用账号（如 ${others[0].email}），系统即将全自动无缝轮换继续推进`;
          } else {
            suggestion = '。系统即将自动启动智能退避自愈重试';
          }
          const formattedMsg = `⚠️ 当前账号（${activeEmail || '当前账号'}）的模型短期请求速率已达到 Google 上限 (RESOURCE_EXHAUSTED 429)${resetMsg}${suggestion}。`;
          quotaErrorDetails = { message: formattedMsg, resetMsg: resetDuration, rawText: rawErr };
          try { antigravityProcess.kill('SIGTERM'); } catch (_) {}
          return;
        }

        // Tool calls and tool execution results
        const toolInfo = update.tool_info as AnyRecord | undefined;
        if (toolInfo && toolInfo.name) {
          clearSettleTimer();
          if (toolInfo.name === 'invoke_subagent' || toolInfo.name === 'manage_subagents' || toolInfo.name === 'define_subagent') {
            spawnedSubagentsCount++;
          }
          // 采用稳定确定性的 toolId，与持久化历史严格对齐，彻底消除消息合并重复
          const toolId = (update.tool_call_id as string) || (update.id as string) || `call-step-${stepIdx}`;
          let parsedInput = toolInfo.parameters || toolInfo.input || toolInfo.args || {};
          if (typeof parsedInput === 'string') {
            try { parsedInput = JSON.parse(parsedInput); } catch (_) {}
          }

          lastActiveToolCall = { id: toolId, name: String(toolInfo.name) };

          if (!seenToolCallIds.has(toolId)) {
            seenToolCallIds.add(toolId);
            ws.send(createNormalizedMessage({
              kind: 'tool_use',
              toolName: String(toolInfo.name),
              toolInput: parsedInput,
              toolId,
              sessionId: activeSession,
              provider: 'antigravity',
            }));
          }

          if (toolInfo.output || update.output || toolInfo.error || update.error || update.status === 'ERROR' || update.media || toolInfo.media) {
            const isError = Boolean(toolInfo.error || update.error || update.status === 'ERROR');
            const rawContent = toolInfo.error || update.error || toolInfo.output || update.output || '';
            let outStr = typeof rawContent === 'string' ? rawContent : JSON.stringify(rawContent);

            // 实时提取底层返回的媒体图片并在聊天框展示
            const rawMedia = update.media || toolInfo.media || (update.result && (update.result as any).media);
            if (Array.isArray(rawMedia) && rawMedia.length > 0) {
              for (const m of rawMedia) {
                if (m?.uri && typeof m.uri === 'string') {
                  const isImg = !m.mime_type || m.mime_type.startsWith('image/');
                  if (isImg) {
                    outStr += `\n\n![生成的图片](${m.uri})\n`;
                  }
                }
              }
            }

            // 自动补全 Markdown 图片标签
            if (!outStr.includes('![') && /(?:[^\s"'<>\n]+\.(?:jpg|jpeg|png|webp|gif|svg))/i.test(outStr)) {
              const match = outStr.match(/(?:saved at|保存至|路径[:：]?\s*)?([^\s"'<>\n]+\.(?:jpg|jpeg|png|webp|gif|svg))/i);
              if (match && match[1]) {
                outStr += `\n\n![生成的图片](${match[1]})\n`;
              }
            }

            ws.send(createNormalizedMessage({
              kind: 'tool_result',
              toolName: String(toolInfo.name),
              toolId,
              toolResult: { content: outStr, isError },
              content: outStr,
              sessionId: activeSession,
              provider: 'antigravity',
            }));
            lastActiveToolCall = null;
          }
          return;
        }

        // 核心修复：处理独立工具执行结果（如生图完成事件 step_type === 'generic' 或包含 media）
        const isGenericOrResult = stepType === 'generic' || stepType === 'step_result' || Boolean(update.media) || (Boolean(update.output) && !toolInfo);
        if (isGenericOrResult && (lastActiveToolCall || Boolean(update.media))) {
          const rawContent = update.error || update.output || update.content || '';
          let outStr = typeof rawContent === 'string' ? rawContent : JSON.stringify(rawContent);
          const isError = Boolean(
            update.error ||
            update.status === 'ERROR' ||
            outStr.includes('"TOOL_ERROR"') ||
            outStr.includes('unexpected EOF') ||
            outStr.includes('Encountered error')
          );

          const rawMedia = update.media || (update.result && (update.result as any).media);
          if (Array.isArray(rawMedia) && rawMedia.length > 0) {
            for (const m of rawMedia) {
              if (m?.uri && typeof m.uri === 'string') {
                const isImg = !m.mime_type || m.mime_type.startsWith('image/');
                if (isImg) {
                  outStr += `\n\n![生成的图片](${m.uri})\n`;
                }
              }
            }
          }

          // 自动补全 Markdown 图片标签
          if (!outStr.includes('![') && /(?:[^\s"'<>\n]+\.(?:jpg|jpeg|png|webp|gif|svg))/i.test(outStr)) {
            const match = outStr.match(/(?:saved at|保存至|路径[:：]?\s*)?([^\s"'<>\n]+\.(?:jpg|jpeg|png|webp|gif|svg))/i);
            if (match && match[1]) {
              outStr += `\n\n![生成的图片](${match[1]})\n`;
            }
          }

          const targetToolId = lastActiveToolCall?.id || `call-step-${stepIdx}`;
          const targetToolName = lastActiveToolCall?.name || 'generate_image';

          ws.send(createNormalizedMessage({
            kind: 'tool_result',
            toolName: targetToolName,
            toolId: targetToolId,
            toolResult: { content: outStr, isError },
            content: outStr,
            sessionId: activeSession,
            provider: 'antigravity',
          }));
          lastActiveToolCall = null;
          return;
        }

        // Non-tool error steps (transient retry warnings, etc.) — do not stream as user messages
        if (stepType === 'error_message' || stepType === 'error') {
          return;
        }


        // Thought / reasoning
        const thought = update.thought || update.thinking;
        if (thought && typeof thought === 'string' && thought.trim()) {
          ws.send(createNormalizedMessage({
            kind: 'thinking',
            content: thought.trim(),
            sessionId: activeSession,
            provider: 'antigravity',
          }));
        }

        const scheduleSettleCheck = (delayMs: number = 3000) => {
          clearSettleTimer();
          if (isSettled || lastActiveToolCall) return;
          settleDebounceTimer = setTimeout(() => {
            if (isSettled || lastActiveToolCall) return;
            if (turnEmitted.trim().length > 0) {
              console.log(`[Antigravity Runtime] ✅ 文本生成完毕且已静默 ${delayMs}ms，安全触发回合完成结算交付...`);
              turnHasSucceeded = true;
              finishSuccess();
            }
          }, delayMs);
        };

        const isStepDone =
          update.state === 'DONE' ||
          update.status === 'DONE' ||
          update.state === 'COMPLETED' ||
          update.status === 'COMPLETED';

        // Text delta streaming with delta deduplication
        if (typeof update.text_delta === 'string' && update.text_delta) {
          const delta = update.text_delta;
          ws.send(createNormalizedMessage({
            kind: 'stream_delta',
            content: delta,
            text: delta,
            sessionId: activeSession,
            provider: 'antigravity',
          }));
          turnEmitted += delta;
          onTextDelta(delta);
          if (isStepDone) {
            scheduleSettleCheck(2000);
          } else {
            scheduleSettleCheck(4000);
          }
        } else if (
          (!stepType || stepType === 'agent_response' || stepType === 'planner_response') &&
          typeof update.content === 'string' &&
          update.content &&
          !update.tool_info
        ) {
          const content = update.content;
          if (content.startsWith(turnEmitted) && content.length > turnEmitted.length) {
            const delta = content.slice(turnEmitted.length);
            ws.send(createNormalizedMessage({
              kind: 'stream_delta',
              content: delta,
              text: delta,
              sessionId: activeSession,
              provider: 'antigravity',
            }));
            turnEmitted = content;
            onTextDelta(delta);
          } else if (!content.startsWith(turnEmitted) && content.length > 0) {
            ws.send(createNormalizedMessage({
              kind: 'stream_delta',
              content,
              text: content,
              sessionId: activeSession,
              provider: 'antigravity',
            }));
            turnEmitted += content;
            onTextDelta(content);
          }
          if (isStepDone) {
            scheduleSettleCheck(2000);
          } else {
            scheduleSettleCheck(4000);
          }
        } else if (isStepDone && (!stepType || stepType === 'agent_response' || stepType === 'planner_response') && turnEmitted.trim().length > 0) {
          scheduleSettleCheck(2000);
        }
        return;
      }

      // Handle 'result' or 'done' event
      if (obj.event === 'result' || obj.event === 'done') {
        const resObj = (obj.result as AnyRecord) || obj;
        const convId = resObj.conversation_id as string;
        if (convId) {
          turnConversationId = convId;
          onSessionDiscovered(convId);
        }

        if (resObj.usage) {
          turnUsage = resObj.usage as AnyRecord;
        }

        // Check full response in result payload
        if (typeof resObj.response === 'string' && resObj.response) {
          const full = resObj.response;
          if (full.startsWith(turnEmitted) && full.length > turnEmitted.length) {
            const delta = full.slice(turnEmitted.length);
            ws.send(createNormalizedMessage({
              kind: 'stream_delta',
              content: delta,
              text: delta,
              sessionId: activeSession,
              provider: 'antigravity',
            }));
            turnEmitted = full;
            onTextDelta(delta);
          }
        }

        if (resObj.status === 'ERROR' || resObj.error) {
          const errText = String(resObj.error || (typeof resObj.result === 'string' ? resObj.result : '') || 'Antigravity execution failed');
          lastStderrError = errText;
        } else {
          turnHasSucceeded = true;
          // Immediately resolve the turn without waiting for process exit cleanup (saves 2-3s delay)
          finishSuccess();
        }
      }
    };

    // Send user prompt via stdin
    if (prompt && antigravityProcess.stdin) {
      antigravityProcess.stdin.write(
        JSON.stringify({ event: 'user', message: { content: prompt } }) + '\n'
      );
    }

    // 动态看门狗超时：Boost 或深度模式下放宽到 600 秒（10分钟），普通对话放宽到 360 秒（6分钟）
    let lastActivityTime = Date.now();
    const isBoostMode = Boolean(
      (command && /^\/boost\b/i.test(command.trim())) ||
      (command && /\[🚀.*Boost/i.test(command))
    );
    const isLongRunningMode = Boolean(
      isBoostMode ||
      (command && /^\/(goal|plan|schedule)\b/i.test(command.trim())) ||
      effectiveEffort === 'high'
    );
    const INACTIVITY_TIMEOUT_MS = isLongRunningMode ? 600_000 : 360_000;

    watchdogTimer = setInterval(() => {
      if (isSettled) {
        if (watchdogTimer) {
          clearInterval(watchdogTimer);
          watchdogTimer = null;
        }
        return;
      }
      const idleMs = Date.now() - lastActivityTime;

      // 核心防假死兜底 1：若模型已输出完整回复且无活动工具，静止超过 12 秒直接圆满结算交付，绝不让前端挂在“计算中”！
      if (turnEmitted.trim().length > 0 && !lastActiveToolCall && idleMs > 12_000) {
        console.log(`[Antigravity Runtime] ✅ 模型已输出完整文本且处于静止状态超过 ${Math.round(idleMs / 1000)}s，主动圆满结算退出，解除前端悬挂...`);
        turnHasSucceeded = true;
        finishSuccess();
        return;
      }

      if (idleMs > INACTIVITY_TIMEOUT_MS) {
        if (watchdogTimer) {
          clearInterval(watchdogTimer);
          watchdogTimer = null;
        }
        // 核心防假死兜底 2：若达到超时上限但已输出了内容，作为成功收工交付
        if (turnEmitted.trim().length > 0) {
          console.log(`[Antigravity Runtime] 🚨 活跃看门狗到达上限，但模型已输出内容 (${turnEmitted.length} 字)，作为成功收工交付`);
          turnHasSucceeded = true;
          finishSuccess();
          return;
        }
        console.warn(`[Antigravity Runtime] 🚨 活跃看门狗触发: 连续 ${Math.round(idleMs / 1000)} 秒无输出且未生成任何内容，终止底层进程...`);
        lastStderrError = `stream timed out: no output produced after ${Math.round(INACTIVITY_TIMEOUT_MS / 1000)}s`;
        if (getProxyToggle() === 'yes') {
          try {
            exec('pkill -f "urnetwork/urnetwork-socks" 2>/dev/null || true');
          } catch (_) {}
        }
        try {
          antigravityProcess.kill('SIGTERM');
        } catch (_) {}
      }
    }, 3_000);

    const stdoutDecoder = new StringDecoder('utf8');
    antigravityProcess.stdout?.on('data', (chunk: Buffer) => {
      lastActivityTime = Date.now();
      stdoutLineBuffer += stdoutDecoder.write(chunk);
      const lines = stdoutLineBuffer.split(/\r?\n/);
      stdoutLineBuffer = lines.pop() || '';
      for (const line of lines) {
        processOutputLine(line.trim());
      }
    });

    antigravityProcess.stderr?.on('data', (chunk: Buffer) => {
      lastActivityTime = Date.now();
      const text = chunk.toString();
      console.error('[Antigravity CLI stderr]:', text);

      if (text.includes('ERROR') || text.includes('error') || text.includes('failed') || text.includes('RESOURCE_EXHAUSTED')) {
        lastStderrError = text.trim();
      }

      if (text.includes('RESOURCE_EXHAUSTED') || text.includes('Individual quota reached')) {
        const match = text.match(/Resets in ([^).]+)/i);
        const resetDuration = match ? match[1].trim() : '';
        const resetMsg = resetDuration ? `，将在约 ${resetDuration} 后自动恢复` : '';
        const activeEmail = antigravityAccountsService.getActiveEmail();
        const others = antigravityAccountsService.getOtherAvailableAccounts(activeEmail || '');
        let suggestion = '';
        if (others.length > 0) {
          suggestion = `。检测到已配置备用账号（如 ${others[0].email}），系统即将全自动无缝轮换继续推进`;
        } else {
          suggestion = '。系统即将自动启动智能退避自愈重试';
        }
        const errMsg = `⚠️ 当前账号（${activeEmail || '当前账号'}）的模型短期请求速率已达到 Google 上限 (RESOURCE_EXHAUSTED 429)${resetMsg}${suggestion}。`;
        quotaErrorDetails = { message: errMsg, resetMsg: resetDuration, rawText: text };
        try { antigravityProcess.kill('SIGTERM'); } catch (_) {}
      }

      // Check for P2P socks5 node drop / EOF: rotate urnetwork-socks if in proxy mode
      if (text.includes('EOF') || text.includes('unexpected EOF') || text.includes('stream ended') || text.includes('connection reset')) {
        const now = Date.now();
        if (getProxyToggle() === 'yes' && now - lastProxyRestartTime > 8000) {
          lastProxyRestartTime = now;
          console.warn('[Antigravity Runtime] Detected proxy EOF in stderr, triggering urnetwork-socks node rotation...');
          try {
            exec('pkill -f "urnetwork/urnetwork-socks" 2>/dev/null || true');
          } catch (_) {}
        }
      }
    });

    antigravityProcess.on('close', (code: number | null) => {
      if (watchdogTimer) {
        clearInterval(watchdogTimer);
        watchdogTimer = null;
      }
      if (isSettled) return;
      isSettled = true;
      abortSignal.removeEventListener('abort', onAbort);

      stdoutLineBuffer += stdoutDecoder.end();
      if (stdoutLineBuffer.trim()) {
        processOutputLine(stdoutLineBuffer.trim());
        stdoutLineBuffer = '';
      }

      if (quotaErrorDetails) {
        reject(new QuotaExhaustedError(quotaErrorDetails.message, quotaErrorDetails.resetMsg, quotaErrorDetails.rawText));
        return;
      }

      if (turnHasSucceeded || code === 0) {
        resolve({
          exitCode: 0,
          conversationId: turnConversationId,
          usage: turnUsage,
          spawnedSubagentsCount,
          lastAssistantContent: turnEmitted,
        });
        return;
      }

      const errToThrow = lastStderrError || `Antigravity CLI exited with code ${code}`;
      reject(new Error(errToThrow));
    });

    antigravityProcess.on('error', (err: Error) => {
      if (isSettled) return;
      isSettled = true;
      abortSignal.removeEventListener('abort', onAbort);
      reject(err);
    });
  });
}

/**
 * Orchestrates Antigravity CLI execution with outer auto-retry loop,
 * transparent self-healing for EOF and trajectory errors, and delta deduplication.
 */
export async function spawnAntigravity(
  command: string,
  options: AnyRecord = {},
  ws: ProviderRuntimeWriter,
  context: ProviderRuntimeContext
): Promise<unknown> {
  const {
    sessionId,
    projectPath,
    cwd,
    model,
    effort,
    sessionSummary,
    images,
    files,
    permissionMode,
    skipPermissions,
  } = options;

  const providerSessionId = context.resolveProviderSessionId(sessionId);
  const workingDir = cwd || projectPath || process.cwd();
  const processKey = sessionId || Date.now().toString();

  // Enforce Chinese reasoning rules in both global config and active project workspace
  ensureChineseRules(workingDir);

  let capturedSessionId = providerSessionId;
  let sessionCreatedSent = false;
  let accumulatedText = '';
  let terminalNotificationSent = false;
  const turnStartTime = Date.now();

  const abortController = new AbortController();
  activeAbortControllers.set(processKey, abortController);
  if (sessionId && sessionId !== processKey) {
    activeAbortControllers.set(sessionId, abortController);
  }

  // 触发 Scale-to-Zero 按需唤醒与活跃状态记录
  try {
    await notifyTurnStarted();
  } catch (wakeErr: any) {
    console.warn('[Scale-to-Zero] 代理唤醒自愈提示:', wakeErr?.message);
  }

  const registerSession = (nextSessionId: string) => {
    if (!nextSessionId || capturedSessionId === nextSessionId) return;
    capturedSessionId = nextSessionId;

    if (ws.setSessionId && typeof ws.setSessionId === 'function') {
      ws.setSessionId(capturedSessionId);
    }

    if (!providerSessionId && !sessionCreatedSent) {
      sessionCreatedSent = true;
      ws.send(createNormalizedMessage({
        kind: 'session_created',
        newSessionId: capturedSessionId,
        sessionId: capturedSessionId,
        provider: 'antigravity',
      }));
    }
  };

  const notifyTerminalState = ({ code = null, error = null }: { code?: number | null; error?: string | null } = {}) => {
    if (terminalNotificationSent) return;
    terminalNotificationSent = true;

    const finalSessionId = sessionId || capturedSessionId || processKey;
    if (code === 0 && !error) {
      notifyRunStopped({
        userId: ws?.userId || null,
        provider: 'antigravity',
        sessionId: finalSessionId,
        sessionName: sessionSummary,
        stopReason: 'completed',
      });
      return;
    }

    notifyRunFailed({
      userId: ws?.userId || null,
      provider: 'antigravity',
      sessionId: finalSessionId,
      sessionName: sessionSummary,
      error: error || `Antigravity CLI exited with code ${code}`,
    });
  };

  const cleanupProcessTracking = () => {
    activeAbortControllers.delete(processKey);
    activeAntigravityProcesses.delete(processKey);
    if (sessionId) {
      activeAbortControllers.delete(sessionId);
      activeAntigravityProcesses.delete(sessionId);
    }
    if (capturedSessionId) {
      activeAbortControllers.delete(capturedSessionId);
      activeAntigravityProcesses.delete(capturedSessionId);
    }
  };

  const MAX_RETRIES = 6;
  const EOF_EXTRA_RETRIES = 3;
  const QUOTA_EXTRA_RETRIES = 3;
  const TOTAL_MAX_ATTEMPTS = MAX_RETRIES + EOF_EXTRA_RETRIES + QUOTA_EXTRA_RETRIES; // 12

  let lastError = '';
  let finalResult: TurnAttemptResult | null = null;
  const exhaustedAccountsInTurn = new Set<string>();

  // Proactively ensure the active account's token is synchronized to disk and not expired
  try {
    await antigravityAccountsService.ensureActiveTokenFresh();
  } catch (err: any) {
    console.warn('[Antigravity Runtime] Pre-flight token sync warning:', err?.message);
  }

  let currentPrompt = command;

  try {
    for (let attempt = 1; attempt <= TOTAL_MAX_ATTEMPTS; attempt++) {
      if (abortController.signal.aborted) {
        throw new Error('context canceled');
      }

      try {
        const turnResult = await runAntigravityTurnOnce({
          command: currentPrompt,
          workingDir,
          model,
          effort,
          permissionMode,
          skipPermissions,
          images,
          files,
          capturedSessionId,
          accumulatedText,
          ws,
          currentSessionKey: capturedSessionId || sessionId || processKey,
          abortSignal: abortController.signal,
          onSessionDiscovered: (id: string) => {
            registerSession(id);
          },
          onTextDelta: (delta: string) => {
            accumulatedText += delta;
          },
          onFullText: (full: string) => {
            accumulatedText = full;
          },
          onProcessSpawned: (proc: ChildProcess) => {
            const key = capturedSessionId || sessionId || processKey;
            activeAntigravityProcesses.set(key, proc);
            if (sessionId && sessionId !== key) {
              activeAntigravityProcesses.set(sessionId, proc);
            }
          },
        });

        finalResult = turnResult;
        if (turnResult.conversationId) registerSession(turnResult.conversationId);
        break; // Turn completed successfully!
      } catch (err: any) {
        if (abortController.signal.aborted) throw err;

        // 核心终极防护：如果已经积累了模型回复文本，说明本轮核心回复已经完整输出交付给前端！
        // 无论底层发生任何末端断开、超时或关闭，坚决不得重试，更严禁重新注入“继续”导致重复生成！
        if (accumulatedText && accumulatedText.trim().length > 0) {
          console.log(`[Antigravity Runtime] ✅ 当前回合已成功产出完整回复 (${accumulatedText.trim().length} 字符)，虽有末端静默或关闭信号，直接圆满结算交付，绝不重复生成！`);
          break;
        }

        const errMsg = String(err?.message || err || '');
        lastError = errMsg;

        // 活跃看门狗超时：直接安全退出，坚决不进行网络重试更不发“继续”
        const isWatchdogTimeout = /watchdog|timed out|inactivity/i.test(errMsg);
        if (isWatchdogTimeout) {
          console.warn(`[Antigravity Runtime] 活跃看门狗静默超时，终止无谓重试并安全退出: ${errMsg}`);
          break;
        }

        if (err instanceof QuotaExhaustedError) {
          const currentSessionId = capturedSessionId || sessionId || null;
          console.warn(`[Antigravity Runtime] 🚨 触发 429 速率/配额限制 (回合尝试 ${attempt}/${TOTAL_MAX_ATTEMPTS})，保持当前账号启动智能时间退避自愈...`);

          // 保持当前账号不变，启动智能指数退避等待
          if (attempt < TOTAL_MAX_ATTEMPTS) {
            let waitSeconds = 15;
            const resetMatch = (err.resetTimeMsg || err.message || err.rawText || '').match(/(\d+(?:\.\d+)?)\s*(s|sec|seconds?)/i);
            if (resetMatch) {
              waitSeconds = Math.min(Math.ceil(parseFloat(resetMatch[1])) + 2, 60);
            } else {
              waitSeconds = Math.min(15 + (attempt - 1) * 10, 45);
            }

            console.warn(`[Antigravity Runtime] ⏳ 429 频控退避：保持当前账号，等待 ${waitSeconds} 秒后自动自愈续跑 (尝试 ${attempt}/${TOTAL_MAX_ATTEMPTS})...`);

            ws.send(createNormalizedMessage({
              kind: 'text',
              role: 'assistant',
              content: `⏳ **【429 速率限制智能退避】** 当前账号触发 Google API 短时频控限制，系统正在智能等待 **${waitSeconds} 秒** 后自动续跑，保持当前账号不变，请稍候无需操作...`,
              sessionId: currentSessionId,
              provider: 'antigravity',
            }));

            await new Promise((r) => setTimeout(r, waitSeconds * 1000));
            try {
              await antigravityAccountsService.ensureActiveTokenFresh();
            } catch (_) {}

            if (capturedSessionId) {
              currentPrompt = '继续';
            }
            continue;
          }

          // 重试耗尽后的兜底提示
          ws.send(createNormalizedMessage({
            kind: 'error',
            content: err.message,
            sessionId: currentSessionId,
            provider: 'antigravity',
          }));
          const completeMsg = createCompleteMessage({
            provider: 'antigravity',
            sessionId: currentSessionId,
            exitCode: 1,
          });
          ws.send(completeMsg);
          notifyTerminalState({ code: 1, error: err.message });
          cleanupProcessTracking();
          return { conversationId: capturedSessionId, exitCode: 1 };
        }

        // 1. Trajectory not found / conversation not found
        if (/trajectory not found|conversation not found/i.test(errMsg)) {
          console.warn(`[Antigravity Runtime] Trajectory ${capturedSessionId} not found, resetting conversationId and retrying turn fresh`);
          capturedSessionId = null;
          currentPrompt = command;
          continue;
        }

        // 2. Proactive auth refresh
        const isAuthErr = /authentication failed|token expired|invalid_grant|unauthorized/i.test(errMsg);
        if (isAuthErr && attempt < TOTAL_MAX_ATTEMPTS) {
          console.warn(`[Antigravity Runtime] Auth error detected on attempt ${attempt}, refreshing access token...`);
          try {
            await antigravityAccountsService.refreshAccessToken();
          } catch (_) {}
          await new Promise((r) => setTimeout(r, 1500));
          continue;
        }

        // 3. Stream Interrupted / Proxy EOF / Connection reset / Stream drop / Subscriber stalled / Google 403 WAF
        const isGoogleWaf403 = /code 403|Forbidden|robot\.png/i.test(errMsg);
        if (isGoogleWaf403 && attempt < TOTAL_MAX_ATTEMPTS) {
          console.warn(`[Antigravity Runtime] Google 403 WAF / IP block detected (attempt ${attempt}/${TOTAL_MAX_ATTEMPTS}), rotating proxy node and retrying...`);
          try {
            exec('pkill -f "urnetwork/urnetwork-socks" 2>/dev/null || true');
          } catch (_) {}
          await new Promise((r) => setTimeout(r, 5000));
          if (capturedSessionId) {
            currentPrompt = '继续';
          }
          continue;
        }

        const isStreamInterrupted = !isWatchdogTimeout && /stream was interrupted|please continue the task|subscriber fell behind updates|stalled for|interrupted before the response finished/i.test(errMsg);
        const isProxyEOF = !isWatchdogTimeout && /EOF|connection reset by peer|stream ended|unexpected EOF|stream was interrupted|please continue the task|subscriber fell behind updates|stalled for|interrupted before the response finished/i.test(errMsg);
        if (isProxyEOF && attempt < TOTAL_MAX_ATTEMPTS) {
          const isProxy = getProxyToggle() === 'yes';
          if (isStreamInterrupted) {
            console.warn(`[Antigravity Runtime] Stream interrupted / stalled (attempt ${attempt}/${TOTAL_MAX_ATTEMPTS}). Auto-resuming seamlessly with '继续'...`);
            if (capturedSessionId) {
              currentPrompt = '继续';
            }
          }
          if (isProxy) {
            if (attempt >= 2) {
              console.warn(`[Antigravity Runtime] EOF/Interrupted retry #${attempt}: restarting urnetwork-socks to rotate nodes...`);
              try {
                exec('pkill -f "urnetwork/urnetwork-socks" 2>/dev/null || true');
              } catch (_) {}
              await new Promise((r) => setTimeout(r, 4000));
            } else {
              console.warn(`[Antigravity Runtime] EOF/Interrupted retry #${attempt}: waiting 2s for recovery...`);
              await new Promise((r) => setTimeout(r, 2000));
            }
          } else {
            console.warn(`[Antigravity Runtime] Direct mode stream retry #${attempt}: waiting 2s...`);
            await new Promise((r) => setTimeout(r, 2000));
          }
          continue;
        }

        // 4. Transient network / TLS / DNS / Handshake / Eligibility check errors
        const isTransient = /retryable error|network issue|stream ended|unexpected EOF|context canceled|connection reset|Eligibility check failed|profile picture|i\/o timeout|timeout|dial tcp|connection refused|network is unreachable/i.test(errMsg);
        if (isTransient && attempt < TOTAL_MAX_ATTEMPTS) {
          console.warn(`[Antigravity Runtime] Transient network error (attempt ${attempt}/${TOTAL_MAX_ATTEMPTS}): ${errMsg.slice(0, 100)}, retrying...`);
          if (getProxyToggle() === 'yes' && attempt >= 2) {
            try {
              exec('pkill -f "urnetwork/urnetwork-socks" 2>/dev/null || true');
            } catch (_) {}
            await new Promise((r) => setTimeout(r, 4000));
          } else {
            await new Promise((r) => setTimeout(r, 2000));
          }
          continue;
        }

        // Non-retryable error
        throw err;
      }
    }

    if (!finalResult) {
      throw new Error(lastError || 'Antigravity CLI execution failed after all retry attempts');
    }

    // 🚀【长程攻坚推进控制】：
    // 1. 普通对话（用户未显式输入 /boost）：单轮执行完毕后立即圆满收工交付，严禁无故在后台自动循环接力生成；
    // 2. 只有当用户显式以 /boost 开头发起攻坚任务时，才进入受控的 Boost 阶段接力；
    // 3. 严格限制阶段上限（最多 2 阶段），且只要模型输出了交付汇报或完成总结，坚决立即终止退出，彻底杜绝死循环！
    const isBoostModeCommand = Boolean(command && /^\/boost\b/i.test(command.trim()));
    let autonomousStep = 0;
    const MAX_AUTONOMOUS_STEPS = 2; // Boost 模式下最多补充 2 次接力，杜绝无限空转

    if (isBoostModeCommand) {
      while (autonomousStep < MAX_AUTONOMOUS_STEPS) {
        if (abortController.signal.aborted) break;

        const outputText = (accumulatedText || '').trim();
        const lastContent = (finalResult?.lastAssistantContent || outputText).trim();

        // 只要输出了完成信号或交付总结，无论如何坚决立即退出，绝不再次唤醒
        const isExplicitlyFinished =
          /交付汇报|核查报告|已全部完成|全部任务已完成|修改与验证均已完成|全部目标已达成|测试全部通过|已成功为您实现|代码已编写完成并验证|所有任务均已闭环完成/i.test(lastContent);
        if (isExplicitlyFinished) {
          break;
        }

        // 只有模型明确输出未完结标志且字数极少（例如只输出了简短规划却没有任何工具执行），才进行下一阶段推进
        const hasUnfinishedIndicator =
          /(?:正在进行|准备开始执行|正在为您编写|待继续推进)/i.test(lastContent);
        if (!hasUnfinishedIndicator) {
          break;
        }

        autonomousStep++;
        console.log(`[Antigravity Runtime] 🚀 Boost 攻坚长程接力推进中 (第 ${autonomousStep}/${MAX_AUTONOMOUS_STEPS} 阶段)...`);

        ws.send(createNormalizedMessage({
          kind: 'text',
          role: 'assistant',
          content: `\n\n> 🚀 **【Boost 持续攻坚 · 第 ${autonomousStep} 阶段】** 检测到攻坚任务仍在演进中，系统正在自动接力执行下一步操作与验证...`,
          sessionId: capturedSessionId || sessionId || processKey,
          provider: 'antigravity',
        }));

        await new Promise((r) => setTimeout(r, 2000));

        const continuePrompt = '【Boost 攻坚指令】：请继续推进方案落地与代码验证，直到全部需求达成；若已完成，请直接输出最终交付总结。';

        try {
          const nextTurnResult = await runAntigravityTurnOnce({
            command: continuePrompt,
            workingDir,
            model,
            effort,
            permissionMode,
            skipPermissions,
            images,
            files,
            capturedSessionId,
            accumulatedText,
            ws,
            currentSessionKey: capturedSessionId || sessionId || processKey,
            abortSignal: abortController.signal,
            onSessionDiscovered: (id: string) => {
              registerSession(id);
            },
            onTextDelta: (delta: string) => {
              accumulatedText += delta;
            },
            onFullText: (full: string) => {
              accumulatedText = full;
            },
            onProcessSpawned: (proc: ChildProcess) => {
              const key = capturedSessionId || sessionId || processKey;
              activeAntigravityProcesses.set(key, proc);
              if (sessionId && sessionId !== key) {
                activeAntigravityProcesses.set(sessionId, proc);
              }
            },
          });

          finalResult = nextTurnResult;
          if (nextTurnResult.conversationId) registerSession(nextTurnResult.conversationId);
        } catch (stepErr: any) {
          console.warn('[Antigravity Runtime] Boost 推进遇到异常，进入安全结算:', stepErr?.message);
          break;
        }
      }
    }

    const durationSec = Math.round((Date.now() - turnStartTime) / 100) / 10;
    const cleanAcc = (accumulatedText || '').replace(/[\u200b\s]/g, '').trim();
    // Calculate per-turn tokens (avoid entire multi-turn trajectory history accumulating into a single deduction)
    const rawTurnTokens =
      (finalResult.usage as any)?.turn_tokens ||
      (finalResult.usage as any)?.output_tokens ||
      Math.max(1, Math.round(cleanAcc.length / 3.2));
    const tokens = Math.min(Math.max(rawTurnTokens, 200), 25000);
    const finalSessionId = capturedSessionId || sessionId || processKey;

    // 对话完成：获取真实上游配额缓存并异步触发实时刷新，绝不在本地虚假扣减
    const currentActiveEmail = antigravityAccountsService.getActiveEmail() || undefined;
    const fastQuota = antigravityAccountsService.getLiveQuotaCached(currentActiveEmail);
    void antigravityAccountsService.fetchLiveQuotaSummary(true, currentActiveEmail);
    const completeMessage = createCompleteMessage({
      provider: 'antigravity',
      sessionId: finalSessionId,
      exitCode: 0,
    });
    if (finalResult.usage) {
      (completeMessage as AnyRecord).usage = finalResult.usage;
    }
    if (fastQuota) {
      (completeMessage as AnyRecord).quotaSnapshot = fastQuota;
    }
    (completeMessage as AnyRecord).meta = {
      model,
      duration: durationSec,
      tokens,
      quotaSnapshot: fastQuota || undefined,
    };
    (completeMessage as AnyRecord).initialSessionId = sessionId || processKey;
    (completeMessage as AnyRecord).actualSessionId = finalSessionId;
    ws.send(completeMessage);

    notifyTerminalState({ code: 0 });
    cleanupProcessTracking();

    // 🚀【核心优化】对话完成后，在后台异步拉取最新 Google 额度，刷新完成后推送 quota_update
    void (async () => {
      try {
        const activeAccount = await antigravityAccountsService.getActiveAccount();
        const targetEmail = currentActiveEmail || activeAccount?.email || antigravityAccountsService.getActiveEmail() || undefined;
        const freshSnapshot = await antigravityAccountsService.fetchLiveQuotaSummary(true, targetEmail);
        if (freshSnapshot) {
          const snapshotWithModel = {
            ...freshSnapshot,
            model,
            tokens,
            duration: durationSec,
            updatedAt: Date.now(),
          };
          ws.send(createNormalizedMessage({
            kind: 'quota_update' as any,
            provider: 'antigravity',
            sessionId: finalSessionId,
            quotaSnapshot: snapshotWithModel,
          }));
        }
      } catch (e) {
        console.warn('[Antigravity Runtime] Background quota sync failed:', e);
      }
    })();

    return { conversationId: capturedSessionId, exitCode: 0 };
  } catch (err: any) {
    const finalSessionId = capturedSessionId || sessionId || processKey;
    const rawErrMsg = String(err?.message || lastError || 'Antigravity execution failed');

    // The CLI's own recoverable resume signal — "The stream was interrupted.
    // Please continue the task you were working on." — is not a failure: the
    // turn paused mid-stream and the next user message picks it back up. Only
    // this exact signal is softened; genuine failures (connection reset,
    // auth/token timeout, proxy EOF) stay fatal red errors below.
    const isRecoverableStreamPause = /stream was interrupted.*please continue|please continue the task|stream was interrupted|subscriber fell behind updates|stalled for|interrupted before the response finished/i.test(rawErrMsg);

    if (isRecoverableStreamPause) {
      if (!abortController.signal.aborted && capturedSessionId) {
        console.warn('[Antigravity Runtime] 捕获到流中断抖动，系统立即自动无缝发起自愈接力推进...');
        ws.send(createNormalizedMessage({
          kind: 'text',
          role: 'assistant',
          content: '\n\n> ⏳ **【链路自愈续接】** 检测到上游连接偶发抖动，系统正在全自动接力续跑推进未完任务，无需手动输入...',
          sessionId: finalSessionId,
          provider: 'antigravity',
        }));

        try {
          await new Promise((r) => setTimeout(r, 2500));
          const recoveryResult = await runAntigravityTurnOnce({
            command: '上游链路已平稳恢复，请继续完成上一轮操作。',
            workingDir,
            model,
            effort,
            permissionMode,
            skipPermissions,
            images,
            files,
            capturedSessionId,
            accumulatedText,
            ws,
            currentSessionKey: capturedSessionId || sessionId || processKey,
            abortSignal: abortController.signal,
            onSessionDiscovered: (id: string) => registerSession(id),
            onTextDelta: (delta: string) => { accumulatedText += delta; },
            onFullText: (full: string) => { accumulatedText = full; },
            onProcessSpawned: (proc: ChildProcess) => {
              const key = capturedSessionId || sessionId || processKey;
              activeAntigravityProcesses.set(key, proc);
            },
          });

          if (recoveryResult) {
            const durationSec = Math.round((Date.now() - turnStartTime) / 100) / 10;
            const cleanAcc = (accumulatedText || '').replace(/[\u200b\s]/g, '').trim();
            const tokens = Math.min(Math.max(Math.round(cleanAcc.length / 3.2), 200), 25000);
            const fastQuota = antigravityAccountsService.getLiveQuotaCached();
            void antigravityAccountsService.fetchLiveQuotaSummary(true);
            const completeMessage = createCompleteMessage({
              provider: 'antigravity',
              sessionId: finalSessionId,
              exitCode: 0,
            });
            if (fastQuota) (completeMessage as AnyRecord).quotaSnapshot = fastQuota;
            (completeMessage as AnyRecord).initialSessionId = sessionId || processKey;
            (completeMessage as AnyRecord).actualSessionId = finalSessionId;
            ws.send(completeMessage);
            notifyTerminalState({ code: 0 });
            cleanupProcessTracking();
            return { conversationId: capturedSessionId, exitCode: 0 };
          }
        } catch (recErr: any) {
          console.warn('[Antigravity Runtime] 自动续接回合遇到异常，进入安全兜底:', recErr?.message);
        }
      }

      if (!abortController.signal.aborted) {
        ws.send(createNormalizedMessage({
          kind: 'text',
          role: 'assistant',
          content: '上游连接发生抖动，已自动尝试多次续接。回复“继续”即可接着处理。',
          sessionId: finalSessionId,
          provider: 'antigravity',
        }));
      }
      const recoverableComplete = createCompleteMessage({
        provider: 'antigravity',
        sessionId: finalSessionId,
        exitCode: 0,
      });
      (recoverableComplete as AnyRecord).initialSessionId = sessionId || processKey;
      (recoverableComplete as AnyRecord).actualSessionId = finalSessionId;
      ws.send(recoverableComplete);
      notifyTerminalState({ code: 0 });
      cleanupProcessTracking();
      return { conversationId: capturedSessionId, exitCode: 0 };
    }

    const humanizedMsg = humanizeAntigravityError(rawErrMsg);

    if (!abortController.signal.aborted) {
      ws.send(createNormalizedMessage({
        kind: 'error',
        content: humanizedMsg,
        sessionId: finalSessionId,
        provider: 'antigravity',
      }));
    }

    const failureComplete = createCompleteMessage({
      provider: 'antigravity',
      sessionId: finalSessionId,
      exitCode: 1,
    });
    (failureComplete as AnyRecord).initialSessionId = sessionId || processKey;
    (failureComplete as AnyRecord).actualSessionId = finalSessionId;
    ws.send(failureComplete);

    notifyTerminalState({ code: 1, error: humanizedMsg });
    cleanupProcessTracking();
    throw err;
  } finally {
    notifyTurnEnded();
  }
}

export const antigravityRuntime: IProviderRuntime = {
  run(command: string, options: AnyRecord, writer: ProviderRuntimeWriter, context: ProviderRuntimeContext) {
    return spawnAntigravity(command, options, writer, context);
  },
  abort(sessionId: string): boolean {
    const controller = activeAbortControllers.get(sessionId);
    if (controller) {
      controller.abort();
    }
    const proc = activeAntigravityProcesses.get(sessionId);
    if (proc) {
      try { proc.kill('SIGTERM'); } catch (_) {}
      activeAntigravityProcesses.delete(sessionId);
      return true;
    }
    return Boolean(controller);
  },
};
