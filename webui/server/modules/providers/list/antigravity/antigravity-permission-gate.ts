import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createNotificationEvent, notifyUserIfEnabled } from '@/modules/notifications/index.js';
import { createNormalizedMessage } from '@/shared/utils.js';
import type { AnyRecord, ProviderPermissionDecision, ProviderRuntimeWriter } from '@/shared/types.js';

const DEFAULT_APPROVAL_TIMEOUT_MS = 5 * 60 * 1000;
const HOOK_TIMEOUT_SECONDS = 300;
const HOOK_WAIT_MS = 295 * 1000;

type PendingApprovalResolver = ((decision: ProviderPermissionDecision & { cancelled?: boolean }) => void) & {
  _sessionId?: string | null;
  _toolName?: string;
  _input?: unknown;
  _receivedAt?: Date;
};

const pendingAntigravityApprovals = new Map<string, PendingApprovalResolver>();
const sessionRememberedAllowEntries = new Map<string, Set<string>>();

function createRequestId(): string {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return crypto.randomBytes(16).toString('hex');
}

function getSessionRememberedSet(sessionKey: string | null | undefined): Set<string> | null {
  if (!sessionKey) return null;
  let set = sessionRememberedAllowEntries.get(sessionKey);
  if (!set) {
    set = new Set<string>();
    sessionRememberedAllowEntries.set(sessionKey, set);
  }
  return set;
}

/**
 * 等待前端对 Antigravity 工具权限请求的响应。
 * 消费方：`antigravity-permission-gate.ts` 内部 IPC 调度器。
 */
export function waitForAntigravityToolApproval(
  requestId: string,
  options: {
    timeoutMs?: number;
    signal?: AbortSignal;
    metadata?: {
      _sessionId?: string | null;
      _toolName?: string;
      _input?: unknown;
      _receivedAt?: Date;
    };
    onCancel?: (reason: string) => void;
  } = {},
): Promise<(ProviderPermissionDecision & { cancelled?: boolean }) | null> {
  const { timeoutMs = DEFAULT_APPROVAL_TIMEOUT_MS, signal, onCancel, metadata } = options;

  return new Promise((resolve) => {
    let settled = false;
    let timeout: NodeJS.Timeout | null = null;

    const cleanup = () => {
      pendingAntigravityApprovals.delete(requestId);
      if (timeout) {
        clearTimeout(timeout);
        timeout = null;
      }
      if (signal) {
        signal.removeEventListener('abort', abortHandler);
      }
    };

    const finalize = (decision: (ProviderPermissionDecision & { cancelled?: boolean }) | null) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(decision);
    };

    const abortHandler = () => {
      onCancel?.('cancelled');
      finalize({ allow: false, cancelled: true });
    };

    if (timeoutMs > 0) {
      timeout = setTimeout(() => {
        onCancel?.('timeout');
        finalize(null);
      }, timeoutMs);
    }

    if (signal) {
      if (signal.aborted) {
        onCancel?.('cancelled');
        finalize({ allow: false, cancelled: true });
        return;
      }
      signal.addEventListener('abort', abortHandler, { once: true });
    }

    const resolver: PendingApprovalResolver = (decision) => {
      finalize(decision);
    };
    if (metadata) {
      Object.assign(resolver, metadata);
    }
    pendingAntigravityApprovals.set(requestId, resolver);
  });
}

/**
 * 解析并唤醒等待中的 Antigravity 工具权限请求。
 * 消费方：`antigravityRuntime.permissions.resolve` (`chat-websocket.service.ts`)。
 */
export function resolveAntigravityToolApproval(requestId: string, decision: ProviderPermissionDecision): void {
  const resolver = pendingAntigravityApprovals.get(requestId);
  if (resolver) {
    resolver(decision);
  }
}

/**
 * 列出指定会话当前挂起的工具权限请求列表。
 * 消费方：`antigravityRuntime.permissions.listPending` (`chat-websocket.service.ts`)。
 */
export function getAntigravityPendingApprovals(sessionId: string): unknown[] {
  const pending: unknown[] = [];
  for (const [requestId, resolver] of pendingAntigravityApprovals.entries()) {
    if (resolver._sessionId === sessionId) {
      pending.push({
        requestId,
        toolName: resolver._toolName || 'UnknownTool',
        input: resolver._input,
        sessionId,
        receivedAt: resolver._receivedAt || new Date(),
      });
    }
  }
  return pending;
}

/**
 * 匹配记住的权限规则与当前工具调用。
 * 消费方：`evaluateAntigravityToolPolicy` 与单元测试。
 */
