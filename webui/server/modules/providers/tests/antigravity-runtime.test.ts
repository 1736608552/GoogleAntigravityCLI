import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import { PassThrough } from 'node:stream';
import test from 'node:test';

import {
  antigravityRuntime,
  resolveAntigravityPermissionArgs,
  resolveAntigravityPermissionPolicy,
  runAntigravityTurnOnce,
} from '@/modules/providers/list/antigravity/antigravity-runtime.provider.js';
import {
  createAntigravityPermissionGate,
  evaluateAntigravityToolPolicy,
  getAntigravityPendingApprovals,
  isSafeReadOnlyCommand,
  resolveAntigravityToolApproval,
} from '@/modules/providers/list/antigravity/antigravity-permission-gate.js';

function createMockChildProcess() {
  const proc = new EventEmitter() as ChildProcess & EventEmitter;
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const stdin = new PassThrough();
  const writtenInputs: string[] = [];
  stdin.on('data', (chunk) => {
    writtenInputs.push(chunk.toString('utf8'));
  });
  Object.assign(proc, {
    pid: 999991,
    killed: false,
    exitCode: null,
    stdout,
    stderr,
    stdin,
    kill: () => {
      (proc as any).killed = true;
      return true;
    },
  });
  return { proc, stdout, stderr, stdin, writtenInputs };
}

test('resolveAntigravityPermissionArgs distinguishes default, acceptEdits, plan and bypassPermissions', () => {
  // 默认模式绝不可退化为 --dangerously-skip-permissions，即使外部传入 skipPermissions=true 也不覆盖显式 plan/default
  assert.deepEqual(resolveAntigravityPermissionArgs('default', false), ['--sandbox']);
  assert.deepEqual(resolveAntigravityPermissionArgs('default', true), ['--sandbox']);
  assert.deepEqual(resolveAntigravityPermissionArgs('plan', true), ['--sandbox']);
  assert.deepEqual(resolveAntigravityPermissionArgs('acceptEdits', true), ['--mode', 'accept-edits', '--sandbox']);
  assert.deepEqual(resolveAntigravityPermissionArgs('bypassPermissions', false), ['--dangerously-skip-permissions']);
  assert.deepEqual(resolveAntigravityPermissionArgs(undefined, true), ['--dangerously-skip-permissions']);
  assert.deepEqual(resolveAntigravityPermissionArgs(undefined, false), ['--sandbox']);
});

test('resolveAntigravityPermissionPolicy emits minimal policy only for plan mode without polluting default prompts', () => {
  const planPolicy = resolveAntigravityPermissionPolicy('plan', true, '/repo/app');
  assert.ok(planPolicy.includes('计划模式'));

  assert.equal(resolveAntigravityPermissionPolicy('default', true, '/repo/app'), '');
  assert.equal(resolveAntigravityPermissionPolicy('bypassPermissions', false, '/repo/app'), '');
  assert.equal(resolveAntigravityPermissionPolicy('acceptEdits', false, '/repo/app'), '');
});

