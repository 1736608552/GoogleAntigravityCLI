import fs from 'node:fs';
import path from 'node:path';

import type { IProviderSessions } from '@/shared/interfaces.js';
import type {
  AnyRecord,
  FetchHistoryOptions,
  FetchHistoryResult,
  NormalizedMessage,
} from '@/shared/types.js';
import {
  createNormalizedMessage,
  generateMessageId,
  sliceTailPage,
} from '@/shared/utils.js';
import { sessionsDb } from '@/modules/database/index.js';
import {
  parseFilesInputTag,
  parseImagesInputTag,
} from '@/shared/image-attachments.js';
import { resolveAntigravityStateDir } from './antigravity-auth.provider.js';
import { localizeEnglishThought, humanizeAntigravityError } from './antigravity-chinese-filter.js';

const PROVIDER = 'antigravity';

function unwrapAntigravityUserText(value: string): string {
  const match = value.match(/<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/i);
  let text = match ? match[1] : value;

  return text
    .replace(/<ADDITIONAL_METADATA>[\s\S]*?<\/ADDITIONAL_METADATA>/gi, '')
    .replace(/<USER_SETTINGS_CHANGE>[\s\S]*?<\/USER_SETTINGS_CHANGE>/gi, '')
    .replace(/<SYSTEM_MESSAGE>[\s\S]*?<\/SYSTEM_MESSAGE>/gi, '')
    .replace(/【系统要求：[\s\S]*?】\n*/g, '')
    .trim();
}

function getTranscriptLines(logsDir: string): string[] {
  const directPath = path.join(logsDir, 'transcript.jsonl');
  if (fs.existsSync(directPath)) {
    return fs.readFileSync(directPath, 'utf-8').split('\n').filter(Boolean);
  }
  const fullPath = path.join(logsDir, 'transcript_full.jsonl');
  if (fs.existsSync(fullPath)) {
    return fs.readFileSync(fullPath, 'utf-8').split('\n').filter(Boolean);
  }
  const chunksDir = path.join(logsDir, 'chunks', 'transcript');
  if (fs.existsSync(chunksDir)) {
    try {
      const chunkFiles = fs.readdirSync(chunksDir).filter(f => f.endsWith('.jsonl')).sort();
      const lines: string[] = [];
      for (const cf of chunkFiles) {
        const cContent = fs.readFileSync(path.join(chunksDir, cf), 'utf-8');
        lines.push(...cContent.split('\n').filter(Boolean));
      }
      if (lines.length > 0) return lines;
    } catch (_) {}
  }
  const chunksFullDir = path.join(logsDir, 'chunks', 'transcript_full');
  if (fs.existsSync(chunksFullDir)) {
    try {
      const chunkFiles = fs.readdirSync(chunksFullDir).filter(f => f.endsWith('.jsonl')).sort();
      const lines: string[] = [];
      for (const cf of chunkFiles) {
        const cContent = fs.readFileSync(path.join(chunksFullDir, cf), 'utf-8');
        lines.push(...cContent.split('\n').filter(Boolean));
      }
      if (lines.length > 0) return lines;
    } catch (_) {}
  }
  return [];
}

export class AntigravitySessionsProvider implements IProviderSessions {
  normalizeMessage(raw: unknown, sessionId: string | null): NormalizedMessage[] {
    if (!raw) return [];
    if (typeof raw === 'string') {
      return [
        createNormalizedMessage({
          kind: 'stream_delta',
          content: raw,
          text: raw,
          sessionId: sessionId || '',
          provider: PROVIDER,
        }),
      ];
    }
    const record = raw as AnyRecord;
    if (record.kind && record.provider) {
      return [record as NormalizedMessage];
    }
    return [
      createNormalizedMessage({
        kind: 'text',
        content: typeof record.content === 'string' ? record.content : JSON.stringify(record),
        sessionId: sessionId || '',
        provider: PROVIDER,
      }),
    ];
  }

