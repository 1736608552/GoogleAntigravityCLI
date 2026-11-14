import { scheduledMessagesDb, sessionDraftsDb } from '../../../modules/database/index.js';
import { chatRunRegistry, onRunSettled, runDetachedChatTurn } from '../../../modules/websocket/index.js';
/**
 * How often due messages are looked for.
 *
 * A minute is the granularity the composer offers, and a claim is indexed on
 * `(status, scheduled_for)`, so the poll is one cheap query. Anything finer
 * would buy precision nobody asked for.
 *
 * Queued messages do not wait for this: they are also dispatched the moment
 * the run that blocked them settles (see `unsubscribeRunSettled` below). The
 * poll remains their safety net for the cases no run-settled event covers —
 * a message queued while nothing was running, or one left behind by a server
 * restart.
 */
const POLL_INTERVAL_MS = 30_000;
let pollTimer = null;
let unsubscribeRunSettled = null;
let dispatchInFlight = false;
function readOptions(raw) {
    try {
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            ? parsed
            : {};
    }
    catch {
        return {};
    }
}
function readQueuedMessage(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return null;
    }
    const record = value;
    const content = typeof record.content === 'string' ? record.content : '';
    const attachments = Array.isArray(record.attachments)
        ? record.attachments
        : Array.isArray(record.images)
            ? record.images
            : [];
    if (!content.trim() && attachments.length === 0) {
        return null;
    }
    const options = record.options && typeof record.options === 'object' && !Array.isArray(record.options)
        ? record.options
        : {};
    return { content, options, attachments };
}
async function sendClaimedQueuedMessage(candidate, runtime) {
    const message = readQueuedMessage(candidate.queuedMessage);
    if (!message) {
        sessionDraftsDb.deleteEmptyDraft(candidate.userId, candidate.sessionId);
        return;
    }
    const result = await runDetachedChatTurn({
        sessionId: candidate.sessionId,
        userId: candidate.userId,
        content: message.content,
        options: { ...message.options, attachments: message.attachments },
    }, { runtime });
    // The registry check and run reservation are separate operations. If a run
    // wins that tiny race, put the turn back so the next poll tries again.
    if (!result.started && result.error === 'A run was already in progress for this session.') {
        sessionDraftsDb.restoreQueuedMessage(candidate);
        return;
    }
    sessionDraftsDb.deleteEmptyDraft(candidate.userId, candidate.sessionId);
}
/**
 * Sends every persisted queued turn whose session is currently idle.
 *
 * With a `sessionId`, only that session's queued turn is looked at: a run that
 * settles can only have unblocked its own session.
 */
export async function dispatchQueuedMessages(runtime, sessionId) {
    const candidates = sessionDraftsDb.listQueuedMessages(sessionId);
    let claimed = 0;
    await Promise.all(candidates.map(async (candidate) => {
        if (chatRunRegistry.isProcessing(candidate.sessionId)) {
            return;
        }
        if (!sessionDraftsDb.claimQueuedMessage(candidate)) {
            return;
        }
        claimed += 1;
        await sendClaimedQueuedMessage(candidate, runtime);
    }));
    return claimed;
}
async function sendClaimedMessage(row, runtime) {
    try {
        const result = await runDetachedChatTurn({
            sessionId: row.session_id,
            userId: row.user_id,
            content: row.content,
            options: readOptions(row.options),
            // The user picked this time on purpose; a run that happens to be going
            // is aborted so the scheduled message lands when it was due, instead
            // of being recorded as "not sent — session was busy".
            interruptActiveRun: true,
        }, { runtime });
        // Recorded rather than retried, and recorded whether the run never started
        // (deleted session, unavailable provider) or started and then failed.
        // Silently dropping a message the user scheduled is worse than telling
        // them it did not go.
        if (!result.started || result.error) {
            scheduledMessagesDb.markFailed(row.id, result.error ?? 'The session was unavailable when this was due.');
        }
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        scheduledMessagesDb.markFailed(row.id, message);
    }
}
/**
 * Sends every message whose time has come.
 *
 * Exported so a test can drive one pass without waiting on the timer.
 */
export async function dispatchDueScheduledMessages(runtime, now = new Date()) {
    // Claimed before any of them runs, so a long turn cannot let the next poll
    // pick the same message up again.
    const due = scheduledMessagesDb.claimDue(now);
    if (due.length === 0) {
        return 0;
    }
    // Sequentially: a session can only have one run at a time, and two due
    // messages for the same session must not race each other into it.
    for (const row of due) {
        await sendClaimedMessage(row, runtime);
    }
    return due.length;
}
/**
 * Starts the poll that sends scheduled messages.
 *
 * The schedule lives in the database, so a message stays scheduled across a
 * restart and one that came due while the server was down is sent on the first
 * poll after it comes back, rather than being skipped.
 */
export function initializeScheduledMessageDispatcher(runtime) {
    if (pollTimer) {
        return;
    }
    const poll = () => {
        // A pass that overruns the interval must not be started again underneath
        // itself; the claim is transactional but the runs are not.
        if (dispatchInFlight) {
            return;
        }
        dispatchInFlight = true;
        void dispatchDueScheduledMessages(runtime)
            .then(() => dispatchQueuedMessages(runtime))
            .catch((error) => {
            const message = error instanceof Error ? error.message : String(error);
            console.error('[ScheduledMessages] Dispatch pass failed', { error: message });
        })
            .finally(() => {
            dispatchInFlight = false;
        });
    };
    pollTimer = setInterval(poll, POLL_INTERVAL_MS);
    // Never keep the process alive just to poll for scheduled messages.
    pollTimer.unref?.();
    // A message queued during a turn is sent as soon as that turn ends.
    unsubscribeRunSettled = onRunSettled((appSessionId) => {
        void dispatchQueuedMessages(runtime, appSessionId).catch((error) => {
            const message = error instanceof Error ? error.message : String(error);
            console.error('[ScheduledMessages] run-settled dispatch failed', { error: message });
        });
    });
    // Catch up on anything that came due while the server was not running.
    poll();
}
export function closeScheduledMessageDispatcher() {
    if (unsubscribeRunSettled) {
        unsubscribeRunSettled();
        unsubscribeRunSettled = null;
    }
    if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
    }
}
//# sourceMappingURL=scheduled-message-dispatcher.service.js.map