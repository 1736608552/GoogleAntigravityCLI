import { sessionsDb } from '../../../modules/database/index.js';
import { ChatSessionWriter } from '../../../modules/websocket/services/chat-session-writer.service.js';
import { broadcastSessionUpserted } from '../../../modules/websocket/services/session-upsert-broadcast.service.js';
/**
 * How long a completed run stays available for replay. Covers the window
 * between a run finishing and the client refreshing history over REST (for
 * example when the browser tab was asleep while the run completed).
 */
const COMPLETED_RUN_RETENTION_MS = 5 * 60 * 1000;
/**
 * Upper bound on buffered events per run so a very long tool-heavy run cannot
 * grow memory unbounded. When exceeded, the oldest events are dropped —
 * a reconnecting client whose `lastSeq` predates the buffer falls back to a
 * REST history refresh, which is always the authoritative source.
 */
const MAX_BUFFERED_EVENTS_PER_RUN = 5000;
/**
 * Active and recently-completed runs keyed by app session id.
 *
 * This map is the single in-memory source of truth for "is something running
 * for this session" — the chat websocket handler, abort path, and subscribe
 * path all consult it instead of asking each provider runtime individually.
 */
const runs = new Map();
function evictRunLater(appSessionId) {
    const timer = setTimeout(() => {
        const run = runs.get(appSessionId);
        if (run && run.status === 'completed') {
            runs.delete(appSessionId);
        }
    }, COMPLETED_RUN_RETENTION_MS);
    // Never keep the process alive just to evict a buffered run.
    timer.unref?.();
}
/**
 * Decorates one outbound live event for a run and records it in the event log.
 *
 * Responsibilities:
 * 1. Remap `sessionId` (and `actualSessionId` on `complete`) to the stable
 *    app session id — provider-native ids never leave the backend.
 * 2. Assign the next `seq` so clients can detect/replay gaps.
 * 3. Buffer the event for `chat.subscribe` replay.
 * 4. Flip the run to `completed` when the terminal `complete` event passes by.
 */
function decorateAndRecordEvent(run, message) {
    // Exactly-one-complete contract: when a run is aborted the chat handler
    // emits the terminal `complete` immediately, but the killed runtime may
    // still emit its own `complete` from its exit handler moments later.
    // Whichever arrives first wins; the duplicate is dropped here.
    if (message.kind === 'complete' && run.status === 'completed') {
        return null;
    }
    run.lastSeq += 1;
    const outbound = {
        ...message,
        sessionId: run.appSessionId,
        seq: run.lastSeq,
    };
    if (message.kind === 'complete') {
        // The provider may report its own id here; the frontend only ever knows
        // the app id, so the "actual" id is by definition the app id as well.
        outbound.actualSessionId = run.appSessionId;
        run.status = 'completed';
        run.completedAt = Date.now();
        evictRunLater(run.appSessionId);
        notifyRunSettled(run.appSessionId);
    }
    run.events.push(outbound);
    if (run.events.length > MAX_BUFFERED_EVENTS_PER_RUN) {
        run.events.splice(0, run.events.length - MAX_BUFFERED_EVENTS_PER_RUN);
    }
    return outbound;
}
/**
 * Records the provider-native session id for a run and persists the
 * app-id-to-provider-id mapping so history fetches and future resumes can
 * address the provider transcript.
 *
 * Called from the gateway writer when the runtime either calls
 * `setSessionId(...)` or emits its `session_created` event — whichever
 * happens first wins; later calls with the same id are no-ops.
 */
function recordProviderSessionId(run, providerSessionId) {
    if (!providerSessionId || run.providerSessionId === providerSessionId) {
        return;
    }
    run.providerSessionId = providerSessionId;
    try {
        sessionsDb.assignProviderSessionId(run.appSessionId, providerSessionId);
        void broadcastSessionUpserted(run.appSessionId).catch((error) => {
            const message = error instanceof Error ? error.message : String(error);
            console.error('[ChatRunRegistry] Failed to broadcast canonical session mapping', {
                appSessionId: run.appSessionId,
                providerSessionId,
                error: message,
            });
        });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error('[ChatRunRegistry] Failed to persist provider session id mapping', {
            appSessionId: run.appSessionId,
            providerSessionId,
            error: message,
        });
    }
}
/**
 * Registry of live provider runs keyed by the stable app session id.
 *
 * The registry is what makes the websocket protocol provider-independent:
 * every run gets a `ChatSessionWriter` that remaps provider-native session
 * ids to the app id, assigns `seq` numbers, and buffers events for replay —
 * regardless of which provider runtime produced them.
 */