test('runAntigravityTurnOnce does not prematurely settle during async subagent silence and blocks post-result leaks', async () => {
  const { proc, stdout, writtenInputs } = createMockChildProcess();
  let capturedArgs: string[] = [];
  const emittedEvents: unknown[] = [];

  const turnPromise = runAntigravityTurnOnce({
    command: '请调研并修改',
    workingDir: process.cwd(),
    model: 'gemini-4-hydrogen',
    effort: 'high',
    permissionMode: 'default',
    skipPermissions: false,
    capturedSessionId: null,
    accumulatedText: '',
    ws: {
      send: (msg: unknown) => {
        emittedEvents.push(msg);
      },
    } as any,
    currentSessionKey: 'test-session',
    abortSignal: new AbortController().signal,
    onSessionDiscovered: () => {},
    onTextDelta: () => {},
    onFullText: () => {},
    onProcessSpawned: () => {},
    spawnImpl: ((_cmd: string, args: readonly string[]) => {
      capturedArgs = [...args];
      return proc;
    }) as any,
  });

  // 确认默认模式只传 --sandbox 而非 --dangerously-skip-permissions，且不再向用户 prompt 注入冗长策略文本
  assert.ok(capturedArgs.includes('--sandbox'));
  assert.equal(capturedArgs.includes('--dangerously-skip-permissions'), false);
  assert.equal(writtenInputs.some((input) => input.includes('默认受限模式')), false);

  // 1. 派发子代理并输出阶段提示语（旧逻辑会在 2 秒后误触发 finishSuccess）
  stdout.write(`${JSON.stringify({ event: 'init', conversation_id: 'conv-123' })}\n`);
  stdout.write(`${JSON.stringify({
    event: 'step_update',
    step_update: {
      conversation_id: 'conv-123',
      step_index: 1,
      step_type: 'tool',
      tool_call_id: 'sub-1',
      tool_info: { name: 'invoke_subagent', parameters: { Role: 'researcher' }, output: 'started' },
    },
  })}\n`);
  stdout.write(`${JSON.stringify({
    event: 'step_update',
    step_update: {
      conversation_id: 'conv-123',
      step_index: 2,
      state: 'DONE',
      step_type: 'agent_response',
      text_delta: '正在梳理侧边栏结构，请稍候。',
    },
  })}\n`);

  // 等待 2.4 秒（超过原 2000ms scheduleSettleCheck 阈值）：必须仍处于未结算状态
  let settledEarly = false;
  void turnPromise.then(() => {
    settledEarly = true;
  });
  await new Promise((r) => setTimeout(r, 2400));
  assert.equal(settledEarly, false, 'Turn must remain active while subagent/background task is pending');

  // 2. 子代理返回后继续执行最终步骤并收到真正的 event: 'result'
  stdout.write(`${JSON.stringify({
    event: 'step_update',
    step_update: {
      conversation_id: 'conv-123',
      step_index: 3,
      state: 'DONE',
      step_type: 'agent_response',
      text_delta: '全部完成。',
    },
  })}\n`);
  stdout.write(`${JSON.stringify({
    event: 'result',
    result: { conversation_id: 'conv-123', status: 'SUCCESS', response: '正在梳理侧边栏结构，请稍候。全部完成。' },
  })}\n`);

  const result = await turnPromise;
  assert.equal(result.exitCode, 0);
  assert.equal(result.spawnedSubagentsCount, 1);

  // 3. 验证结算后即便进程未立即关闭并有杂音输出，也不会再泄漏推送到 ws
  const eventCountAtResult = emittedEvents.length;
  stdout.write(`${JSON.stringify({
    event: 'step_update',
    step_update: {
      conversation_id: 'conv-123',
      step_index: 4,
      step_type: 'agent_response',
      text_delta: 'late_noise',
    },
  })}\n`);
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(emittedEvents.length, eventCountAtResult);
});

test('isSafeReadOnlyCommand allows safe read-only checks and blocks writes or mutations', () => {
  assert.equal(isSafeReadOnlyCommand('git status && rg -n foo server/'), true);
  assert.equal(isSafeReadOnlyCommand('ls -la | head -n 20'), true);
  assert.equal(isSafeReadOnlyCommand('rm -rf /tmp/foo'), false);
  assert.equal(isSafeReadOnlyCommand('npm test'), false);
  assert.equal(isSafeReadOnlyCommand('echo hi > out.txt'), false);
  assert.equal(isSafeReadOnlyCommand('git push origin main'), false);
  assert.equal(isSafeReadOnlyCommand('find . -exec rm {} ;'), false);
});

test('evaluateAntigravityToolPolicy enforces default, acceptEdits, plan and remember rules', () => {
  assert.equal(
    evaluateAntigravityToolPolicy({
      permissionMode: 'default',
      workingDir: '/repo/app',
      toolName: 'view_file',
      toolInput: { AbsolutePath: '/repo/app/a.ts' },
    }).action,
    'allow',
  );

  assert.equal(
    evaluateAntigravityToolPolicy({
      permissionMode: 'default',
      workingDir: '/repo/app',
      toolName: 'run_command',
      toolInput: { CommandLine: 'npm install foo' },
    }).action,
    'ask',
  );

  assert.equal(
    evaluateAntigravityToolPolicy({
      permissionMode: 'default',
      workingDir: '/repo/app',
      toolName: 'run_command',
      toolInput: { CommandLine: 'npm install foo' },
      allowedTools: ['run_command(npm:*)'],
    }).action,
    'allow',
  );

  assert.equal(
    evaluateAntigravityToolPolicy({
      permissionMode: 'acceptEdits',
      workingDir: '/repo/app',
      toolName: 'write_to_file',
      toolInput: { TargetFile: '/repo/app/src/index.ts' },
    }).action,
    'allow',
  );

  assert.equal(
    evaluateAntigravityToolPolicy({
      permissionMode: 'plan',
      workingDir: '/repo/app',
      toolName: 'write_to_file',
      toolInput: { TargetFile: '/repo/app/src/index.ts' },
    }).action,
    'ask',
  );
});

