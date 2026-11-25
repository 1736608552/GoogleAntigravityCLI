import assert from 'node:assert/strict';

import { test } from 'vitest';

import { groupAgentExecutionSteps, groupConsecutiveTools, isToolGroupItem } from '@/modules/chat/utils/toolGrouping';
import type { ChatMessage } from '@/shared/types';

/**
 * The collapsed group's summary line is built here rather than in
 * ToolGroupContainer because producing it JSON.parses tool inputs, which can be
 * whole file contents. The component's useMemo could never cache it — grouping
 * allocates a fresh messages array on every pass — so it ran on every render of
 * the transcript, including ten times a second while streaming.
 */

const toolMessage = (toolName: string, toolInput: unknown): ChatMessage => ({
  type: 'tool',
  content: '',
  timestamp: '2024-01-01T00:00:00.000Z',
  isToolUse: true,
  toolName,
  toolInput: typeof toolInput === 'string' ? toolInput : JSON.stringify(toolInput),
});

const textMessage = (content: string): ChatMessage => ({
  type: 'assistant',
  content,
  timestamp: '2024-01-01T00:00:00.000Z',
});

const thinkingMessage = (): ChatMessage => ({
  type: 'assistant',
  content: 'deliberating',
  timestamp: '2024-01-01T00:00:00.000Z',
  isThinking: true,
});

test('a run of same-tool calls is grouped and carries a precomputed preview', () => {
  const items = groupConsecutiveTools([
    toolMessage('Read', { file_path: '/a.ts' }),
    toolMessage('Read', { file_path: '/b.ts' }),
  ]);

  assert.equal(items.length, 1);
  const [group] = items;
  assert.ok(isToolGroupItem(group));
  assert.equal(group.preview, '/a.ts, /b.ts');
});

test('a group of more than two calls reports the remainder', () => {
  const items = groupConsecutiveTools([
    toolMessage('Read', { file_path: '/a.ts' }),
    toolMessage('Read', { file_path: '/b.ts' }),
    toolMessage('Read', { file_path: '/c.ts' }),
    toolMessage('Read', { file_path: '/d.ts' }),
  ]);

  const [group] = items;
  assert.ok(isToolGroupItem(group));
  assert.equal(group.preview, '/a.ts, /b.ts, +2 项');
});

test('a single tool call is not grouped', () => {
  const items = groupConsecutiveTools([toolMessage('Read', { file_path: '/a.ts' })]);

  assert.equal(items.length, 1);
  assert.equal(isToolGroupItem(items[0]), false);
});

test('different tools are not grouped together', () => {
  const items = groupConsecutiveTools([
    toolMessage('Read', { file_path: '/a.ts' }),
    toolMessage('Write', { file_path: '/b.ts' }),
  ]);

  assert.equal(items.length, 2);
  assert.equal(items.every((item) => !isToolGroupItem(item)), true);
});

test('a text turn splits a run', () => {
  const items = groupConsecutiveTools([
    toolMessage('Read', { file_path: '/a.ts' }),
    textMessage('some prose'),
    toolMessage('Read', { file_path: '/b.ts' }),
  ]);

  assert.equal(items.length, 3);
  assert.equal(items.filter(isToolGroupItem).length, 0);
});

test('an unparsable tool input does not throw while grouping', () => {
  const items = groupConsecutiveTools([
    toolMessage('Read', '{not json'),
    toolMessage('Read', '{also not json'),
  ]);

  const [group] = items;
  assert.ok(isToolGroupItem(group));
  // Read's getValue reads .file_path off the parsed input; the unparsable input
  // stays a string, so there is nothing to show. The group must still form, the
  // raw JSON must not leak into the summary line, and both calls must be
  // accounted for as unnamed.
  assert.equal(group.preview, '+2 项');
});

test('a tool with no config is previewed by what it operated on', () => {
  // Exercises the other half of getToolInputPreview: unknown tools resolve to
  // the Default config, whose title summarizes the input. Previewing the
  // config's own label instead made every unmapped provider tool collapse into
  // an identical, meaningless "Parameters, Parameters" line.
  const items = groupConsecutiveTools([
    toolMessage('SomeUnknownTool', { command: 'npm test' }),
    toolMessage('SomeUnknownTool', { file_path: '/repo/a.ts' }),
  ]);

  const [group] = items;
  assert.ok(isToolGroupItem(group));
  assert.equal(group.preview, 'npm test, /repo/a.ts');
});