export const chatRunRegistry = {
    /**
     * Starts tracking a run and returns it, or `null` when a run is already in
     * progress for the session (callers must reject the duplicate send).
     */
    startRun(input) {
        const existing = runs.get(input.appSessionId);
        if (existing && existing.status === 'running') {
            return null;
        }
        const run = {
            appSessionId: input.appSessionId,
            provider: input.provider,
            providerSessionId: input.providerSessionId,
            status: 'running',
            lastSeq: 0,
            events: [],
            writer: null,
            startedAt: Date.now(),
            completedAt: null,
        };
        run.writer = new ChatSessionWriter({
            connection: input.connection,
            userId: input.userId,
            provider: input.provider,
            providerSessionId: input.providerSessionId,
            onProviderSessionId: (providerSessionId) => {
                recordProviderSessionId(run, providerSessionId);
            },
            decorateOutboundEvent: (message) => decorateAndRecordEvent(run, message),
        });
        runs.set(input.appSessionId, run);
        return run;
    },
    getRun(appSessionId) {
        return runs.get(appSessionId);
    },
    isProcessing(appSessionId) {
        return runs.get(appSessionId)?.status === 'running';
    },
    listRunningRuns() {
        return Array.from(runs.values())
            .filter((run) => run.status === 'running')
            .map((run) => ({
            sessionId: run.appSessionId,
            provider: run.provider,
            startedAt: run.startedAt,
            lastSeq: run.lastSeq,
        }));
    },
    /**
     * Adds a websocket connection to a run's live audience.
     *
     * This is the generic replacement for the Claude-only writer reconnect:
     * after a page refresh the new socket subscribes and immediately starts
     * receiving the still-running stream, for every provider.
     *
     * Subscribing does not take the stream away from sockets that were already
     * watching — a session open in two places stays live in both, and the
     * refreshed tab's abandoned socket is dropped when the next event finds it
     * closed. Replay stays per-connection because each client sends its own
     * `lastSeq` with `chat.subscribe`.
     */
    attachConnection(appSessionId, connection) {
        const run = runs.get(appSessionId);
        if (!run) {
            return false;
        }
        run.writer.updateWebSocket(connection);
        return true;
    },
    /**
     * Returns buffered events with `seq` greater than `afterSeq` for replay.
     *
     * An empty array with `run.lastSeq > afterSeq` not covered by the buffer
     * means the buffer was truncated; the client should refresh over REST.
     */
    replayEvents(appSessionId, afterSeq) {
        const run = runs.get(appSessionId);
        if (!run) {
            return [];
        }
        return run.events.filter((event) => typeof event.seq === 'number' && event.seq > afterSeq);
    },
    /**
     * Emits a synthetic terminal `complete` if (and only if) the run is still
     * marked running. Used when a provider runtime throws or resolves without
     * having produced its own terminal event, and by the abort path.
     */
    completeRun(appSessionId, opts) {
        const run = runs.get(appSessionId);
        if (!run || run.status !== 'running') {
            return;
        }
        run.writer.sendComplete(opts);
    },
    /**
     * Safety-net variant of `completeRun` scoped to one specific run: a no-op
     * unless `run` is still the session's current, running run. A runtime
     * promise can resolve after its own `complete` already streamed AND a new
     * run has replaced it in the registry (a queued message sends within
     * milliseconds of the previous turn ending) — the session-keyed
     * `completeRun` would terminate that newer run.
     */
    completeRunIfCurrent(run, opts) {
        if (runs.get(run.appSessionId) !== run || run.status !== 'running') {
            return;
        }
        run.writer.sendComplete(opts);
    },
    /**
     * Test-only escape hatch: clears every tracked run.
     */
    clearAll() {
        runs.clear();
    },
};
/**
 * Fired when a run reaches its terminal `complete` and the session goes idle.
 *
 * The queued-message dispatcher subscribes so a message the user queued during
 * a turn is sent as soon as that turn ends, instead of waiting for the next
 * poll. Listeners run on a microtask so a throwing subscriber cannot break the
 * event that settled the run.
 */
const settledListeners = new Set();
export function onRunSettled(listener) {
    settledListeners.add(listener);
    return () => {
        settledListeners.delete(listener);
    };
}
function notifyRunSettled(appSessionId) {
    for (const listener of settledListeners) {
        queueMicrotask(() => {
            // Unsubscribed between the settle and this microtask: stay quiet.
            if (!settledListeners.has(listener)) {
                return;
            }
            try {
                listener(appSessionId);
            }
            catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                console.error('[ChatRunRegistry] run-settled listener failed', { error: message });
            }
        });
    }
}
//# sourceMappingURL=chat-run-registry.service.js.map