export function matchesAntigravityToolPermission(entry: string, toolName: string, input: unknown): boolean {
  if (!entry || !toolName) {
    return false;
  }
  if (entry === toolName) {
    return true;
  }

  const cmdMatch = entry.match(/^(?:run_command|Bash)\((.+):\*\)$/);
  if ((toolName === 'run_command' || toolName === 'Bash') && cmdMatch) {
    const allowedPrefix = cmdMatch[1];
    const command = extractCommandLine(input);
    if (!command) {
      return false;
    }
    return command === allowedPrefix || command.startsWith(`${allowedPrefix} `) || command.startsWith(allowedPrefix);
  }

  return false;
}

function extractCommandLine(input: unknown): string {
  if (typeof input === 'string') {
    return input.trim();
  }
  if (input && typeof input === 'object') {
    const obj = input as AnyRecord;
    const raw = obj.CommandLine ?? obj.command ?? obj.cmd;
    if (typeof raw === 'string') {
      return raw.trim();
    }
  }
  return '';
}

const READ_ONLY_TOOLS = new Set([
  'read_file',
  'view_file',
  'view_file_outline',
  'view_code_item',
  'grep_search',
  'find_by_name',
  'list_dir',
  'read_url_content',
  'read_terminal',
  'command_status',
  'ask_question',
  'update_steps',
  'list_resources',
  'read_resource',
  'get_agent_skills',
  'search_web',
  'find_by_glob',
]);

const EDIT_TOOLS = new Set([
  'write_to_file',
  'replace_file_content',
  'multi_replace_file_content',
  'edit_file',
  'write_file',
]);

const SAFE_READ_ONLY_HEADS = new Set([
  'ls',
  'cat',
  'head',
  'tail',
  'grep',
  'rg',
  'find',
  'pwd',
  'which',
  'wc',
  'stat',
  'file',
  'uname',
  'echo',
  'printf',
  'ps',
  'df',
  'du',
  'id',
  'whoami',
  'date',
  'env',
  'printenv',
]);

const SAFE_GIT_SUBCOMMANDS = new Set([
  'status',
  'diff',
  'log',
  'show',
  'branch',
  'tag',
  'rev-parse',
  'remote',
  'ls-files',
]);

/**
 * 判断一条 shell 命令是否为安全只读命令（不包含重定向写文件、命令替换或危险子命令）。
 * 消费方：`evaluateAntigravityToolPolicy` 与单元测试。
 */
