import assert from 'node:assert/strict';
import test from 'node:test';

import {
  antigravityAccountsService,
  formatIneligibleReasonText,
  parseBankedResets,
} from '@/modules/providers/list/antigravity/antigravity-accounts.service.js';

test('parseBankedResets normalizes camelCase and snake_case BankedReset payloads', () => {
  const futureIso = new Date(Date.now() + 3 * 24 * 3600 * 1000 + 2 * 3600 * 1000).toISOString();
  const pastIso = new Date(Date.now() - 60_000).toISOString();

  const resets = parseBankedResets({
    response: {
      banked_resets: [
        {
          reset_id: 'reset-card-1',
          display_label: '全模型配额重置卡',
          remaining_count: 2,
          expire_time: futureIso,
          claimable: true,
          bucket_ids: ['gemini-pro', 'claude-sonnet'],
        },
        {
          resetId: 'reset-card-2',
          displayLabel: '高峰补偿重置卡',
          remainingCount: 1,
          expireTime: pastIso,
          claimable: true,
          ineligibleReason: 'QUOTA_SUMMARY_BANKED_RESET_INELIGIBLE_REASON_USAGE_BELOW_THRESHOLD',
          bucketIds: ['3p-5h'],
        },
        {
          resetId: 'empty-count-card',
          displayLabel: '已耗尽重置卡',
          remainingCount: 0,
          claimable: true,
        },
        {},
      ],
    },
  });

  assert.equal(resets.length, 3);

  assert.equal(resets[0].resetId, 'reset-card-1');
  assert.equal(resets[0].displayLabel, '全模型配额重置卡');
  assert.equal(resets[0].remainingCount, 2);
  assert.equal(resets[0].claimable, true);
  assert.ok(resets[0].expiresIn.endsWith('后过期'));
  assert.deepEqual(resets[0].bucketIds, ['gemini-pro', 'claude-sonnet']);

  assert.equal(resets[1].resetId, 'reset-card-2');
  assert.equal(resets[1].expiresIn, '已过期');
  assert.equal(
    resets[1].ineligibleReasonText,
    '当前用量尚未达到重置触发阈值，暂不可使用',
  );

  // remainingCount 为 0 时即使上游传 claimable: true 也不应允许点击兑换
  assert.equal(resets[2].claimable, false);
});

test('formatIneligibleReasonText maps known enums and skips unspecified values', () => {
  assert.equal(formatIneligibleReasonText(undefined), undefined);
  assert.equal(formatIneligibleReasonText('QUOTA_SUMMARY_BANKED_RESET_INELIGIBLE_REASON_UNSPECIFIED'), undefined);
  assert.equal(
    formatIneligibleReasonText('QUOTA_SUMMARY_BANKED_RESET_INELIGIBLE_REASON_USAGE_BELOW_THRESHOLD'),
    '当前用量尚未达到重置触发阈值，暂不可使用',
  );
  assert.match(formatIneligibleReasonText('CUSTOM_COOLDOWN') || '', /CUSTOM_COOLDOWN/);
});

test('claimBankedQuotaReset validates resetId, calls v1internal:claimBankedQuotaReset, and propagates upstream errors', async () => {
  const emptyRes = await antigravityAccountsService.claimBankedQuotaReset('   ');
  assert.equal(emptyRes.ok, false);
  assert.equal(emptyRes.statusCode, 400);

  const calls: Array<{ url: string; body: any; auth: string }> = [];
  const mockFetchSuccess = (async (url: string | URL, init?: RequestInit) => {
    calls.push({
      url: String(url),
      body: JSON.parse(String(init?.body || '{}')),
      auth: String((init?.headers as Record<string, string>)?.Authorization || ''),
    });
    return new Response(
      JSON.stringify({
        quotaSummary: {
          bankedResets: [],
        },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }) as typeof fetch;

  const okRes = await antigravityAccountsService.claimBankedQuotaReset('reset-card-1', 'demo@example.com', {
    fetchImpl: mockFetchSuccess,
    tokenData: { token: { access_token: 'mock-access-token', expiry: new Date(Date.now() + 3600_000).toISOString() } },
    projectId: 'aicode-consumers',
    email: 'demo@example.com',
  });

  assert.equal(okRes.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://daily-cloudcode-pa.googleapis.com/v1internal:claimBankedQuotaReset');
  assert.equal(calls[0].auth, 'Bearer mock-access-token');
  assert.equal(calls[0].body.project, 'aicode-consumers');
  assert.equal(calls[0].body.resetId, 'reset-card-1');
  assert.ok(typeof calls[0].body.requestId === 'string' && calls[0].body.requestId.length > 0);

  const mockFetchRejected = (async () => {
    return new Response(
      JSON.stringify({ error: { message: 'Usage threshold not reached' } }),
      { status: 412, headers: { 'Content-Type': 'application/json' } },
    );
  }) as typeof fetch;

  const failRes = await antigravityAccountsService.claimBankedQuotaReset('reset-card-2', 'demo@example.com', {
    fetchImpl: mockFetchRejected,
    tokenData: { token: { access_token: 'mock-access-token', expiry: new Date(Date.now() + 3600_000).toISOString() } },
    projectId: 'aicode-consumers',
    email: 'demo@example.com',
  });

  assert.equal(failRes.ok, false);
  assert.equal(failRes.statusCode, 412);
  assert.equal(failRes.error, 'Usage threshold not reached');
});