test('the group carries the run\u2019s first timestamp, which is what the search jump matches on', () => {
  const items = groupConsecutiveTools([
    { ...toolMessage('Read', { file_path: '/a.ts' }), timestamp: '2024-01-01T10:00:00.000Z' },
    { ...toolMessage('Read', { file_path: '/b.ts' }), timestamp: '2024-01-01T10:00:05.000Z' },
  ]);

  const [group] = items;
  assert.ok(isToolGroupItem(group));
  assert.equal(group.timestamp, '2024-01-01T10:00:00.000Z');
});

test('a call the line cannot name is counted in the remainder', () => {
  // One of the two is named, so the other is "more" — the badge says x2 and the
  // line accounts for two calls.
  const items = groupConsecutiveTools([
    toolMessage('Read', { file_path: '/a.ts' }),
    toolMessage('Read', {}),
  ]);

  const [group] = items;
  assert.ok(isToolGroupItem(group));
  assert.equal(group.preview, '/a.ts, +1 项');
});

test('the named calls plus the remainder always add up to the group size', () => {
  // The invariant that keeps the summary honest next to ToolGroupContainer's
  // x{messages.length} badge. Subtracting the two preview slots instead of the
  // previews that produced text renders "+1 more" for three hidden calls.
  const items = groupConsecutiveTools([
    toolMessage('Read', {}),
    toolMessage('Read', { file_path: '/b.ts' }),
    toolMessage('Read', { file_path: '/c.ts' }),
  ]);

  const [group] = items;
  assert.ok(isToolGroupItem(group));
  assert.equal(group.preview, '/b.ts, +2 项');
});

test('a group that can name nothing still accounts for every call', () => {
  const items = groupConsecutiveTools([
    toolMessage('Read', {}),
    toolMessage('Read', {}),
    toolMessage('Read', {}),
    toolMessage('Read', {}),
    toolMessage('Read', {}),
  ]);

  const [group] = items;
  assert.ok(isToolGroupItem(group));
  assert.equal(group.preview, '+5 项');
});

test('hidden reasoning between two tool calls does not split the run', () => {
  // Codex interleaves reasoning between consecutive tool calls; with thinking
  // turned off those messages render nothing, so splitting on them would show
  // two ungrouped rows with an invisible gap between them.
  const items = groupConsecutiveTools([
    toolMessage('Read', { file_path: '/a.ts' }),
    thinkingMessage(),
    toolMessage('Read', { file_path: '/b.ts' }),
  ], false);

  assert.equal(items.length, 1);
  assert.equal(isToolGroupItem(items[0]), true);
});

test('reasoning the user can see does split the run', () => {
  const items = groupConsecutiveTools([
    toolMessage('Read', { file_path: '/a.ts' }),
    thinkingMessage(),
    toolMessage('Read', { file_path: '/b.ts' }),
  ], true);

  assert.equal(items.length, 3);
  assert.equal(items.filter(isToolGroupItem).length, 0);
});

test('showThinking defaults to on, so a caller that omits it does not collapse a visible turn', () => {
  const withThinkingShown = groupConsecutiveTools([
    toolMessage('Read', { file_path: '/a.ts' }),
    thinkingMessage(),
    toolMessage('Read', { file_path: '/b.ts' }),
  ]);

  assert.equal(withThinkingShown.length, 3);
});

test('a subagent container is never absorbed into a group', () => {
  // It renders its own nested transcript, so collapsing it into a one-line
  // summary would hide the whole subagent run.
  const items = groupConsecutiveTools([
    toolMessage('Task', { prompt: 'a' }),
    { ...toolMessage('Task', { prompt: 'b' }), isSubagentContainer: true },
  ]);

  assert.equal(items.length, 2);
  assert.equal(items.filter(isToolGroupItem).length, 0);
});

test('groupAgentExecutionSteps merges consecutive calls across different tools into one step card', () => {
  const items = groupAgentExecutionSteps([
    toolMessage('list_dir', { DirectoryPath: '/repo/src' }),
    toolMessage('view_file', { AbsolutePath: '/repo/src/session.ts' }),
    toolMessage('run_command', { CommandLine: 'npm test', toolSummary: '运行单元测试' }),
  ]);

  assert.equal(items.length, 1);
  const [group] = items;
  assert.ok(isToolGroupItem(group));
  assert.equal(group.toolName, 'AgentExecutionSteps');
  assert.equal(group.messages.length, 3);
});

test('groupAgentExecutionSteps keeps interactive confirmation tools standalone', () => {
  const items = groupAgentExecutionSteps([
    toolMessage('Read', { file_path: '/a.ts' }),
    toolMessage('AskUserQuestion', { questions: [] }),
    toolMessage('Edit', { file_path: '/a.ts' }),
  ]);

  assert.equal(items.length, 3);
  assert.equal(isToolGroupItem(items[0]), true);
  assert.equal(isToolGroupItem(items[1]), false);
  assert.equal(isToolGroupItem(items[2]), true);
});