export function isSafeReadOnlyCommand(commandLine: string): boolean {
  const trimmed = commandLine.trim();
  if (!trimmed) return false;
  // 禁止命令替换、反引号、输出重定向、后台符或子 shell
  if (/[`<>]|\$\(|&\s*$/.test(trimmed)) {
    return false;
  }

  // 按常见串行管道与连接符拆分后逐段校验首命令
  const segments = trimmed.split(/\s*(?:&&|\|\||;|\|)\s*/).filter(Boolean);
  if (segments.length === 0) return false;

  for (const segment of segments) {
    const tokens = segment.trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return false;

    const head = path.basename(tokens[0]);
    if (head === 'git') {
      const sub = tokens[1] || '';
      if (!SAFE_GIT_SUBCOMMANDS.has(sub)) {
        return false;
      }
      // `git branch -D` / `-d` / `-m` 等修改分支的操作拒绝归类为只读
      if (sub === 'branch' && tokens.some((t) => /^-(?:d|D|m|M|c|C)$/.test(t))) {
        return false;
      }
      continue;
    }

    if (head === 'find') {
      // find 带 -delete / -exec / -execdir / -ok 视为非只读
      if (tokens.some((t) => t === '-delete' || t === '-exec' || t === '-execdir' || t === '-ok')) {
        return false;
      }
      continue;
    }

    if (!SAFE_READ_ONLY_HEADS.has(head)) {
      return false;
    }
  }

  return true;
}

function isPathInsideWorkspace(targetPath: unknown, workingDir: string): boolean {
  if (typeof targetPath !== 'string' || !targetPath.trim()) {
    return false;
  }
  const resolvedTarget = path.resolve(workingDir, targetPath);
  const resolvedRoot = path.resolve(workingDir);
  return resolvedTarget === resolvedRoot || resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`);
}

function extractTargetFilePath(input: unknown): string | null {
  if (!input || typeof input !== 'object') return null;
  const obj = input as AnyRecord;
  const raw = obj.TargetFile ?? obj.Path ?? obj.AbsolutePath ?? obj.file_path ?? obj.path;
  return typeof raw === 'string' && raw.trim() ? raw.trim() : null;
}

export type ToolPolicyDecision =
  | { action: 'allow'; reason?: string }
  | { action: 'deny'; reason: string }
  | { action: 'ask'; reason: string };

/**
 * 评估 Antigravity 工具调用在当前权限模式下的放行/拒绝/弹窗决策。
 * 消费方：`createAntigravityPermissionGate` 与单元测试。
 */
export function evaluateAntigravityToolPolicy(params: {
  permissionMode?: string;
  skipPermissions?: boolean;
  workingDir: string;
  toolName: string;
  toolInput: unknown;
  allowedTools?: string[];
  disallowedTools?: string[];
}): ToolPolicyDecision {
  const {
    permissionMode,
    skipPermissions,
    workingDir,
    toolName,
    toolInput,
    allowedTools = [],
    disallowedTools = [],
  } = params;

  if (skipPermissions || permissionMode === 'bypassPermissions' || permissionMode === 'auto') {
    return { action: 'allow' };
  }

  if (disallowedTools.some((entry) => matchesAntigravityToolPermission(entry, toolName, toolInput))) {
    return { action: 'deny', reason: '工具已被策略禁止 (disallowedTools)' };
  }

  if (allowedTools.some((entry) => matchesAntigravityToolPermission(entry, toolName, toolInput))) {
    return { action: 'allow' };
  }

  if (READ_ONLY_TOOLS.has(toolName)) {
    return { action: 'allow' };
  }

  if (toolName === 'run_command') {
    const command = extractCommandLine(toolInput);
    if (isSafeReadOnlyCommand(command)) {
      return { action: 'allow' };
    }
    return {
      action: 'ask',
      reason: command ? `需要确认执行命令: ${command}` : '需要确认执行终端命令',
    };
  }

  if (EDIT_TOOLS.has(toolName)) {
    const targetFile = extractTargetFilePath(toolInput);
    const insideWorkspace = targetFile ? isPathInsideWorkspace(targetFile, workingDir) : false;

    if (permissionMode === 'acceptEdits' || permissionMode === 'accept-edits') {
      if (insideWorkspace) {
        return { action: 'allow' };
      }
      return {
        action: 'ask',
        reason: targetFile ? `需要确认修改工作区外文件: ${targetFile}` : '需要确认修改文件',
      };
    }

    return {
      action: 'ask',
      reason: targetFile ? `需要确认写入或修改文件: ${targetFile}` : '需要确认文件写入操作',
    };
  }

  return {
    action: 'ask',
    reason: `需要确认调用工具: ${toolName}`,
  };
}

function atomicWriteJson(filePath: string, payload: unknown): void {
  const tmpPath = `${filePath}.tmp.${process.pid}.${Date.now()}`;
  fs.writeFileSync(tmpPath, JSON.stringify(payload), 'utf8');
  fs.renameSync(tmpPath, filePath);
}

function buildPreToolHookScript(ipcDir: string): string {
  return `import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const IPC_DIR = ${JSON.stringify(ipcDir)};
const MAX_WAIT_MS = ${HOOK_WAIT_MS};
const POLL_MS = 80;

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  let payload = {};
  try {
    const raw = await readStdin();
    payload = raw.trim() ? JSON.parse(raw) : {};
  } catch (err) {
    process.stdout.write(JSON.stringify({ decision: 'deny', reason: 'Hook 无法解析工具输入参数' }));
    return;
  }

  const reqId = typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : crypto.randomBytes(16).toString('hex');
  const reqPath = path.join(IPC_DIR, reqId + '.req.json');
  const tmpPath = path.join(IPC_DIR, reqId + '.req.tmp');
  const resPath = path.join(IPC_DIR, reqId + '.res.json');

  try {
    fs.writeFileSync(tmpPath, JSON.stringify({ requestId: reqId, payload }), 'utf8');
    fs.renameSync(tmpPath, reqPath);
  } catch (err) {
    process.stdout.write(JSON.stringify({ decision: 'deny', reason: '无法写入权限审批请求文件' }));
    return;
  }

  const started = Date.now();
  while (Date.now() - started < MAX_WAIT_MS) {
    if (fs.existsSync(resPath)) {
      try {
        const resRaw = fs.readFileSync(resPath, 'utf8');
        try { fs.unlinkSync(resPath); } catch (_) {}
        const res = JSON.parse(resRaw);
        const output = {
          decision: res.allow ? 'allow' : 'deny',
        };
        if (res.reason) output.reason = String(res.reason);
        if (res.overwrite && typeof res.overwrite === 'object') {
          output.overwrite = res.overwrite;
        }
        process.stdout.write(JSON.stringify(output));
        return;
      } catch (_) {
        // 文件正在写入或瞬间异常，短暂重试
      }
    }
    await sleep(POLL_MS);
  }

  try { fs.unlinkSync(reqPath); } catch (_) {}
  process.stdout.write(JSON.stringify({ decision: 'deny', reason: '用户权限确认超时，已自动拦截' }));
}

main().catch(() => {
  process.stdout.write(JSON.stringify({ decision: 'deny', reason: '权限门卫脚本执行异常' }));
});
`;
}

export type AntigravityPermissionGateHandle = {
  hookAddDir: string;
  gateDir: string;
  dispose: () => void;
};

/**
 * 为单次 Antigravity CLI 运行创建基于临时文件 IPC 的 PreToolUse 权限门卫。
 * 兼容 `--sandbox` 命名空间隔离（不依赖 127.0.0.1 回环网络），并在结束时自动销毁全部临时文件。
 * 消费方：`antigravity-runtime.provider.ts`。
 */
export function createAntigravityPermissionGate(params: {
  permissionMode?: string;
  skipPermissions?: boolean;
  workingDir: string;
  sessionId?: string | null;
  getActiveSessionId: () => string | null;
  sessionSummary?: string;
  writer: ProviderRuntimeWriter;
  abortSignal?: AbortSignal;
  toolsSettings?: {
    allowedTools?: string[];
    disallowedTools?: string[];
  };
}): AntigravityPermissionGateHandle | null {
  const {
    permissionMode,
    skipPermissions,
    workingDir,
    sessionId,
    getActiveSessionId,
    sessionSummary,
    writer,
    abortSignal,
    toolsSettings,
  } = params;

  if (skipPermissions || permissionMode === 'bypassPermissions' || permissionMode === 'auto') {
    return null;
  }

  const gateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-perm-'));
  const ipcDir = path.join(gateDir, 'ipc');
  const agentsDir = path.join(gateDir, '.agents');
  fs.mkdirSync(ipcDir, { recursive: true });
  fs.mkdirSync(agentsDir, { recursive: true });

  const hookScriptPath = path.join(gateDir, 'pre-tool-hook.mjs');
  fs.writeFileSync(hookScriptPath, buildPreToolHookScript(ipcDir), 'utf8');

  const hooksJsonPath = path.join(agentsDir, 'hooks.json');
  const hooksPayload = {
    'webui-permission-gate': {
      PreToolUse: [
        {
          matcher: '*',
          hooks: [
            {
              type: 'command',
              command: `${JSON.stringify(process.execPath)} ${JSON.stringify(hookScriptPath)}`,
              timeout: HOOK_TIMEOUT_SECONDS,
            },
          ],
        },
      ],
    },
  };
  fs.writeFileSync(hooksJsonPath, JSON.stringify(hooksPayload, null, 2), 'utf8');

  let disposed = false;
  const activePollers = new Set<string>();
  const localAllowed = [...(toolsSettings?.allowedTools || [])];
  const localDisallowed = [...(toolsSettings?.disallowedTools || [])];

  const handleRequestFile = async (reqFileName: string) => {
    if (disposed || activePollers.has(reqFileName)) return;
    activePollers.add(reqFileName);

    const reqPath = path.join(ipcDir, reqFileName);
    const claimPath = path.join(ipcDir, `${reqFileName}.claimed`);
    let requestId = reqFileName.replace(/\.req\.json$/, '');

    try {
      fs.renameSync(reqPath, claimPath);
    } catch {
      activePollers.delete(reqFileName);
      return;
    }

    try {
      const raw = fs.readFileSync(claimPath, 'utf8');
      try { fs.unlinkSync(claimPath); } catch (_) {}

      const parsed = JSON.parse(raw) as {
        requestId?: string;
        payload?: {
          toolCall?: { id?: string; name?: string; args?: unknown };
          cwd?: string;
          conversationId?: string;
        };
      };
      if (parsed.requestId) {
        requestId = parsed.requestId;
      }
      const resPath = path.join(ipcDir, `${requestId}.res.json`);
      const toolName = parsed.payload?.toolCall?.name || 'unknown_tool';
      const toolInput = parsed.payload?.toolCall?.args ?? {};
      const activeSessionId = sessionId || getActiveSessionId() || parsed.payload?.conversationId || null;
      const rememberedSet = getSessionRememberedSet(activeSessionId);
      const effectiveAllowed = rememberedSet ? [...localAllowed, ...rememberedSet] : localAllowed;

      const verdict = evaluateAntigravityToolPolicy({
        permissionMode,
        skipPermissions,
        workingDir,
        toolName,
        toolInput,
        allowedTools: effectiveAllowed,
        disallowedTools: localDisallowed,
      });

      if (verdict.action === 'allow') {
        if (!disposed && fs.existsSync(ipcDir)) {
          atomicWriteJson(resPath, { allow: true });
        }
        return;
      }

      if (verdict.action === 'deny') {
        if (!disposed && fs.existsSync(ipcDir)) {
          atomicWriteJson(resPath, { allow: false, reason: verdict.reason });
        }
        return;
      }

      // 需要交互式弹窗确认：向前端推送 permission_request 并挂起等待
      writer.send(createNormalizedMessage({
        kind: 'permission_request',
        requestId,
        toolName,
        input: toolInput,
        sessionId: activeSessionId,
        provider: 'antigravity',
      }));

      void notifyUserIfEnabled({
        userId: writer.userId ?? null,
        event: createNotificationEvent({
          provider: 'antigravity',
          sessionId: activeSessionId,
          kind: 'action_required',
          code: 'permission.required',
          meta: { toolName, sessionName: sessionSummary },
          severity: 'warning',
          requiresUserAction: true,
          dedupeKey: `antigravity:permission:${activeSessionId || 'none'}:${requestId}`,
        } as unknown as Parameters<typeof createNotificationEvent>[0]),
      });

      const decision = await waitForAntigravityToolApproval(requestId, {
        timeoutMs: DEFAULT_APPROVAL_TIMEOUT_MS,
        signal: abortSignal,
        metadata: {
          _sessionId: activeSessionId,
          _toolName: toolName,
          _input: toolInput,
          _receivedAt: new Date(),
        },
        onCancel: (reason) => {
          writer.send(createNormalizedMessage({
            kind: 'permission_cancelled',
            requestId,
            reason,
            sessionId: activeSessionId,
            provider: 'antigravity',
          }));
        },
      });

      if (!decision) {
        if (!disposed && fs.existsSync(ipcDir)) {
          atomicWriteJson(resPath, { allow: false, reason: '权限确认请求超时' });
        }
        return;
      }

      if (decision.cancelled) {
        if (!disposed && fs.existsSync(ipcDir)) {
          atomicWriteJson(resPath, { allow: false, reason: '权限确认请求已取消' });
        }
        return;
      }

      writer.send(createNormalizedMessage({
        kind: 'permission_resolved',
        requestId,
        sessionId: activeSessionId,
        provider: 'antigravity',
      }));

      if (decision.allow) {
        if (decision.rememberEntry && typeof decision.rememberEntry === 'string') {
          if (!localAllowed.includes(decision.rememberEntry)) {
            localAllowed.push(decision.rememberEntry);
          }
          rememberedSet?.add(decision.rememberEntry);
        }
        if (!disposed && fs.existsSync(ipcDir)) {
          const overwrite =
            decision.updatedInput && typeof decision.updatedInput === 'object'
              ? decision.updatedInput
              : undefined;
          atomicWriteJson(resPath, { allow: true, overwrite });
        }
      } else {
        if (!disposed && fs.existsSync(ipcDir)) {
          atomicWriteJson(resPath, {
            allow: false,
            reason: decision.message || '用户拒绝了此工具调用',
          });
        }
      }
    } catch (err: any) {
      if (!disposed && fs.existsSync(ipcDir)) {
        const resPath = path.join(ipcDir, `${requestId}.res.json`);
        try {
          atomicWriteJson(resPath, { allow: false, reason: err?.message || '权限门卫处理异常' });
        } catch (_) {}
      }
    } finally {
      activePollers.delete(reqFileName);
    }
  };

  const scanIpcDir = () => {
    if (disposed) return;
    try {
      const files = fs.readdirSync(ipcDir);
      for (const file of files) {
        if (file.endsWith('.req.json')) {
          void handleRequestFile(file);
        }
      }
    } catch (_) {}
  };

  let watcher: fs.FSWatcher | null = null;
  try {
    watcher = fs.watch(ipcDir, (_eventType, filename) => {
      if (typeof filename === 'string' && filename.endsWith('.req.json')) {
        void handleRequestFile(filename);
      } else {
        scanIpcDir();
      }
    });
  } catch (_) {}

  const pollTimer = setInterval(scanIpcDir, 150);

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    clearInterval(pollTimer);
    if (watcher) {
      try { watcher.close(); } catch (_) {}
      watcher = null;
    }
    try {
      fs.rmSync(gateDir, { recursive: true, force: true });
    } catch (_) {}
  };

  return {
    hookAddDir: gateDir,
    gateDir,
    dispose,
  };
}