test('createAntigravityPermissionGate bridges PreToolUse hook via IPC and cleans up temp files', async () => {
  assert.ok(antigravityRuntime.permissions, 'antigravityRuntime must expose permissions gateway');

  const events: Array<{ kind: string; requestId?: string; toolName?: string; input?: unknown }> = [];
  const gate = createAntigravityPermissionGate({
    permissionMode: 'default',
    skipPermissions: false,
    workingDir: process.cwd(),
    sessionId: 'sess-gate-1',
    getActiveSessionId: () => 'sess-gate-1',
    writer: {
      send: (msg: any) => events.push(msg),
    } as any,
  });

  assert.ok(gate, 'permission gate should be created in default mode');
  const hooksJsonPath = `${gate.hookAddDir}/.agents/hooks.json`;
  assert.ok(fs.existsSync(hooksJsonPath));
  const hooksConfig = JSON.parse(fs.readFileSync(hooksJsonPath, 'utf8'));
  const hookCmd = hooksConfig['webui-permission-gate'].PreToolUse[0].hooks[0].command as string;
  const scriptMatch = hookCmd.match(/"([^"]+pre-tool-hook\.mjs)"/);
  assert.ok(scriptMatch, 'settings.json must point to pre-tool-hook.mjs');
  const scriptPath = scriptMatch[1];

  const runHook = (payload: unknown) =>
    new Promise<{ code: number | null; stdout: string }>((resolve) => {
      const child = spawn(process.execPath, [scriptPath], { stdio: ['pipe', 'pipe', 'pipe'] });
      let out = '';
      child.stdout.on('data', (chunk) => {
        out += chunk.toString('utf8');
      });
      child.on('close', (code) => {
        resolve({ code, stdout: out });
      });
      child.stdin.write(JSON.stringify(payload));
      child.stdin.end();
    });

  // 1. 安全只读命令：不触发弹窗直接放行
  const safeRes = await runHook({
    hookEventName: 'PreToolUse',
    cwd: process.cwd(),
    toolCall: { id: 'tc-1', name: 'run_command', args: { CommandLine: 'git status' } },
  });
  assert.equal(safeRes.code, 0);
  assert.equal(JSON.parse(safeRes.stdout).decision, 'allow');
  assert.equal(events.length, 0);

  // 2. 非白名单命令：弹出 permission_request 并等待前端审批
  const riskyPromise = runHook({
    hookEventName: 'PreToolUse',
    cwd: process.cwd(),
    toolCall: { id: 'tc-2', name: 'run_command', args: { CommandLine: 'npm run build' } },
  });

  // 等待 permission_request 到达
  const waitStart = Date.now();
  while (!events.some((e) => e.kind === 'permission_request') && Date.now() - waitStart < 3000) {
    await new Promise((r) => setTimeout(r, 25));
  }

  const reqEvent = events.find((e) => e.kind === 'permission_request');
  assert.ok(reqEvent?.requestId, 'should emit permission_request with requestId');
  assert.equal(reqEvent.toolName, 'run_command');
  assert.equal(getAntigravityPendingApprovals('sess-gate-1').length, 1);

  resolveAntigravityToolApproval(reqEvent.requestId, {
    allow: true,
    rememberEntry: 'run_command(npm:*)',
  });

  const riskyRes = await riskyPromise;
  assert.equal(riskyRes.code, 0);
  assert.equal(JSON.parse(riskyRes.stdout).decision, 'allow');
  assert.ok(events.some((e) => e.kind === 'permission_resolved' && e.requestId === reqEvent.requestId));

  // 3. 验证记住允许规则后同前缀命令不再弹窗
  const eventsCountBefore = events.length;
  const rememberedRes = await runHook({
    hookEventName: 'PreToolUse',
    cwd: process.cwd(),
    toolCall: { id: 'tc-3', name: 'run_command', args: { CommandLine: 'npm test' } },
  });
  assert.equal(JSON.parse(rememberedRes.stdout).decision, 'allow');
  assert.equal(events.length, eventsCountBefore);

  // 4. 清理验证零残留
  const gateDir = gate.gateDir;
  gate.dispose();
  assert.equal(fs.existsSync(gateDir), false, 'gateDir must be deleted after dispose');
});
