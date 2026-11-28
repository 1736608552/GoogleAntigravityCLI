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
import { resolveAntigravityBinary, resolveAntigravityStateDir } from './antigravity-auth.provider.js';
import {
  getProxyToggle,
  resolveAntigravityProxyEnv,
  notifyTurnStarted,
  notifyTurnEnded,
} from './antigravity-proxy.js';
import { antigravityAccountsService } from './antigravity-accounts.service.js';
import { localizeEnglishThought, humanizeAntigravityError } from './antigravity-chinese-filter.js';
import {
  createAntigravityPermissionGate,
  getAntigravityPendingApprovals,
  resolveAntigravityToolApproval,
} from './antigravity-permission-gate.js';
export { localizeEnglishThought, humanizeAntigravityError };

const spawnFunction = crossSpawn;
const activeAntigravityProcesses = new Map<string, ChildProcess>();
const activeAbortControllers = new Map<string, AbortController>();

type ManagedAntigravityProcess = {
  proc: ChildProcess;
  keys: Set<string>;
  spawnedAt: number;
};

const managedProcesses = new Set<ManagedAntigravityProcess>();
const processKeyIndex = new Map<string, ManagedAntigravityProcess>();

/**
 * 终结 Antigravity 子进程及其所有派生子进程树（Linux /proc 级联强杀）
 */
function terminateAntigravityProcess(proc: ChildProcess, forceImmediately = false): void {
  if (!proc || proc.killed || proc.exitCode !== null) return;
  const pid = proc.pid;
  if (!pid) return;

  const killEntireTree = (sig: NodeJS.Signals) => {
    try { process.kill(-pid, sig); } catch (_) {}
    try { proc.kill(sig); } catch (_) {}
    if (process.platform === 'linux') {
      try {
        for (const entry of fs.readdirSync('/proc')) {
          if (!/^\d+$/.test(entry)) continue;
          const childPid = Number(entry);
          if (childPid === pid || childPid === process.pid) continue;
          try {
            const rawStat: string = fs.readFileSync(`/proc/${childPid}/stat`, 'utf8');
            const statParts: string[] = rawStat.substring(rawStat.lastIndexOf(')') + 2).split(' ');
            const childPpid: number = Number(statParts[1]);
            if (childPpid === pid) {
              try { process.kill(childPid, sig); } catch (_) {}
            }
          } catch (_) {}
        }
      } catch (_) {}
    }
  };

  if (forceImmediately) {
    killEntireTree('SIGKILL');
  } else {
    killEntireTree('SIGTERM');
    const timer = setTimeout(() => {
      if (proc.exitCode === null && !proc.killed) {
        killEntireTree('SIGKILL');
      }
    }, 400);
    timer.unref();
  }
}

/**
 * 注册受管 Antigravity 进程，并自动监听 exit/close 事件在真正退出后释放
 */
function registerManagedProcess(initialKeys: string[], proc: ChildProcess): ManagedAntigravityProcess {
  let managed: ManagedAntigravityProcess | undefined;
  for (const m of managedProcesses) {
    if (m.proc === proc || (proc.pid && m.proc.pid === proc.pid)) {
      managed = m;
      break;
    }
  }

  if (!managed) {
    managed = {
      proc,
      keys: new Set(initialKeys.filter(Boolean)),
      spawnedAt: Date.now(),
    };
    managedProcesses.add(managed);

    const onExit = () => {
      if (!managed) return;
      for (const k of managed.keys) {
        processKeyIndex.delete(k);
        activeAntigravityProcesses.delete(k);
      }
      managedProcesses.delete(managed);
    };

    proc.once('exit', onExit);
    proc.once('close', onExit);
  } else {
    for (const k of initialKeys.filter(Boolean)) {
      managed.keys.add(k);
    }
  }

  for (const k of managed.keys) {
    processKeyIndex.set(k, managed);
    activeAntigravityProcesses.set(k, proc);
  }

  return managed;
}

/**
 * 将新的会话识别 ID（如真实 conversation_id）动态绑定到已有的受管活跃进程
 */
function bindSessionKeyToProcess(key: string, proc?: ChildProcess): void {
  if (!key) return;
  if (proc) {
    registerManagedProcess([key], proc);
    return;
  }
  for (const managed of managedProcesses) {
    if (!managed.proc.killed && managed.proc.exitCode === null) {
      managed.keys.add(key);
      processKeyIndex.set(key, managed);
      activeAntigravityProcesses.set(key, managed.proc);
    }
  }
}

/**
 * 根据任意 key（sessionId、conversationId、processKey 等）强力终止匹配的后台 Antigravity 进程
 */
function abortAntigravityProcessesByKey(key: string): boolean {
  if (!key) return false;
  let terminated = false;

  const controller = activeAbortControllers.get(key);
  if (controller) {
    controller.abort();
    activeAbortControllers.delete(key);
    terminated = true;
  }

  const managed = processKeyIndex.get(key);
  if (managed) {
    terminateAntigravityProcess(managed.proc, true);
    for (const k of managed.keys) {
      processKeyIndex.delete(k);
      activeAntigravityProcesses.delete(k);
    }
    managedProcesses.delete(managed);
    terminated = true;
  }

  const legacyProc = activeAntigravityProcesses.get(key);
  if (legacyProc && !legacyProc.killed && legacyProc.exitCode === null) {
    terminateAntigravityProcess(legacyProc, true);
    activeAntigravityProcesses.delete(key);
    terminated = true;
  }

  return terminated;
}

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

/**
 * Maps frontend permission modes to Antigravity CLI flags.
 * Exported for `server/modules/providers/tests/antigravity-runtime.test.ts`.
 */
export function resolveAntigravityPermissionArgs(permissionMode?: string, skipPermissions?: boolean): string[] {
  if (permissionMode === 'bypassPermissions' || permissionMode === 'auto') {
    return ['--dangerously-skip-permissions'];
  }
  switch (permissionMode) {
    case 'plan':
      // CLI `--mode plan` returns an empty 0-token response in non-interactive stream-json mode;
      // keep execution constrained via `--sandbox` paired with the Plan Mode runtime policy prompt.
      return ['--sandbox'];
    case 'accept-edits':
    case 'acceptEdits':
      return ['--mode', 'accept-edits', '--sandbox'];
    case 'sandbox':
      return ['--sandbox'];
    case 'default':
      return ['--sandbox'];
    default:
      return skipPermissions ? ['--dangerously-skip-permissions'] : ['--sandbox'];
  }
}

/**
 * Generates an explicit runtime permission policy prefix for restricted modes (`plan` and `default`)
 * so the non-interactive CLI enforces the promises shown in the UI permission selector.
 * Exported for `server/modules/providers/tests/antigravity-runtime.test.ts`.
 */
