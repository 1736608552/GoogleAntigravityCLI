import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { closeConnection, initializeDatabase, sessionsDb } from '../../../modules/database/index.js';
import { AntigravitySessionsProvider } from '../../../modules/providers/list/antigravity/antigravity-sessions.provider.js';
import { AntigravitySessionSynchronizer } from '../../../modules/providers/list/antigravity/antigravity-session-synchronizer.provider.js';
async function withIsolatedDatabase(runTest) {
    const previousDatabasePath = process.env.DATABASE_PATH;
    const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'antigravity-provider-db-'));
    const databasePath = path.join(tempDirectory, 'test.db');
    closeConnection();
    process.env.DATABASE_PATH = databasePath;
    await initializeDatabase();
    try {
        await runTest();
    }
    finally {
        closeConnection();
        if (previousDatabasePath === undefined) {
            delete process.env.DATABASE_PATH;
        }
        else {
            process.env.DATABASE_PATH = previousDatabasePath;
        }
        await rm(tempDirectory, { recursive: true, force: true });
    }
}
test('AntigravitySessionsProvider: strips ADDITIONAL_METADATA and USER_SETTINGS_CHANGE from user input', async () => {
    await withIsolatedDatabase(async () => {
        const tempHome = await mkdtemp(path.join(os.tmpdir(), 'antigravity-home-'));
        const previousHome = process.env.AGY_HOME;
        process.env.AGY_HOME = tempHome;
        try {
            const convId = 'test-conv-1234';
            const brainDir = path.join(tempHome, '.gemini', 'antigravity-cli', 'brain', convId, '.system_generated', 'logs');
            await mkdir(brainDir, { recursive: true });
            const transcriptContent = [
                JSON.stringify({
                    step_index: 0,
                    source: 'USER_EXPLICIT',
                    type: 'USER_INPUT',
                    status: 'DONE',
                    created_at: '2026-09-16T04:56:38Z',
                    content: '<USER_REQUEST>\n测试\n</USER_REQUEST>\n<ADDITIONAL_METADATA>\nThe current local time is: 2026-09-16T00:56:38-04:00.\n</ADDITIONAL_METADATA>\n<USER_SETTINGS_CHANGE>\nThe user changed setting `Model Selection` from None to Gemini 3.8 Flash (High).\n</USER_SETTINGS_CHANGE>',
                }),
                JSON.stringify({
                    step_index: 1,
                    source: 'MODEL',
                    type: 'PLANNER_RESPONSE',
                    status: 'DONE',
                    created_at: '2026-09-16T04:56:38Z',
                    content: '收到，测试正常！',
                }),
                JSON.stringify({
                    step_index: 2,
                    source: 'USER_EXPLICIT',
                    type: 'USER_INPUT',
                    status: 'DONE',
                    created_at: '2026-09-16T05:25:13Z',
                    content: '<USER_REQUEST>\n你好世界\n</USER_REQUEST>\n<ADDITIONAL_METADATA>\nThe current local time is: 2026-09-16T01:25:13-04:00.\n</ADDITIONAL_METADATA>',
                }),
            ].join('\n');
            const logFile = path.join(brainDir, 'transcript.jsonl');
            await writeFile(logFile, transcriptContent, 'utf-8');
            sessionsDb.createSession('app-session-1', 'antigravity', '/workspace', 'Test Antigravity Session', new Date().toISOString(), new Date().toISOString(), logFile);
            // Map provider session id
            sessionsDb.assignProviderSessionId('app-session-1', convId);
            const provider = new AntigravitySessionsProvider();
            const result = await provider.fetchHistory('app-session-1');
            assert.equal(result.messages.length, 3);
            assert.equal(result.messages[0].role, 'user');
            assert.equal(result.messages[0].content, '测试');
            assert.ok(!result.messages[0].content.includes('ADDITIONAL_METADATA'));
            assert.ok(!result.messages[0].content.includes('USER_SETTINGS_CHANGE'));
            assert.equal(result.messages[1].role, 'assistant');
            assert.equal(result.messages[1].content, '收到，测试正常！');
            assert.equal(result.messages[2].role, 'user');
            assert.equal(result.messages[2].content, '你好世界');
            assert.ok(!result.messages[2].content.includes('ADDITIONAL_METADATA'));
            // Also verify session synchronizer extracts clean session title
            const synchronizer = new AntigravitySessionSynchronizer();
            const synced = await synchronizer.synchronize();
            assert.ok(synced >= 1);
            const syncedSession = sessionsDb.getSessionById('app-session-1');
            assert.ok(syncedSession);
            assert.equal(syncedSession.custom_name, 'Test Antigravity Session');
            // Test a new discovered session
            const newConvId = 'test-conv-5678';
            const newBrainDir = path.join(tempHome, '.gemini', 'antigravity-cli', 'brain', newConvId, '.system_generated', 'logs');
            await mkdir(newBrainDir, { recursive: true });
            await writeFile(path.join(newBrainDir, 'transcript.jsonl'), transcriptContent, 'utf-8');
            const syncedCount = await synchronizer.synchronize();
            assert.ok(syncedCount >= 1);
            const newSession = sessionsDb.getSessionById(newConvId);
            assert.ok(newSession);
            // Test chunk synchronization: an incremental chunk without user prompt must NOT overwrite title or jsonl_path
            const chunkDir = path.join(newBrainDir, 'chunks', 'transcript');
            await mkdir(chunkDir, { recursive: true });
            const chunkPath = path.join(chunkDir, '00000005.jsonl');
            await writeFile(chunkPath, JSON.stringify({
                step_index: 5,
                source: 'MODEL',
                type: 'PLANNER_RESPONSE',
                status: 'DONE',
                created_at: '2026-09-16T06:00:00Z',
                content: 'Working on it...',
            }), 'utf-8');
            const chunkSyncedId = await synchronizer.synchronizeFile(chunkPath);
            assert.equal(chunkSyncedId, newConvId);
            const afterChunkSession = sessionsDb.getSessionById(newConvId);
            assert.ok(afterChunkSession);
            assert.equal(afterChunkSession.custom_name, '测试');
            assert.ok(!afterChunkSession.jsonl_path?.includes('/chunks/'));
            // Test sessionsDb.createSession fallback protection directly:
            // A generic name like 'Antigravity test-con' must NOT overwrite existing '测试'
            sessionsDb.createSession(newConvId, 'antigravity', '/workspace', 'Antigravity test-con', undefined, undefined, chunkPath);
            const afterDirectUpsert = sessionsDb.getSessionById(newConvId);
            assert.ok(afterDirectUpsert);
            assert.equal(afterDirectUpsert.custom_name, '测试');
            assert.ok(!afterDirectUpsert.jsonl_path?.includes('/chunks/'));
            // Test upgrading from generic fallback name to real name:
            const fallbackConvId = 'test-conv-9999';
            sessionsDb.createSession(fallbackConvId, 'antigravity', '/workspace', 'Antigravity test-999', undefined, undefined, null);
            assert.equal(sessionsDb.getSessionById(fallbackConvId)?.custom_name, 'Antigravity test-999');
            // Now a real name arrives:
            sessionsDb.createSession(fallbackConvId, 'antigravity', '/workspace', '用户真正的主题', undefined, undefined, null);
            assert.equal(sessionsDb.getSessionById(fallbackConvId)?.custom_name, '用户真正的主题');
            // Now another fallback attempt arrives: it must NOT degrade back to fallback:
            sessionsDb.createSession(fallbackConvId, 'antigravity', '/workspace', 'Antigravity test-999', undefined, undefined, null);
            assert.equal(sessionsDb.getSessionById(fallbackConvId)?.custom_name, '用户真正的主题');
            // Test session renaming persistence:
            // When a user renames a session, synchronizer and createSession must NOT revert it back to log prompt
            sessionsDb.updateSessionCustomName(newConvId, '我的自定义重命名');
            assert.equal(sessionsDb.getSessionById(newConvId)?.custom_name, '我的自定义重命名');
            await synchronizer.synchronize();
            assert.equal(sessionsDb.getSessionById(newConvId)?.custom_name, '我的自定义重命名');
            await synchronizer.synchronizeFile(path.join(newBrainDir, 'transcript.jsonl'));
            assert.equal(sessionsDb.getSessionById(newConvId)?.custom_name, '我的自定义重命名');
        }
        finally {
            if (previousHome === undefined) {
                delete process.env.AGY_HOME;
            }
            else {
                process.env.AGY_HOME = previousHome;
            }
            await rm(tempHome, { recursive: true, force: true });
        }
    });
});
test('deleteOrArchiveSessionById: seamlessly aborts and cleans up Antigravity session processes', async () => {
    await withIsolatedDatabase(async () => {
        const { sessionsService } = await import('../../../modules/providers/services/sessions.service.js');
        const { antigravityRuntime } = await import('../../../modules/providers/list/antigravity/antigravity-runtime.provider.js');
        const appSessionId = 'test-app-session-uuid-1';
        const providerSessionId = '04c253f6-test-uuid-antigravity';
        sessionsDb.createSession(appSessionId, 'antigravity', '/vol1/test', 'Test Antigravity Session', undefined, undefined, null);
        sessionsDb.assignProviderSessionId(appSessionId, providerSessionId);
        // 验证调用 abort 接口时对于不存在或已退出的进程安全幂等处理
        const abortResult = antigravityRuntime.abort(providerSessionId);
        assert.equal(typeof abortResult, 'boolean');
        // 执行彻底删除会话
        const deleteResult = await sessionsService.deleteOrArchiveSessionById(appSessionId, {
            force: true,
            deletedFromDisk: false,
        });
        assert.equal(deleteResult.sessionId, appSessionId);
        assert.equal(deleteResult.action, 'deleted');
        assert.equal(sessionsDb.getSessionById(appSessionId), null);
    });
});
//# sourceMappingURL=antigravity-sessions.test.js.map