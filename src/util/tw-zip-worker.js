const WORKER_SOURCE = require('./tw-zip-worker-source');

let worker = null;
let workerUrl = null;
let nextId = 1;
/** @type {Map<number, {resolve: Function; reject: Function; timer: number}>} */
const pending = new Map();

const isSupported = () => (
    typeof Worker !== 'undefined' &&
    typeof Blob !== 'undefined' &&
    typeof URL !== 'undefined' &&
    typeof URL.createObjectURL === 'function' &&
    typeof URL.revokeObjectURL === 'function' &&
    typeof DecompressionStream !== 'undefined'
);

const WORKER_TIMEOUT = 120000;

const failAllPending = error => {
    for (const entry of pending.values()) {
        clearTimeout(entry.timer);
        entry.reject(error);
    }
    pending.clear();
};

const disposeWorker = () => {
    if (worker) {
        try {
            worker.terminate();
        } catch (e) {
            // Terminating an already dead worker is not interesting.
        }
        worker = null;
    }
    if (workerUrl) {
        try {
            URL.revokeObjectURL(workerUrl);
        } catch (e) {
            // Nothing actionable if the URL was already revoked.
        }
        workerUrl = null;
    }
};

const getWorker = () => {
    if (worker) {
        return worker;
    }
    const blob = new Blob([WORKER_SOURCE], {type: 'text/javascript'});
    workerUrl = URL.createObjectURL(blob);
    worker = new Worker(workerUrl);
    worker.onmessage = event => {
        const {id, ok} = event.data;
        const entry = pending.get(id);
        if (!entry) {
            return;
        }
        pending.delete(id);
        clearTimeout(entry.timer);
        if (ok) {
            entry.resolve(event.data);
        } else {
            entry.reject(new Error(event.data.error || 'unknown worker error'));
        }
    };
    worker.onerror = event => {
        // Terminate and discard the broken worker; future loads will spawn a new one.
        failAllPending(new Error(event.message || 'zip worker crashed'));
        disposeWorker();
    };
    return worker;
};

/**
 * Unzip a project archive in a worker thread.
 * The input ArrayBuffer is NOT transferred (it stays valid on failure so the
 * caller can fall back to the main-thread implementation with the same bytes).
 * @param {ArrayBuffer} arrayBuffer the zip archive
 * @returns {Promise<{json: string|null; files: Array<{name: string; data: Uint8Array}>}>}
 */
const unzipProject = arrayBuffer => new Promise((resolve, reject) => {
    if (!isSupported()) {
        reject(new Error('zip worker is not supported in this environment'));
        return;
    }
    let currentWorker;
    try {
        currentWorker = getWorker();
    } catch (error) {
        reject(error);
        return;
    }
    const id = nextId++;
    const entry = {
        resolve,
        reject,
        timer: setTimeout(() => {
            pending.delete(id);
            reject(new Error('zip worker timed out'));
        }, WORKER_TIMEOUT)
    };
    pending.set(id, entry);
    // Deliberately not transferring the buffer: on failure we want to retry on
    // the main thread with the same bytes.
    currentWorker.postMessage({id, buffer: arrayBuffer});
});

module.exports = {
    isSupported,
    unzipProject
};