  async fetchHistory(sessionId: string, options?: FetchHistoryOptions): Promise<FetchHistoryResult> {
    const sessionRow = sessionsDb.getSessionById(sessionId);
    const providerSessionId = sessionRow?.provider_session_id || sessionId;

    const logsDir = path.join(
      resolveAntigravityStateDir(),
      'brain',
      providerSessionId,
      '.system_generated',
      'logs'
    );

    let messages: NormalizedMessage[] = [];
    const lines = getTranscriptLines(logsDir);

    if (lines.length > 0) {
      try {
        let pendingToolCalls: Array<{ id: string; name: string }> = [];
        let lastToolCall: { id: string; name: string } | null = null;
        for (const line of lines) {
          try {
            const entry = JSON.parse(line);
            const stepType = entry.type;
            const source = entry.source;
            const ts = entry.created_at || new Date().toISOString();

            if (source === 'USER_EXPLICIT' || stepType === 'USER_INPUT') {
              pendingToolCalls = [];
              lastToolCall = null;
              const rawUserText = entry.content || '';
              const unwrappedText = unwrapAntigravityUserText(rawUserText);
              const parsedImages = parseImagesInputTag(unwrappedText);
              const parsedFiles = parseFilesInputTag(parsedImages.text);

              messages.push(
                createNormalizedMessage({
                  id: generateMessageId('usr'),
                  kind: 'text',
                  role: 'user',
                  content: parsedFiles.text,
                  images: parsedImages.attachments.length > 0 ? parsedImages.attachments : undefined,
                  files: parsedFiles.attachments.length > 0 ? parsedFiles.attachments : undefined,
                  sessionId,
                  timestamp: ts,
                  provider: PROVIDER,
                })
              );
            } else if (stepType === 'ERROR_MESSAGE' || stepType === 'error') {
              const errContent = String(entry.error || entry.content || 'Antigravity error');
              // 关键优化：过滤所有底层自动自愈/断点续传的瞬态重试信息（stream was interrupted, API error, EOF 等）
              // 绝不把正常的中间恢复过程当成红色错误气泡污染历史消息流
              const isTransientNotice = /API error|stream was interrupted|please continue the task|subscriber fell behind|unexpected EOF|context canceled/i.test(errContent);
              if (!isTransientNotice) {
                messages.push(
                  createNormalizedMessage({
                    id: generateMessageId('err'),
                    kind: 'error',
                    role: 'assistant',
                    content: humanizeAntigravityError(errContent),
                    sessionId,
                    timestamp: ts,
                    provider: PROVIDER,
                  })
                );
              }
            } else if (stepType === 'PLANNER_RESPONSE' || stepType === 'AGENT_RESPONSE') {
              if (entry.thinking) {
                messages.push(
                  createNormalizedMessage({
                    id: generateMessageId('thk'),
                    kind: 'thinking',
                    role: 'assistant',
                    content: String(entry.thinking || '').trim(),
                    sessionId,
                    timestamp: ts,
                    provider: PROVIDER,
                  })
                );
              }
              if (Array.isArray(entry.tool_calls) && entry.tool_calls.length > 0) {
                for (const tc of entry.tool_calls) {
                  const callId = generateMessageId('call');
                  const toolItem = { id: callId, name: tc.name };
                  pendingToolCalls.push(toolItem);
                  lastToolCall = toolItem;
                  messages.push(
                    createNormalizedMessage({
                      id: callId,
                      kind: 'tool_use',
                      role: 'assistant',
                      toolName: tc.name,
                      toolInput: tc.args || tc.parameters,
                      sessionId,
                      timestamp: ts,
                      provider: PROVIDER,
                    })
                  );
                }
              }
              if (entry.content && typeof entry.content === 'string' && entry.content !== 'null' && entry.content.trim()) {
                messages.push(
                  createNormalizedMessage({
                    id: generateMessageId('ast'),
                    kind: 'text',
                    role: 'assistant',
                    content: entry.content,
                    sessionId,
                    timestamp: ts,
                    provider: PROVIDER,
                  })
                );
              }
            } else if (entry.type === 'GENERIC' && (entry.content || entry.error || entry.media)) {
              const isError = entry.status === 'ERROR' || Boolean(entry.error);
              let toolContent = String(entry.error || entry.content || '');

              // 关键增强：提取底层 media 数组中的图片并在聊天框展示
              if (Array.isArray(entry.media) && entry.media.length > 0) {
                for (const m of entry.media) {
                  if (m?.uri && typeof m.uri === 'string') {
                    const isImg = !m.mime_type || m.mime_type.startsWith('image/');
                    if (isImg) {
                      toolContent += `\n\n![生成的图片](${m.uri})\n`;
                    }
                  }
                }
              }

              const matchedTool = pendingToolCalls.shift() || lastToolCall;
              const toolId = matchedTool ? matchedTool.id : generateMessageId('call');
              const toolName = matchedTool ? matchedTool.name : undefined;

              // All GENERIC steps in transcript are tool execution outputs — never fatal Antigravity errors!
              messages.push(
                createNormalizedMessage({
                  id: generateMessageId('res'),
                  kind: 'tool_result',
                  toolId,
                  toolName,
                  role: 'assistant',
                  content: toolContent,
                  toolResult: { content: toolContent, isError },
                  sessionId,
                  timestamp: ts,
                  provider: PROVIDER,
                })
              );
            }
          } catch (_) {}
        }
      } catch (err) {
        console.warn(`[AntigravitySessions] error reading transcript in ${logsDir}:`, err);
      }
    }

    let detectedModel = sessionRow?.model || null;

    if (!detectedModel) {
      for (const line of lines) {
        if (line.includes('USER_SETTINGS_CHANGE') && line.includes('Model Selection')) {
          const mMatch = line.match(/Model Selection`\s*from\s*.*?\s*to\s*([^.]+)/i);
          if (mMatch) {
            const label = mMatch[1].trim();
            if (label.includes('3.8') && label.includes('Flash')) detectedModel = 'gemini-3.8-flash';
            else if (label.includes('Sonnet 4.6')) detectedModel = 'claude-sonnet-4-6';
            else if (label.includes('Opus 4.6')) detectedModel = 'claude-opus-4-6-thinking';
            else if (label.includes('120B')) detectedModel = 'gpt-oss-120b-medium';
            else if (label.includes('Flash')) detectedModel = 'gemini-3.8-flash';
            else if (label.toLowerCase().includes('claude')) detectedModel = 'claude-sonnet-4-6';
            else if (label.toLowerCase().includes('gpt')) detectedModel = 'gpt-oss-120b-medium';
            else detectedModel = label.toLowerCase().replace(/[^a-z0-9.-]+/g, '-');
            break;
          }
        }
      }
    }
    if (!detectedModel) {
      detectedModel = 'gemini-3.8-flash';
    }

    const lastAssistant = messages.slice().reverse().find(m => m.role === 'assistant' && m.kind === 'text');
    if (lastAssistant) {
      try {
        const { antigravityAccountsService } = await import('./antigravity-accounts.service.js');
        const targetEmail = (lastAssistant as any).quotaSnapshot?.accountEmail || antigravityAccountsService.getActiveEmail() || undefined;
        const liveSnapshot =
          antigravityAccountsService.getLiveQuotaCached(targetEmail) ||
          (await antigravityAccountsService.getTurnQuotaSnapshot(detectedModel, undefined, undefined, false, targetEmail)) ||
          (await antigravityAccountsService.fetchLiveQuotaSummary(false, targetEmail));

        const snapshotWithModel = liveSnapshot ? { ...liveSnapshot, model: detectedModel } : null;

        if (snapshotWithModel) {
          (lastAssistant as any).quotaSnapshot = snapshotWithModel;
          (lastAssistant as any).model = detectedModel;
          (lastAssistant as any).meta = {
            ...(lastAssistant as any).meta,
            quotaSnapshot: snapshotWithModel,
            model: detectedModel,
          };
        }
      } catch (_) {}
    }

    const { limit, offset } = options || {};
    const normalizedLimit = limit ?? null;
    const normalizedOffset = offset ?? 0;
    const { page, hasMore } = sliceTailPage(messages, normalizedLimit, normalizedOffset);
    return {
      messages: page,
      total: messages.length,
      hasMore,
      offset: normalizedOffset,
      limit: normalizedLimit,
    };
  }
}
