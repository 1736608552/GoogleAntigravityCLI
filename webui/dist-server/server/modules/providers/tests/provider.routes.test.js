import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import express from 'express';
import { closeConnection, initializeDatabase, sessionsDb } from '../../../modules/database/index.js';
import providerRouter from '../../../modules/providers/provider.routes.js';
import { AppError } from '../../../shared/utils.js';
async function withProviderServer(run) {
    const previousDatabasePath = process.env.DATABASE_PATH;
    const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'provider-routes-'));
    closeConnection();
    process.env.DATABASE_PATH = path.join(tempDirectory, 'auth.db');
    await writeFile(process.env.DATABASE_PATH, '');
    await initializeDatabase();
    const app = express().use(express.json()).use('/api/providers', providerRouter);
    app.use((error, _req, res, _next) => {
        if (error instanceof AppError) {
            res.status(error.statusCode).json({
                success: false,
                error: { code: error.code, message: error.message },
            });
            return;
        }
        res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR' } });
    });
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    try {
        const address = server.address();
        await run(`http://127.0.0.1:${address.port}`, path.join(tempDirectory, 'workspace'));
    }
    finally {
        await new Promise((resolve, reject) => {
            server.close((error) => error ? reject(error) : resolve());
        });
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
test('session creation route names a CloudCLI session from the initial message', async () => {
    await withProviderServer(async (baseUrl, workspacePath) => {
        const response = await fetch(`${baseUrl}/api/providers/sessions`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                provider: 'codex',
                projectPath: workspacePath,
                initialMessage: 'abcd  efg\nhij klm nop',
            }),
        });
        const payload = await response.json();
        assert.equal(response.status, 201);
        assert.equal(payload.data.sessionName, 'abcd efg hij klm');
        assert.equal(sessionsDb.getSessionById(payload.data.sessionId)?.custom_name, 'abcd efg hij klm');
    });
});
test('conversation search streams title matches before transcript results', async () => {
    await withProviderServer(async (baseUrl, workspacePath) => {
        sessionsDb.createAppSession('title-only-session', 'codex', workspacePath, 'Release planning notes');
        const transcriptPath = path.join(path.dirname(workspacePath), 'codex-search.jsonl');
        await writeFile(transcriptPath, `${JSON.stringify({
            type: 'event_msg',
            timestamp: '2026-08-12T09:00:00.000Z',
            payload: {
                type: 'user_message',
                kind: 'plain',
                message: 'Release planning also appears in this conversation.',
            },
        })}\n`);
        sessionsDb.createSession('transcript-session', 'codex', workspacePath, 'Unrelated session', undefined, undefined, transcriptPath);
        const response = await fetch(`${baseUrl}/api/providers/search/sessions?q=release%20planning&limit=50`);
        const eventStream = await response.text();
        const titleEventIndex = eventStream.indexOf('event: title-results');
        const conversationEventIndex = eventStream.indexOf('event: result');
        const doneEventIndex = eventStream.indexOf('event: done');
        assert.equal(response.status, 200);
        assert.ok(titleEventIndex >= 0);
        assert.ok(conversationEventIndex > titleEventIndex);
        assert.ok(doneEventIndex > titleEventIndex);
        const titleDataLine = eventStream
            .slice(titleEventIndex, conversationEventIndex)
            .split('\n')
            .find((line) => line.startsWith('data: '));
        assert.ok(titleDataLine);
        const titlePayload = JSON.parse(titleDataLine.slice('data: '.length));
        assert.equal(titlePayload.titleResults.length, 1);
        assert.equal(titlePayload.titleResults[0]?.sessionId, 'title-only-session');
        assert.equal(titlePayload.titleResults[0]?.sessionTitle, 'Release planning notes');
        assert.equal(titlePayload.titleResults[0]?.provider, 'codex');
    });
});
test('reasoning effort is persisted and returned with the active session model', async () => {
    await withProviderServer(async (baseUrl, workspacePath) => {
        sessionsDb.createAppSession('effort-session', 'antigravity', workspacePath);
        const updateResponse = await fetch(`${baseUrl}/api/providers/antigravity/sessions/effort-session/active-effort`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ effort: 'high' }),
        });
        const updatePayload = await updateResponse.json();
        assert.equal(updateResponse.status, 200);
        assert.equal(updatePayload.data.effort, 'high');
        assert.equal(sessionsDb.getSessionById('effort-session')?.effort, 'high');
        const readResponse = await fetch(`${baseUrl}/api/providers/antigravity/sessions/effort-session/active-model`);
        const readPayload = await readResponse.json();
        assert.equal(readResponse.status, 200);
        assert.equal(readPayload.data.sessionId, 'effort-session');
        assert.equal(readPayload.data.effort, 'high');
    });
});
test('model routes expose immutable defaults and full custom model CRUD', async () => {
    await withProviderServer(async (baseUrl) => {
        const initialResponse = await fetch(`${baseUrl}/api/providers/antigravity/models`);
        const initialPayload = await initialResponse.json();
        assert.equal(initialResponse.status, 200);
        assert.equal('cache' in initialPayload.data, false);
        const predefined = initialPayload.data.models.OPTIONS[0];
        assert.equal(predefined.isCustom, false);
        assert.equal(predefined.recordId, undefined);
        const createResponse = await fetch(`${baseUrl}/api/providers/antigravity/models`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ model: 'Gateway GPT', id: 'gateway/gpt' }),
        });
        const createPayload = await createResponse.json();
        assert.equal(createResponse.status, 201);
        assert.equal(createPayload.data.model.isCustom, true);
        const customRecordId = createPayload.data.model.recordId;
        const updateResponse = await fetch(`${baseUrl}/api/providers/antigravity/models/${customRecordId}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ model: 'Gateway GPT Updated', id: 'gateway/gpt-v2' }),
        });
        const updatePayload = await updateResponse.json();
        assert.equal(updateResponse.status, 200);
        assert.equal(updatePayload.data.model.value, 'gateway/gpt-v2');
        assert.equal(updatePayload.data.model.label, 'Gateway GPT Updated');
        const immutableResponse = await fetch(`${baseUrl}/api/providers/antigravity/models/999999`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ model: 'Changed', id: 'changed' }),
        });
        const immutablePayload = await immutableResponse.json();
        assert.equal(immutableResponse.status, 404);
        assert.equal(immutablePayload.error.code, 'MODEL_NOT_FOUND');
        const deleteResponse = await fetch(`${baseUrl}/api/providers/antigravity/models/${customRecordId}`, { method: 'DELETE' });
        const deletePayload = await deleteResponse.json();
        assert.equal(deleteResponse.status, 200);
        assert.equal(deletePayload.data.models.OPTIONS.some((option) => option.recordId === customRecordId), false);
    });
});
//# sourceMappingURL=provider.routes.test.js.map