export function resolveAntigravityPermissionPolicy(
  permissionMode?: string,
  _skipPermissions?: boolean,
  _workingDir?: string,
): string {
  if (permissionMode === 'plan') {
    return `【🔒 权限策略：计划模式 (Plan Mode)】
当前会话处于只读规划模式，请仅使用只读工具查阅代码并输出方案。`;
  }

  // 默认受限模式 (default) 与 acceptEdits 均由 --sandbox 及 PreToolUse Hook 门卫在底层强制拦截与弹窗审批，
  // 不再向用户 prompt 拼接大段策略说明，避免污染聊天历史气泡。
  return '';
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

  // 关键修复：仅针对 Google 原生 gemini-* 模型剥离历史/档位后缀（如 gemini-4-hydrogen-xhigh -> gemini-4-hydrogen）
  // 严禁将三方模型 gpt-oss-120b-medium 截断为不存在的 gpt-oss-120b
  if (resolvedModel.startsWith('gemini-')) {
    const legacyMatch = resolvedModel.match(/^(.+)-(xhigh|high|medium|low|max)$/i);
    if (legacyMatch) {
      resolvedModel = legacyMatch[1];
      if (!resolvedEffort) {
        resolvedEffort = legacyMatch[2].toLowerCase();
      }
    }
  }

  // Antigravity CLI 规范：仅原生 gemini-* 模型支持并强制要求 --effort 参数 (low/medium/high/xhigh/max)
  // 严禁向所有三方模型（claude-opus-4-6-thinking、claude-sonnet-4-6、gpt-oss-120b-medium 等）传递 --effort，否则 CLI 立即报错拒绝启动
  const supportsEffort = resolvedModel.startsWith('gemini-');
  if (supportsEffort) {
    // 关键修复：Antigravity CLI 对所有 gemini-* 模型强制要求 --effort (low/medium/high/xhigh/max)
    // 如果前端未指定或传入了 'default' / 空值，默认设定为 'high' (深度思考)
    if (!resolvedEffort || !['low', 'medium', 'high', 'xhigh', 'max'].includes(resolvedEffort)) {
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

/** 教程块的边界标记。带上它才能在版本升级时原地替换，而不是无限追加。 */
const TUTORIAL_START_TAG = '<!-- antigravity-tutorial:start -->';
const TUTORIAL_END_TAG = '<!-- antigravity-tutorial:end -->';

/**
 * 给模型看的环境上手说明。
 *
 * 定位：这不是「规则」，是「说明书」。老版本写的是命令式条款（必须…严禁…），
 * 每一轮全量加载、还锁死推理语言，实测对复杂推理是净损失。
 * 这里改成陈述环境事实与协作约定：说清楚它在什么环境里跑、输出流向哪里、
 * 什么该做/什么不该做，让模型自己判断，而不是靠禁令压制。
 *
 * 体积控制在 2KB 以内——这份文件每一轮都会被完整读入上下文，越长越稀释真实需求。
 */
const AGENT_TUTORIAL_CONTENT = `# 运行环境说明

本文件由控制台维护，标记之间的内容会在版本升级时整体替换。

## 环境
你运行在 Antigravity CLI 中，由 Web 控制台通过 stream-json 驱动。你的正文、思考过程、每一次工具调用及其结果都会实时推送到网页，用户边跑边看——所以不必在结尾复述"我做了什么"，把结论和证据讲清楚即可。
会话历史落盘在 transcript.jsonl，重开同一会话能接上上下文，新会话则是全新上下文。工作目录即项目根目录，与你读写的文件是同一份文件系统。

## 协作约定
- 用简体中文回复，技术名词（Git、Docker、API、JSON 等）保留英文原词。
- 结论先行：先给判断和依据，再展开细节。不要用"我将要…"的计划陈述代替实际执行。
- 分别说清"已验证"与"推测"，不确定就说不确定。

## 工具使用
- 能查证的一律查证：文件内容、版本号、配置值、日志、进程状态都读原文，不凭记忆作答。
- 调用前用一句话说明目的；一次调用只做一件事。
- 改文件前先读；大文件按区间读取；删除、覆盖、重启服务等操作先说明影响范围。
- 被权限拦住时如实报告，不要假装成功。

## 出错时
先贴原始报错（保留英文原文），再给判断，并说明验证到哪一步。无法自行解决的环境问题（权限、属主、端口占用、外部服务不可达）直接说明卡在哪，给出下一步可执行的动作。

## 这个仓库
- 源码：\`webui/server\`（Express + WebSocket）、\`webui/src\`（React）
- 产物：\`webui/dist-server\`、\`webui/dist\`，两者都入库；改源码后必须重建并提交，否则线上跑的仍是旧逻辑
- 运行时文件（配置、日志、会话库）的属主可能不同于仓库代码，改动前先确认`;

/**
 * 历史遗留：曾经把「本轮思维推理必须全程使用中文」拼进每条 user message。
 * 已彻底移除——模型并不真正执行这类元指令，实际效果只是每轮稀释用户的真实需求，
 * 反而拉低复杂任务的准确率。输出语言改由教程文件里的协作约定承担。
 */

function backupOnce(filePath: string): void {
  const backupPath = `${filePath}.bak-agy-rules`;
  try {
    if (!fs.existsSync(backupPath)) fs.copyFileSync(filePath, backupPath);
  } catch (_) {}
}

/**
 * 清理历史版本洒在各处的规则文件。
 *
 * 只做两件事，绝不做模糊的整份切割：
 * 1. 摘掉「强制中文推理」这类反而拖后腿的小节（按 `## n.` 小节边界精确切）；
 * 2. 如果摘完已经一个二级小节都不剩，说明整份文件就是当年 writeFileSync 写下的模板，
 *    直接清空，省得每轮白加载几十行。
 *
 * 有用户自己写的内容就原样保留——线上那份 GEMINI.md 的一级标题也是本程序的旧模板，
 * 但标题下面挂着用户手写的业务协议，按标题吞会连用户内容一起删掉（已踩过一次）。
 */
const THINKING_RESTRICTION_LINE_RE =
  /^\s*-\s*.*(?:必须全程使用中文思考|严禁英文思考|严禁思维链使用英文|严禁在思考（thinking）阶段使用英文).*$/gm;

const LEGACY_TEMPLATE_TITLE_RE =
  /^#\s*(?:Antigravity 全局语言与思维规范|Language Policy)(?:$|\s|\()/i;

const LEGACY_SECTION_HEADING_RE =
  /^(?:\d+\.\s*)?(?:深度思考过程|回复与交互|语言与思考规范|19999\s*端口反重力专用隔离守则|零残留与即用即销守则)(?:$|\s|\()/;

/**
 * 判断文件是否仅由早期规则模板构成（不包含用户自定义协议或仓库指南）。
 */
function isLegacyTemplateOnly(content: string): boolean {
  const trimmed = content.trim();
  if (!trimmed) return false;
  const firstLine = trimmed.split('\n')[0] || '';
  if (!LEGACY_TEMPLATE_TITLE_RE.test(firstLine)) return false;

  const headings = [...trimmed.matchAll(/^##\s+(.+)$/gm)].map((m) => m[1].trim());
  if (headings.length === 0) {
    // 只有旧一级标题和套话导语、已无任何二级小节
    const bodyWithoutIntro = trimmed
      .replace(/^#.*$/gm, '')
      .replace(/^无论在任何场景.*$/gm, '')
      .trim();
    return bodyWithoutIntro.length === 0;
  }

  return headings.every((h) => LEGACY_SECTION_HEADING_RE.test(h));
}

/**
 * 移除混合文件中的“强制中文思考 / 严禁英文思考”条目；若所在小节清空则连同标题移除。
 */
function stripUnnumberedThinkingRestrictions(content: string): string {
  // 先处理 `## 语言与思考规范` 小节：仅删思考限制行，其余中文回复条目保留；整节为空则连标题一并摘除
  const policyHeadingMatch = content.match(/^##\s*语言与思考规范[^\n]*$/m);
  let next = content;
  if (policyHeadingMatch && policyHeadingMatch.index !== undefined) {
    const startIdx = policyHeadingMatch.index;
    const headerEnd = startIdx + policyHeadingMatch[0].length;
    const afterHeader = next.slice(headerEnd);
    const nextHeading = afterHeader.match(/^##\s+/m);
    const endIdx = nextHeading && nextHeading.index !== undefined ? headerEnd + nextHeading.index : next.length;
    const sectionBody = next.slice(headerEnd, endIdx).replace(THINKING_RESTRICTION_LINE_RE, '').trim();
    next = sectionBody
      ? `${next.slice(0, headerEnd)}\n\n${sectionBody}\n\n${next.slice(endIdx).replace(/^\n+/, '')}`
      : `${next.slice(0, startIdx)}${next.slice(endIdx)}`;
  }

  // 兜底移除散落的单行思考语言禁令
  next = next.replace(THINKING_RESTRICTION_LINE_RE, '');
  return next;
}

function pruneLegacyRuleFile(filePath: string): void {
  try {
    if (!fs.existsSync(filePath)) return;
    const before = fs.readFileSync(filePath, 'utf8');
    if (!before.trim()) return;

    pruneThinkingLanguageRules(filePath);

    const current = fs.readFileSync(filePath, 'utf8');
    if (!isLegacyTemplateOnly(current)) return;

    backupOnce(filePath);
    fs.writeFileSync(filePath, '', 'utf8');
    console.log('[Antigravity Runtime] 已清空历史规则模板文件:', filePath);
  } catch (err: any) {
    console.warn('[Antigravity Runtime] pruneLegacyRuleFile error:', err?.message);
  }
}

/**
 * 写入/更新环境说明块。
 * 用成对标记定位：版本升级时原地替换，不会重复追加（老实现只判断关键词，改一次就堆一次）。
 */
function upsertTutorialBlock(filePath: string): void {
  try {
    const block = `${TUTORIAL_START_TAG}\n${AGENT_TUTORIAL_CONTENT}\n${TUTORIAL_END_TAG}`;
    const current = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';

    const startIdx = current.indexOf(TUTORIAL_START_TAG);
    const endIdx = current.indexOf(TUTORIAL_END_TAG);
    const hasBlock = startIdx >= 0 && endIdx > startIdx;

    const next = hasBlock
      ? current.slice(0, startIdx) + block + current.slice(endIdx + TUTORIAL_END_TAG.length)
      : `${current.trimEnd()}${current.trim() ? '\n\n' : ''}${block}\n`;

    if (next === current) return;

    if (current.trim()) backupOnce(filePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, next, 'utf8');
    console.log(
      '[Antigravity Runtime] 已写入运行环境说明:',
      filePath,
      hasBlock ? '(替换旧版本)' : '(首次写入)',
    );
  } catch (err: any) {
    console.warn('[Antigravity Runtime] upsertTutorialBlock error:', err?.message);
  }
}



/**
 * 清理存量 GEMINI.md / AGENTS.md 里的「强制中文推理」小节。
 *
 * 为什么需要清：这两个文件每一轮都会被完整加载，而「必须全程使用中文思考 / 严禁英文思考」
 * 会把模型的内部推理语言锁死。实测对 Gemini 是净损失——英文语料的逻辑推演质量更高，
 * 锁死推理语言会明显拉低复杂推理与代码任务的准确率。输出语言要求不受影响，继续保留。
 *
 * 幂等：文件里没有该小节就直接返回；首次改动前备份为 <文件名>.bak-lang-prune。
 */
function pruneThinkingLanguageRules(filePath: string): void {
  try {
    if (!fs.existsSync(filePath)) return;
    const content = fs.readFileSync(filePath, 'utf8');
    let next = content;

    const startMarker = next.match(/^##\s*\d+\.\s*深度思考过程/m);
    if (startMarker && startMarker.index !== undefined) {
      const startIdx = startMarker.index;
      const afterStart = next.slice(startIdx + startMarker[0].length);
      const nextHeading = afterStart.match(/^##\s*\d+\.\s/m);
      const endIdx = nextHeading && nextHeading.index !== undefined
        ? startIdx + startMarker[0].length + nextHeading.index
        : next.length;

      next = next.slice(0, startIdx) + next.slice(endIdx);
      // 删掉一段后把后面的编号前移，避免出现 1、3、4 这种断号
      for (let n = 2; n <= 9; n += 1) {
        next = next.replace(new RegExp(`^## ${n}\\. `, 'gm'), `## ${n - 1}. `);
      }
    }

    next = stripUnnumberedThinkingRestrictions(next);
    if (next === content) return;

    next = next.trim() ? `${next.replace(/\n{3,}/g, '\n\n').trimEnd()}\n` : '';
    if (next === content) return;

    const backupPath = `${filePath}.bak-lang-prune`;
    if (!fs.existsSync(backupPath)) {
      fs.copyFileSync(filePath, backupPath);
    }

    fs.writeFileSync(filePath, next, 'utf8');
    console.log('[Antigravity Runtime] 已移除强制中文推理条款:', filePath);
  } catch (err: any) {
    console.warn('[Antigravity Runtime] pruneThinkingLanguageRules error:', err?.message);
  }
}

/**
 * Ensures the authoritative `~/.gemini/config/GEMINI.md` tutorial block stays up-to-date
 * and prunes legacy thinking-language restrictions or redundant template copies across home & workspace dirs.
 * Exported for `server/modules/providers/tests/antigravity-runtime.test.ts`.
 */
export function ensureAgentTutorial(options?: {
  homeDir?: string;
  workingDirs?: string[];
}): void {
  try {
    const homeDir = options?.homeDir ?? process.env.AGY_HOME ?? process.env.HOME ?? process.env.USERPROFILE;
    if (!homeDir) return;

    // 只认一个权威位置：CLI 启动时必然读取 ~/.gemini/config/GEMINI.md。
    // 老实现往多个目录各写一份，同一份说明被重复加载数倍，纯属自我稀释。
    const configDir = path.join(homeDir, '.gemini', 'config');
    const authorityFile = path.resolve(path.join(configDir, 'GEMINI.md'));

    const candidateDirs = new Set<string>();
    const rawWorkingDirs = options?.workingDirs ?? [process.cwd(), path.dirname(process.cwd())];
    for (const dir of rawWorkingDirs) {
      if (dir && typeof dir === 'string') candidateDirs.add(path.resolve(dir));
    }

    const legacyFileSet = new Set<string>([
      path.join(homeDir, 'GEMINI.md'),
      path.join(homeDir, 'AGENTS.md'),
      path.join(homeDir, '.gemini', 'GEMINI.md'),
      path.join(homeDir, '.gemini', 'AGENTS.md'),
      path.join(homeDir, '.gemini', 'config', 'AGENTS.md'),
      path.join(homeDir, '.gemini', 'antigravity-cli', 'GEMINI.md'),
      path.join(homeDir, '.gemini', 'antigravity-cli', 'AGENTS.md'),
    ]);

    for (const dir of candidateDirs) {
      legacyFileSet.add(path.join(dir, 'GEMINI.md'));
      legacyFileSet.add(path.join(dir, 'AGENTS.md'));
    }

    for (const rawFile of legacyFileSet) {
      const resolved = path.resolve(rawFile);
      if (resolved === authorityFile) continue;
      pruneLegacyRuleFile(resolved);
    }

    // 先摘掉「强制中文推理」这种拖后腿的条款（用户自己写的其余小节原样保留），再落新版说明
    pruneThinkingLanguageRules(authorityFile);
    upsertTutorialBlock(authorityFile);
  } catch (err: any) {
    console.warn('[Antigravity Runtime] ensureAgentTutorial error:', err?.message);
  }
}


type TurnAttemptParams = {
  command: string;
  workingDir: string;
  model?: string;
  effort?: string;
  permissionMode?: string;
  skipPermissions?: boolean;
  hookAddDir?: string;
  images?: unknown;
  files?: unknown;
  capturedSessionId: string | null;
  accumulatedText: string;
  ws: ProviderRuntimeWriter;
  currentSessionKey: string;
  /** 应用层稳定会话 id（前端实际使用的那个），用于生成与历史消息严格一致的确定性消息 id */
  appSessionId?: string;
  abortSignal: AbortSignal;
  onSessionDiscovered: (id: string) => void;
  onTextDelta: (delta: string) => void;
  onFullText: (full: string) => void;
  onProcessSpawned: (proc: ChildProcess) => void;
  spawnImpl?: typeof spawnFunction;
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



type TranscriptTailerHandle = { stop: () => void };

/**
 * 实时兜底跟随器：直接增量跟随 CLI 自己落盘的 transcript.jsonl。
 *
 * 为什么需要它：stream-json 的事件字段名在不同 CLI 版本间漂移
 * （thinking / thinking_delta / tool_name / tool_info 同时存在且位置不一致），
 * 而历史接口读的是 transcript.jsonl。两条路径读不同来源就会导致
 * “实时缺思考与工具卡、刷新一下才出现”。
 *
 * 这里让实时侧读与历史侧完全同源的数据，并用**确定性 id**
 * （thinking-<会话>-<step>、call-<会话>-<step>-<n>、res-<会话>-<step>）
 * 保证流式推送与历史消息是同一条消息，前端按 id 去重后不会重复。
 */
function startAntigravityTranscriptTailer(options: {
  sessionId: () => string;
  conversationId: () => string | null;
  isActive: () => boolean;
  emit: (message: unknown) => void;
  startFromBeginning: boolean;
}): TranscriptTailerHandle {
  const stateDir = resolveAntigravityStateDir();
  const pollIntervalMs = 600;

  let stopped = false;
  let currentPath: string | null = null;
  let offset = 0;
  let pendingBytes = Buffer.alloc(0);
  let lastToolIdByStep = new Map<number, string>();
  const emittedThinking = new Set<string>();

  const resolvePath = (conversationId: string): string =>
    path.join(stateDir, 'brain', conversationId, '.system_generated', 'logs', 'transcript.jsonl');

  const handleEntry = (rawLine: string) => {
    let entry: AnyRecord;
    try {
      entry = JSON.parse(rawLine);
    } catch {
      return;
    }
    if (!entry || typeof entry !== 'object') return;

    const stepIndex = Number(entry.step_index);
    if (!Number.isFinite(stepIndex)) return;
    const stepType = String(entry.type || '').toUpperCase();
    const sessionId = options.sessionId();

    if (stepType === 'USER_INPUT') {
      lastToolIdByStep = new Map();
      return;
    }

    if (stepType === 'PLANNER_RESPONSE' || stepType === 'AGENT_RESPONSE') {
      if (typeof entry.thinking === 'string' && entry.thinking.trim()) {
        const thinkingId = `thinking-${sessionId}-${stepIndex}`;
        // 同一 step 的思考只会随着流式增量变长，直接按 id 覆盖推送即可
        const thinkingText = entry.thinking.trim();
        if (!emittedThinking.has(`${thinkingId}\u0000${thinkingText}`)) {
          emittedThinking.add(`${thinkingId}\u0000${thinkingText}`);
          options.emit(createNormalizedMessage({
            id: thinkingId,
            kind: 'thinking',
            role: 'assistant',
            content: thinkingText,
            sessionId,
            provider: 'antigravity',
          }));
        }
      }

      const toolCalls = Array.isArray(entry.tool_calls) ? (entry.tool_calls as AnyRecord[]) : [];
      toolCalls.forEach((toolCall, index: number) => {
        const toolName = String(toolCall?.name || '').trim();
        if (!toolName) return;
        const toolId = `call-${sessionId}-${stepIndex}-${index}`;
        lastToolIdByStep.set(stepIndex, toolId);
        options.emit(createNormalizedMessage({
          id: toolId,
          kind: 'tool_use',
          role: 'assistant',
          toolName,
          toolInput: toolCall.args || toolCall.parameters || toolCall.input || {},
          toolId,
          sessionId,
          provider: 'antigravity',
        }));
      });
      return;
    }

    // GENERIC 步骤承载的是一次工具执行的实际输出
    if (stepType === 'GENERIC') {
      const rawMedia = Array.isArray(entry.media) ? (entry.media as AnyRecord[]) : [];
      const rawContent = entry.error || entry.content || '';
      if (!rawContent && rawMedia.length === 0) return;

      let outStr = typeof rawContent === 'string' ? rawContent : JSON.stringify(rawContent);
      for (const media of rawMedia) {
        if (media?.uri && typeof media.uri === 'string') {
          const isImage = !media.mime_type || String(media.mime_type).startsWith('image/');
          if (isImage) outStr += `\n\n![生成的图片](${media.uri})\n`;
        }
      }

      const isError = Boolean(entry.error) || entry.status === 'ERROR' || outStr.includes('TOOL_ERROR');
      options.emit(createNormalizedMessage({
        id: `res-${sessionId}-${stepIndex}`,
        kind: 'tool_result',
        role: 'assistant',
        toolId: lastToolIdByStep.get(stepIndex) || `call-${sessionId}-${stepIndex}-0`,
        toolResult: { content: outStr, isError },
        content: outStr,
        sessionId,
        provider: 'antigravity',
      }));
    }
  };

  const drain = () => {
    if (stopped) return;
    const conversationId = options.conversationId();
    if (!conversationId) return;

    const transcriptPath = resolvePath(conversationId);

    if (transcriptPath !== currentPath) {
      let initialSize = 0;
      try {
        if (!fs.existsSync(transcriptPath)) return;
        initialSize = fs.statSync(transcriptPath).size;
      } catch {
        return;
      }
      currentPath = transcriptPath;
      // 续跑老会话时从当前末尾开始跟，绝不把历史思考重推一遍；
      // 全新会话的文件是从本轮才开始写的，可以从头读。
      offset = options.startFromBeginning ? 0 : initialSize;
      pendingBytes = Buffer.alloc(0);
      if (offset >= initialSize) return;
    }

    let size = 0;
    try {
      size = fs.statSync(transcriptPath).size;
    } catch {
      return;
    }
    if (size < offset) {
      offset = 0;
      pendingBytes = Buffer.alloc(0);
    }
    if (size === offset) return;

    let chunk: Buffer;
    try {
      const fd = fs.openSync(transcriptPath, 'r');
      try {
        chunk = Buffer.alloc(size - offset);
        fs.readSync(fd, chunk, 0, chunk.length, offset);
      } finally {
        fs.closeSync(fd);
      }
    } catch {
      return;
    }

    offset += chunk.length;
    pendingBytes = Buffer.concat([pendingBytes, chunk]);

    // 只消费到最后一个换行，半行留在缓冲区，避免多字节字符被截断
    const lastNewline = pendingBytes.lastIndexOf(0x0a);
    if (lastNewline < 0) return;
    const complete = pendingBytes.subarray(0, lastNewline).toString('utf8');
    pendingBytes = pendingBytes.subarray(lastNewline + 1);

    for (const line of complete.split('\n')) {
      const trimmed = line.trim();
      if (trimmed) handleEntry(trimmed);
    }
  };

  const timer = setInterval(() => {
    if (stopped) return;
    if (!options.isActive()) {
      stop();
      return;
    }
    try {
      drain();
    } catch (error) {
      console.error('[Antigravity Runtime] transcript tailer failed:', error);
    }
  }, pollIntervalMs);
  timer.unref?.();

  function stop(): void {
    if (stopped) return;
    // 收尾时再读一次，保证回合结束前最后写入的思考与工具卡不丢
    try {
      drain();
    } catch {
      /* 收尾读取失败不影响结算 */
    }
    stopped = true;
    clearInterval(timer);
  }

  return { stop };
}

/**
 * Executes a single Antigravity CLI process turn.
 * Implements delta deduplication against `accumulatedText` so any re-generated text
 * from retries is smoothly deduplicated without emitting redundant tokens to the client.
 * Exported for `server/modules/providers/tests/antigravity-runtime.test.ts`.
 */
export function runAntigravityTurnOnce(params: TurnAttemptParams): Promise<TurnAttemptResult> {
  return new Promise(async (resolve, reject) => {
    const {
      command,
      workingDir,
      model,
      effort,
      permissionMode,
      skipPermissions,
      hookAddDir,
      images,
      files,
      capturedSessionId,
      accumulatedText,
      ws,
      currentSessionKey,
      appSessionId,
      abortSignal,
      onSessionDiscovered,
      onTextDelta,
      onFullText,
      onProcessSpawned,
      spawnImpl = spawnFunction,
    } = params;

    if (abortSignal.aborted) {
      reject(new Error('context canceled'));
      return;
    }

    // 每轮补齐运行环境说明（幂等：内容未变则不写盘）
    ensureAgentTutorial({
      workingDirs: workingDir ? [workingDir, path.dirname(workingDir)] : undefined,
    });

    const baseArgs = [
      '--input-format', 'stream-json',
      '--output-format', 'stream-json',
      // 默认传 '0'（依据 CLI --help：0 waits until the turn completes），避免长任务被 15m 短超时中途砍断
      '--print-timeout', process.env.AGY_PRINT_TIMEOUT || '0',
    ];

    const isBoostCommand = Boolean(command && /^\/boost\b/i.test(command.trim()));
    const effectiveEffort = isBoostCommand ? 'high' : effort;

    const { resolvedModel, resolvedEffort } = resolveAntigravityModelAndEffort(model, effectiveEffort);
    if (resolvedModel) {
      baseArgs.push('--model', resolvedModel);
    }

    if (resolvedEffort && ['low', 'medium', 'high', 'xhigh', 'max'].includes(resolvedEffort)) {
      baseArgs.push('--effort', resolvedEffort);
    }

    if (capturedSessionId) {
      baseArgs.push('--conversation', capturedSessionId);
    }

    const permArgs = resolveAntigravityPermissionArgs(permissionMode, skipPermissions);
    baseArgs.push(...permArgs);
    if (hookAddDir) {
      baseArgs.push('--add-dir', hookAddDir);
    }

    const BOOST_MODE_INSTRUCTION = `【🚀 Antigravity Boost 极致攻坚模式已激活】
你当前正处于 Boost 深度推演与高精度攻坚模式，请严格执行以下准则：
1. 【全链路自主推进】：针对用户需求进行全链路深度思考与多维度推演，全自主调度工具完成方案设计、代码编写、边界排查与自检验证，严禁只做一半就停止等待用户。
2. 【严格自检与零报错】：修改后必须主动使用运行命令、测试或静态检查工具验证成果，确保高质量无回归。
3. 【持续攻坚不中断】：若遇到中间工具报错或异常，必须自主反思并连续自愈推进，直到任务目标完全达成。`;

    let prompt = command || '';
    const permissionPolicy = resolveAntigravityPermissionPolicy(permissionMode, skipPermissions, workingDir);
    const hasPermissionPolicy = prompt.includes('【🔒 权限策略：') || prompt.includes('【🛡️ 权限策略：');
    const policyBlock = permissionPolicy && !hasPermissionPolicy ? `${permissionPolicy}\n\n` : '';

    if (prompt) {
      if (isBoostCommand) {
        if (prompt.startsWith('/')) {
          const firstLineEnd = prompt.indexOf('\n');
          if (firstLineEnd !== -1) {
            const firstLine = prompt.slice(0, firstLineEnd);
            const rest = prompt.slice(firstLineEnd + 1);
            prompt = `${firstLine}\n\n${BOOST_MODE_INSTRUCTION}\n\n${policyBlock}${rest}`;
          } else {
            prompt = `${prompt}\n\n${BOOST_MODE_INSTRUCTION}\n\n${policyBlock}`;
          }
        } else {
          prompt = `${BOOST_MODE_INSTRUCTION}\n\n${policyBlock}${prompt}`;
        }
      } else if (policyBlock) {
        prompt = `${policyBlock}${prompt}`;
      }
    }
    const hasAttachments =
      normalizeAttachmentDescriptors(images).length > 0 ||
      normalizeAttachmentDescriptors(files).length > 0;
    if (hasAttachments) {
      prompt = appendFilesInputTag(appendImagesInputTag(prompt, images), files);
    }

    const binPath = resolveAntigravityBinary();
    const childEnv = await resolveAntigravityProxyEnv({
      ...process.env,
      HOME: process.env.AGY_HOME || process.env.HOME,
    });

    // 关键自愈优化：单会话单实例保障，启动新轮次前先强制终结同会话的历史残留孤儿进程
    const targetCandidateKeys = [capturedSessionId, currentSessionKey].filter(Boolean) as string[];
    for (const key of targetCandidateKeys) {
      try {
        const managed = processKeyIndex.get(key);
        if (managed && !managed.proc.killed && managed.proc.exitCode === null) {
          terminateAntigravityProcess(managed.proc, true);
        }
        const oldProc = activeAntigravityProcesses.get(key);
        if (oldProc && !oldProc.killed && oldProc.exitCode === null) {
          terminateAntigravityProcess(oldProc, true);
        }
        if (key.length > 5) {
          try {
            execFileSync('pkill', ['-9', '-f', '--', `conversation ${key}`]);
          } catch (_) {}
          try {
            execFileSync('pkill', ['-9', '-f', '--', `--conversation ${key}`]);
          } catch (_) {}
        }
      } catch (_) {}
    }

    let antigravityProcess: ChildProcess;
    try {
      antigravityProcess = spawnImpl(binPath, baseArgs, {
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
    let turnConversationId = capturedSessionId;
    let turnUsage: AnyRecord | undefined = undefined;
    let spawnedSubagentsCount = 0;

    // 思考 / 工具卡实时兜底：跟随 CLI 自己落盘的 transcript.jsonl 增量。
    // 该文件与历史接口同源，不受 stream-json 字段漂移影响，因此思考与工具卡
    // 无需手动刷新即可出现；消息 id 与历史解析器一致，刷新后不会重复。
    const transcriptTailer = startAntigravityTranscriptTailer({
      sessionId: () => activeSessionId,
      conversationId: () => turnConversationId || null,
      isActive: () => !isSettled,
      emit: (message) => ws.send(message),
      // 续跑老会话时从文件末尾开始跟，避免把历史思考重推一遍
      startFromBeginning: !capturedSessionId,
    });

    const onAbort = () => {
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
      transcriptTailer.stop();

      if (watchdogTimer) {
        clearInterval(watchdogTimer);
        watchdogTimer = null;
      }

      // 回合已收到 CLI 明确发出的 result/done 结算信号后，延迟优雅结束 stdin 引导进程自然退出，
      // 避免遗留进程在下轮对话被 pkill -9 强杀而触发 `[Notice] ... due to server restart` 误报。
      const gracefulEndTimer = setTimeout(() => {
        try {
          if (antigravityProcess.stdin && !antigravityProcess.stdin.destroyed && !antigravityProcess.stdin.writableEnded) {
            antigravityProcess.stdin.end();
          }
        } catch (_) {}
      }, 1500);
      gracefulEndTimer.unref?.();

      const gracefulTermTimer = setTimeout(() => {
        if (!antigravityProcess.killed && antigravityProcess.exitCode === null) {
          terminateAntigravityProcess(antigravityProcess, false);
        }
      }, 4500);
      gracefulTermTimer.unref?.();

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
    const accumulatedThoughtsByStep = new Map<number, string>();
    const lastEmittedThoughtByStep = new Map<number, string>();
    // 消息 id 必须基于前端使用的稳定应用会话 id，才能和历史解析器生成同一条消息
    const activeSessionId = appSessionId || currentSessionKey;

    const processOutputLine = (line: string, allowAfterSettled = false) => {
      if ((!allowAfterSettled && isSettled) || !line || !line.trim()) return;

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
        // 转发到前端（同文本 30 秒去重），让用户看到卡住的原因而不是无限干等
        const nowTs = Date.now();
        if (errText && (errText !== lastForwardedErrorText || nowTs - lastForwardedErrorTime > 30_000)) {
          lastForwardedErrorText = errText;
          lastForwardedErrorTime = nowTs;
          try {
            ws.send(createNormalizedMessage({
              id: `cli-error-${activeSession}-${nowTs}`,
              kind: 'error',
              role: 'assistant',
              content: `⚠️ CLI 上游错误: ${errText}`,
              sessionId: activeSession,
              provider: 'antigravity',
            }));
          } catch (_) {}
        }
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

        // Thought / reasoning（置于 tool_info 之前，确保带工具调用的步骤也能实时推送思考内容）
        // 字段名按 CLI 实际协议做多路兼容：thinking / thought / reasoning 为全量，
        // thinking_delta / thought_delta / reasoning_delta 为增量；thinking 步骤的 content 也是思考正文。
        const stepNumber = Number(stepIdx);
        const stepKey = Number.isFinite(stepNumber) ? stepNumber : turnStepCounter;
        const isThinkingStep = stepType.includes('think') || stepType.includes('reason');
        const thoughtDelta = String(
          update.thinking_delta || update.thought_delta || update.reasoning_delta || '',
        );
        const fullThought = update.thinking || update.thought || update.reasoning || '';
        const thoughtFromContent = isThinkingStep ? (update.content || update.text || '') : '';

        let mergedThought = '';
        const previousThought = accumulatedThoughtsByStep.get(stepKey) || '';
        if (typeof fullThought === 'string' && fullThought.trim()) {
          // thinking 是全量文本：随流式推进变长，直接以最新一次为准
          mergedThought = fullThought.trim();
        } else if (thoughtDelta) {
          mergedThought = previousThought + thoughtDelta;
        } else if (typeof thoughtFromContent === 'string' && thoughtFromContent.trim()) {
          mergedThought = thoughtFromContent.trim();
        }
        if (mergedThought.trim()) {
          accumulatedThoughtsByStep.set(stepKey, mergedThought);
          if (lastEmittedThoughtByStep.get(stepKey) !== mergedThought) {
            lastEmittedThoughtByStep.set(stepKey, mergedThought);
            ws.send(createNormalizedMessage({
              id: `thinking-${activeSessionId}-${stepKey}`,
              kind: 'thinking',
              role: 'assistant',
              content: mergedThought,
              sessionId: activeSession,
              provider: 'antigravity',
            }));
          }
        }

        // Tool calls and tool execution results
        // CLI 协议里工具名有两条来源：与 tool_info 同级的 tool_name，以及 tool_info.name；
        // 另有把整批调用放进 tool_calls[] 的版本。这里全部兼容，避免工具卡在实时流里整段丢失。
        const toolInfo = (update.tool_info || update.toolInfo) as AnyRecord | undefined;
        const inlineToolCalls = Array.isArray(update.tool_calls)
          ? (update.tool_calls as AnyRecord[])
          : (Array.isArray(toolInfo?.tool_calls) ? (toolInfo?.tool_calls as AnyRecord[]) : []);
        const singleToolName = String(
          toolInfo?.name
          || toolInfo?.tool_name
          || update.tool_name
          || update.toolName
          || '',
        ).trim();

        // 实质进展标记：思考 / 正文 / 工具任一有效载荷都刷新停滞时钟。
        // error / retry 类步骤不算 —— 上游挂死时 CLI 会反复吐重试警告事件，
        // 若这些也算进展，看门狗会被无限续命（表现为「超时一直干等」）。
        if (!stepType.includes('error')) {
          const hasSubstantivePayload = Boolean(
            update.text_delta ||
            (typeof update.content === 'string' && update.content) ||
            (typeof fullThought === 'string' && fullThought) ||
            thoughtDelta ||
            toolInfo ||
            (Array.isArray(inlineToolCalls) && inlineToolCalls.length > 0) ||
            singleToolName ||
            update.tool_result ||
            update.toolResult,
          );
          if (hasSubstantivePayload) {
            lastProgressTime = Date.now();
          }
        }

        const toolCallList: Array<{ name: string; input: unknown; id: string }> = [];
        if (singleToolName) {
          toolCallList.push({
            name: singleToolName,
            input: toolInfo?.parameters || toolInfo?.args || toolInfo?.input || toolInfo?.arguments
              || update.parameters || update.args || {},
            // 确定性 id：与历史解析器完全一致，刷新前后的工具卡是同一条消息
            id: `call-${activeSessionId}-${stepKey}-0`,
          });
        } else if (inlineToolCalls.length > 0) {
          inlineToolCalls.forEach((toolCall, index) => {
            const name = String(toolCall?.name || toolCall?.tool_name || '').trim();
            if (!name) return;
            toolCallList.push({
              name,
              input: toolCall.args || toolCall.parameters || toolCall.input || toolCall.arguments || {},
              id: `call-${activeSessionId}-${stepKey}-${index}`,
            });
          });
        }

        let emittedToolThisStep = false;
        for (const toolCall of toolCallList) {
          if (toolCall.name === 'invoke_subagent' || toolCall.name === 'manage_subagents' || toolCall.name === 'define_subagent') {
            spawnedSubagentsCount++;
          }

          let parsedInput: unknown = toolCall.input;
          if (typeof parsedInput === 'string') {
            try { parsedInput = JSON.parse(parsedInput); } catch (_) { /* 保留原始字符串 */ }
          }

          lastActiveToolCall = { id: toolCall.id, name: toolCall.name };
          emittedToolThisStep = true;

          if (!seenToolCallIds.has(toolCall.id)) {
            seenToolCallIds.add(toolCall.id);
            ws.send(createNormalizedMessage({
              id: toolCall.id,
              kind: 'tool_use',
              role: 'assistant',
              toolName: toolCall.name,
              toolInput: parsedInput,
              toolId: toolCall.id,
              sessionId: activeSession,
              provider: 'antigravity',
            }));
          }

          const toolOutputRaw = toolInfo?.output
            ?? update.output
            ?? (update.result as AnyRecord | undefined)?.output
            ?? '';
          const toolError = toolInfo?.error || update.error;
          const toolMedia = update.media
            || toolInfo?.media
            || (update.result as AnyRecord | undefined)?.media;

          if (
            (toolOutputRaw !== '' && toolOutputRaw !== undefined && toolOutputRaw !== null)
            || toolError
            || update.status === 'ERROR'
            || toolMedia
          ) {
            const isError = Boolean(toolError || update.status === 'ERROR');
            const rawContent = toolError || toolOutputRaw || '';
            let outStr = typeof rawContent === 'string' ? rawContent : JSON.stringify(rawContent);

            // 实时提取底层返回的媒体图片并在聊天框展示
            if (Array.isArray(toolMedia) && toolMedia.length > 0) {
              for (const m of toolMedia) {
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
              id: `res-${activeSessionId}-${stepKey}-${toolCall.id}`,
              kind: 'tool_result',
              toolName: toolCall.name,
              toolId: toolCall.id,
              toolResult: { content: outStr, isError },
              content: outStr,
              sessionId: activeSession,
              provider: 'antigravity',
            }));
            lastActiveToolCall = null;
          }
        }

        // 核心修复：处理独立工具执行结果（如生图完成事件 step_type === 'generic' 或包含 media）
        const isGenericOrResult = stepType === 'generic' || stepType === 'step_result' || Boolean(update.media) || (Boolean(update.output) && !toolInfo);
        if (isGenericOrResult && !emittedToolThisStep && (lastActiveToolCall || Boolean(update.media))) {
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

          const targetToolId = lastActiveToolCall?.id || `call-${activeSessionId}-${stepKey}-0`;
          const targetToolName = lastActiveToolCall?.name || 'generate_image';

          ws.send(createNormalizedMessage({
            id: `res-${activeSessionId}-${stepKey}-${targetToolId}`,
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

        // Non-tool error steps (transient retry warnings, etc.) — do not stream as user messages.
        // 但要转发为独立的错误提示行（同文本 30 秒去重）：上游卡住/反复重试时
        // 用户需要看到原因，而不是看着转圈无限干等。
        if (stepType === 'error_message' || stepType === 'error') {
          const forwardText = String(update.content || update.error || errText || '').trim();
          if (forwardText) {
            const nowTs = Date.now();
            if (forwardText !== lastForwardedErrorText || nowTs - lastForwardedErrorTime > 30_000) {
              lastForwardedErrorText = forwardText;
              lastForwardedErrorTime = nowTs;
              try {
                ws.send(createNormalizedMessage({
                  id: `cli-error-${activeSession}-${nowTs}`,
                  kind: 'error',
                  role: 'assistant',
                  content: `⚠️ 模型侧暂态错误（自动重试中）: ${forwardText}`,
                  sessionId: activeSession,
                  provider: 'antigravity',
                }));
              } catch (_) {}
            }
          }
          return;
        }


        // Text delta streaming with delta deduplication
        // 注意：绝不在阶段性文本输出后通过短时静默定时器提前结算，
        // 因为 CLI 在等待子代理、schedule 定时器或后台命令唤醒期间不会发送 result 事件。
        // 回合完结严格以 CLI 明确发出的 `result` / `done` 事件、进程退出或长程看门狗为准。
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
        } else if (
          // 注意：同一 step 里 CLI 会把「思考 + 正文 + 工具调用」打包在一起，
          // 因此这里绝不能再以「带 tool_info 就跳过正文」为条件，否则正文永远不实时。
          (!stepType || stepType === 'agent_response' || stepType === 'planner_response') &&
          typeof update.content === 'string' &&
          update.content
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
        }
        return;
      }

      // Handle 'result' or 'done' event
      if (obj.event === 'result' || obj.event === 'done') {
        const resObj = (obj.result as AnyRecord) || obj;
        lastProgressTime = Date.now();
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

    // 动态看门狗超时：Boost、深度思考或已派发子代理的长程模式下放宽到 600 秒（10分钟），普通对话放宽到 360 秒（6分钟）
    let lastActivityTime = Date.now();
    // 实质进展时间：仅由思考/正文/工具调用/result 等有效载荷刷新。
    // 诊断日志、重试警告、stderr 噪声不算进展 —— 否则上游挂死但 CLI 持续吐
    // 重试警告时看门狗会被无限续命（正是「超时一直干等」的根因）。
    let lastProgressTime = Date.now();
    let lastForwardedErrorText = '';
    let lastForwardedErrorTime = 0;
    const isBoostMode = Boolean(
      (command && /^\/boost\b/i.test(command.trim())) ||
      (command && /\[🚀.*Boost/i.test(command))
    );
    const isBaseLongRunningMode = Boolean(
      isBoostMode ||
      (command && /^\/(goal|plan|schedule)\b/i.test(command.trim())) ||
      effectiveEffort === 'high' ||
      effectiveEffort === 'xhigh' ||
      effectiveEffort === 'max'
    );

    watchdogTimer = setInterval(() => {
      if (isSettled) {
        if (watchdogTimer) {
          clearInterval(watchdogTimer);
          watchdogTimer = null;
        }
        return;
      }
      const nowMs = Date.now();
      const silentMs = nowMs - lastActivityTime;   // 字节级静默（stdout/stderr 全无输出）
      const stalledMs = nowMs - lastProgressTime;  // 实质进展停滞（可能仍在反复吐重试警告）
      const inactivityTimeoutMs =
        (isBaseLongRunningMode || spawnedSubagentsCount > 0 || lastActiveToolCall !== null)
          ? 1_800_000
          : 600_000;

      if (silentMs > inactivityTimeoutMs || stalledMs > inactivityTimeoutMs) {
        if (watchdogTimer) {
          clearInterval(watchdogTimer);
          watchdogTimer = null;
        }
        const timeoutSeconds = Math.round(Math.max(silentMs, stalledMs) / 1000);
        if (turnEmitted.trim().length > 0) {
          console.warn(`[Antigravity Runtime] 🚨 活跃看门狗到达上限 (${Math.round(inactivityTimeoutMs / 1000)}s)，中止卡滞进程并转为可恢复暂停 (${turnEmitted.length} 字)`);
          lastStderrError = `stream was interrupted before the response finished (stalled for ${timeoutSeconds}s)`;
        } else {
          console.warn(`[Antigravity Runtime] 🚨 活跃看门狗触发: 连续 ${timeoutSeconds} 秒无实质进展且未生成任何内容，终止底层进程...`);
          lastStderrError = `stream timed out: no substantive output after ${Math.round(inactivityTimeoutMs / 1000)}s`;
        }
        if (getProxyToggle() === 'yes') {
          try {
            exec('pkill -f "urnetwork/urnetwork-socks" 2>/dev/null || true');
          } catch (_) {}
        }
        terminateAntigravityProcess(antigravityProcess, false);
      }
    }, 3_000);
    watchdogTimer.unref?.();

    const stdoutDecoder = new StringDecoder('utf8');
    antigravityProcess.stdout?.on('data', (chunk: Buffer) => {
      if (isSettled) return;
      lastActivityTime = Date.now();
      stdoutLineBuffer += stdoutDecoder.write(chunk);
      const lines = stdoutLineBuffer.split(/\r?\n/);
      stdoutLineBuffer = lines.pop() || '';
      for (const line of lines) {
        if (isSettled) break;
        processOutputLine(line.trim());
      }
    });

    antigravityProcess.stderr?.on('data', (chunk: Buffer) => {
      if (isSettled) return;
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

      // 检测网络流异常，仅记录诊断日志，严禁在流传输中途暴力 kill 代理进程（避免导致全部会话雪崩断流）
      if (text.includes('EOF') || text.includes('unexpected EOF') || text.includes('stream ended') || text.includes('connection reset')) {
        const now = Date.now();
        if (now - lastProxyRestartTime > 8000) {
          lastProxyRestartTime = now;
          console.warn('[Antigravity Runtime] 上游流式传输捕获到网络波动或 EOF 断开信号');
        }
      }
    });

    antigravityProcess.on('close', (code: number | null) => {
      if (watchdogTimer) {
        clearInterval(watchdogTimer);
        watchdogTimer = null;
      }
      if (isSettled) return;

      stdoutLineBuffer += stdoutDecoder.end();
      if (stdoutLineBuffer.trim()) {
        processOutputLine(stdoutLineBuffer.trim(), true);
        stdoutLineBuffer = '';
      }

      if (isSettled) return;
      isSettled = true;
      abortSignal.removeEventListener('abort', onAbort);
      transcriptTailer.stop();

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
      transcriptTailer.stop();
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
    toolsSettings,
  } = options;

  const providerSessionId = context.resolveProviderSessionId(sessionId);
  const workingDir = cwd || projectPath || process.cwd();
  const processKey = sessionId || Date.now().toString();

  // 每轮补齐运行环境说明（幂等：内容未变则不写盘）
  ensureAgentTutorial({
    workingDirs: workingDir ? [workingDir, path.dirname(workingDir)] : undefined,
  });

  let capturedSessionId = providerSessionId;
  let sessionCreatedSent = false;
  let accumulatedText = '';
  let terminalNotificationSent = false;
  const turnStartTime = Date.now();

  let currentTurnProc: ChildProcess | undefined;
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

    // 动态将捕获到的 conversationId 绑定到当前受管进程
    if (currentTurnProc) {
      bindSessionKeyToProcess(capturedSessionId, currentTurnProc);
    } else {
      bindSessionKeyToProcess(capturedSessionId);
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
    // 仅清理单轮次的局部 abortController
    activeAbortControllers.delete(processKey);
    if (sessionId) {
      activeAbortControllers.delete(sessionId);
    }
    if (capturedSessionId) {
      activeAbortControllers.delete(capturedSessionId);
    }
    // 核心根治：严禁在此处 delete activeAntigravityProcesses 或 processKeyIndex！
    // 存活中的 ChildProcess 必须由 ManagedProcessRegistry 持续持有，
    // 直至进程自身 exit、或用户在前端删除会话时调用 abort 精准销毁！
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
  const permissionGate = createAntigravityPermissionGate({
    permissionMode,
    skipPermissions,
    workingDir,
    sessionId,
    getActiveSessionId: () => capturedSessionId || sessionId || processKey,
    sessionSummary,
    writer: ws,
    abortSignal: abortController.signal,
    toolsSettings: toolsSettings as { allowedTools?: string[]; disallowedTools?: string[] } | undefined,
  });

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
          hookAddDir: permissionGate?.hookAddDir,
          images,
          files,
          capturedSessionId,
          accumulatedText,
          ws,
          currentSessionKey: capturedSessionId || sessionId || processKey,
          appSessionId: sessionId || processKey,
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
            currentTurnProc = proc;
            const keys = [capturedSessionId, sessionId, processKey].filter(Boolean) as string[];
            registerManagedProcess(keys, proc);
          },
        });

        finalResult = turnResult;
        if (turnResult.conversationId) registerSession(turnResult.conversationId);
        break; // Turn completed successfully!
      } catch (err: any) {
        if (abortController.signal.aborted) throw err;

        const errMsg = String(err?.message || err || '');
        lastError = errMsg;

        // 活跃看门狗超时：若已输出部分内容则转为明确的可恢复暂停通知，绝不伪装成功也不自动重复生成
        const isWatchdogTimeout = /watchdog|timed out|inactivity|stalled for/i.test(errMsg);
        if (isWatchdogTimeout) {
          console.warn(`[Antigravity Runtime] 活跃看门狗静默超时，终止重试并交由上层处理: ${errMsg}`);
          if (accumulatedText && accumulatedText.trim().length > 0) {
            throw new Error(`stream was interrupted before the response finished (${errMsg})`);
          }
          throw err;
        }

        if (err instanceof QuotaExhaustedError) {
          const currentSessionId = capturedSessionId || sessionId || null;
          const rawInfo = `${err.resetTimeMsg || ''} ${err.message || ''} ${err.rawText || ''}`;
          const resetMatch = rawInfo.match(/(\d+(?:\.\d+)?)\s*(s|sec|seconds?)\b/i);
          const isShortRateLimit = resetMatch !== null && parseFloat(resetMatch[1]) <= 60;

          if (!isShortRateLimit) {
            const activeEmail = antigravityAccountsService.getActiveEmail() || '当前账号';
            const exhaustedMsg = `🚫 **【账号额度已用尽】** 账号 \`${activeEmail}\` 额度已耗尽${err.resetTimeMsg ? `（预计重置：${err.resetTimeMsg}）` : ''}，请切换其他账号或等待额度重置后再试。`;
            console.warn(`[Antigravity Runtime] 🚫 账号额度已用尽，实时播报并终止重试: ${activeEmail}`);
            ws.send(createNormalizedMessage({
              kind: 'error',
              content: exhaustedMsg,
              sessionId: currentSessionId,
              provider: 'antigravity',
            }));
            const completeMsg = createCompleteMessage({
              sessionId: currentSessionId,
              exitCode: 1,
              provider: 'antigravity',
            });
            ws.send(completeMsg);
            return;
          }

          console.warn(`[Antigravity Runtime] 🚨 触发 429 速率限制 (回合尝试 ${attempt}/${TOTAL_MAX_ATTEMPTS})，保持当前账号启动智能时间退避自愈...`);

          // 保持当前账号不变，启动智能指数退避等待
          if (attempt < TOTAL_MAX_ATTEMPTS) {
            const waitSeconds = Math.min(Math.ceil(parseFloat(resetMatch![1])) + 2, 60);

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
        const isProxyEOF = !isWatchdogTimeout && /EOF|connection reset by peer|stream ended|unexpected EOF/i.test(errMsg);

        // 若当前回合已产出部分回复后才断开，不再重发原始 command 避免重复执行，转为可恢复断点暂停
        if (accumulatedText && accumulatedText.trim().length > 0 && (isStreamInterrupted || isProxyEOF)) {
          throw new Error(`stream was interrupted before the response finished (${errMsg})`);
        }

        // 防无限重发与死循环保护：流中断或断连时最多允许重试 1 次（绝不篡改 prompt 狂发“继续”，绝不中途 pkill 代理）
        if ((isStreamInterrupted || isProxyEOF) && attempt < 2) {
          console.warn(`[Antigravity Runtime] 捕获到单次流中断或断连波动 (尝试 ${attempt}/2)，等待 2 秒进行单次原位恢复...`);
          await new Promise((r) => setTimeout(r, 2000));
          continue;
        }

        // 4. Transient network / TLS / DNS / Handshake / Eligibility check errors (最多允许 2 次瞬态重试，严禁 pkill 代理)
        const isTransient = /retryable error|network issue|stream ended|unexpected EOF|context canceled|connection reset|Eligibility check failed|profile picture|i\/o timeout|timeout|dial tcp|connection refused|network is unreachable/i.test(errMsg);
        if (isTransient && attempt < 3) {
          console.warn(`[Antigravity Runtime] 瞬态网络握手轻微波动 (尝试 ${attempt}/3): ${errMsg.slice(0, 100)}，等待 2 秒重试...`);
          await new Promise((r) => setTimeout(r, 2000));
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
            hookAddDir: permissionGate?.hookAddDir,
            images,
            files,
            capturedSessionId,
            accumulatedText,
            ws,
            currentSessionKey: capturedSessionId || sessionId || processKey,
            appSessionId: sessionId || processKey,
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
              currentTurnProc = proc;
              const keys = [capturedSessionId, sessionId, processKey].filter(Boolean) as string[];
              registerManagedProcess(keys, proc);
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

    // 对话完成：获取真实上游配额缓存，保证向前端派发的消息快照 100% 为鲜活原生双配额
    const currentActiveEmail = antigravityAccountsService.getActiveEmail() || undefined;
    let fastQuota = antigravityAccountsService.getLiveQuotaCached(currentActiveEmail);
    if (!fastQuota || (fastQuota.gemini5h && fastQuota.gemini5h.percent >= 99.9)) {
      try {
        fastQuota = (await antigravityAccountsService.fetchLiveQuotaSummary(true, currentActiveEmail)) || fastQuota;
      } catch (_) {}
    } else {
      void antigravityAccountsService.fetchLiveQuotaSummary(true, currentActiveEmail);
    }
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
      console.warn('[Antigravity Runtime] 捕获到流中断，优雅停止自动重发，将控制权交给用户');
      if (!abortController.signal.aborted) {
        ws.send(createNormalizedMessage({
          kind: 'text',
          role: 'assistant',
          content: '\n\n> ⚠️ 上游数据流传输短暂中断。系统已停止自动重试，您可以回复“继续”随时恢复处理。',
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
    permissionGate?.dispose();
    notifyTurnEnded();
  }
}

export const antigravityRuntime: IProviderRuntime = {
  run(command: string, options: AnyRecord, writer: ProviderRuntimeWriter, context: ProviderRuntimeContext) {
    return spawnAntigravity(command, options, writer, context);
  },
  abort(sessionId: string): boolean {
    return abortAntigravityProcessesByKey(sessionId);
  },
  permissions: {
    resolve: resolveAntigravityToolApproval,
    listPending: getAntigravityPendingApprovals,
  },
};
