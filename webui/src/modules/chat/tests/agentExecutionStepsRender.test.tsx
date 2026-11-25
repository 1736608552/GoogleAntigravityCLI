import { describe, expect, it } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import ToolGroupContainer from '@/modules/chat/transcript/ToolGroupContainer';
import { createCachedDiffCalculator } from '@/modules/chat/utils/messageTransforms';
import type { ChatMessage, ToolGroupItem } from '@/shared/types';

const createDiff = createCachedDiffCalculator();

describe('Agent Execution Steps hierarchical card rendering', () => {
  const buildStep = (overrides: Partial<ChatMessage>): ChatMessage => ({
    type: 'assistant',
    content: '',
    timestamp: '2026-11-25T02:00:00.000Z',
    isToolUse: true,
    toolName: 'view_file',
    toolInput: JSON.stringify({ AbsolutePath: '/repo/src/agent/session.ts' }),
    toolResult: { content: 'ok', isError: false },
    ...overrides,
  });

  const renderSteps = (messages: ChatMessage[], isSessionProcessing?: boolean) => {
    const group: ToolGroupItem = {
      _isGroup: true,
      toolName: 'AgentExecutionSteps',
      messages,
      timestamp: messages[0]?.timestamp,
      preview: 'steps',
    };

    return renderToStaticMarkup(
      React.createElement(ToolGroupContainer, {
        group,
        prevMessage: null,
        createDiff,
        getMessageKey: (msg: ChatMessage) => msg.toolId || String(msg.timestamp),
        provider: 'antigravity',
        isSessionProcessing,
      }),
    );
  };

  it('archives completed steps into concise parent phase layers with aggregated counts and durations', () => {
    const markup = renderSteps([
      buildStep({
        toolId: 'step-1',
        toolName: 'read_file',
        toolInput: JSON.stringify({ Path: '/repo/src/a.ts' }),
        toolDurationMs: 220,
      }),
      buildStep({
        toolId: 'step-2',
        toolName: 'list_dir',
        toolInput: JSON.stringify({ DirectoryPath: '/repo/src' }),
        toolDurationMs: 200,
      }),
      buildStep({
        toolId: 'step-3',
        toolName: 'edit_file',
        toolInput: JSON.stringify({ Path: '/repo/src/ToolGroupContainer.tsx' }),
        toolDurationMs: 850,
      }),
      buildStep({
        toolId: 'step-4',
        toolName: 'run_command',
        toolInput: JSON.stringify({ CommandLine: 'npm run build', toolSummary: '编译前端' }),
        toolDurationMs: 1200,
      }),
    ], false);

    expect(markup).toContain('智能体执行步骤 (4)');
    expect(markup).toContain('查阅与检索代码');
    expect(markup).toContain('420ms');
    expect(markup).toContain('编写与修改文件');
    expect(markup).toContain('850ms');
    expect(markup).toContain('执行命令与验证');
    expect(markup).toContain('1.2s');
    // Child rows stay collapsed by default until user expands a parent layer.
    expect(markup).not.toContain('已读取 a.ts');
  });

  it('renders trailing active tool as a single muted line outside the white card while archiving finished steps inside', () => {
    const step1 = buildStep({
      toolId: 'step-a',
      toolName: 'read_file',
      toolInput: JSON.stringify({ Path: '/repo/a.ts' }),
      toolResult: { content: 'done', isError: false },
      toolDurationMs: 180,
    });
    const step2 = buildStep({
      toolId: 'step-b',
      toolName: 'run_command',
      toolInput: JSON.stringify({ CommandLine: 'npm test', toolSummary: '"运行单元测试"' }),
      toolResult: null,
      toolStatus: undefined,
    });

    const activeMarkup = renderSteps([step1, step2], true);
    // White card contains only the 1 archived finished step, while step2 sits below as a live muted line.
    expect(activeMarkup).toContain('智能体执行步骤 (1)');
    expect(activeMarkup).toContain('查阅与检索代码');
    expect(activeMarkup).toContain('正在运行单元测试');
    expect((activeMarkup.match(/animate-spin/g) || []).length).toBe(1);

    // When the session is idle, even a step missing toolResult is archived cleanly without spinning.
    const idleMarkup = renderSteps([step1, step2], false);
    expect(idleMarkup).toContain('智能体执行步骤 (2)');
    expect(idleMarkup).toContain('执行命令与验证');
    expect(idleMarkup).not.toContain('animate-spin');
  });
});
