const WORKER_SOURCE = `
'use strict';
var DEFLATE_METHOD = 8;
var STORE_METHOD = 0;

// Decompressing every entry at once spikes memory on asset-heavy projects and
// starves the streams that actually matter, so entries are inflated in batches.
var INFLATE_CONCURRENCY = 12;

// Guards against archives that expand to far more memory than they occupy on
// disk. Real projects sit orders of magnitude below these ceilings.
var MAX_ENTRIES = 20000;
var MAX_TOTAL_BYTES = 1024 * 1024 * 1024;
var MAX_ENTRY_BYTES = 256 * 1024 * 1024;

var PROJECT_JSON = 'project.json';

function basename(name) {
    var slash = name.lastIndexOf('/');
    return slash === -1 ? name : name.slice(slash + 1);
}

function findEOCD(view, size) {
    var minOffset = Math.max(0, size - 22 - 65535);
    for (var i = size - 22; i >= minOffset; i--) {
        if (view.getUint32(i, true) === 0x06054b50) {
            return i;
        }
    }
    throw new Error('EOCD not found');
}

function inflateRaw(bytes, expectedSize) {
    var ds = new DecompressionStream('deflate-raw');
    var reader = new Blob([bytes]).stream().pipeThrough(ds).getReader();
    var chunks = [];
    var total = 0;
    return reader.read().then(function readChunk(result) {
        if (result.done) {
            if (total !== expectedSize) {
                throw new Error('Inflated size mismatch: ' + total + ' !== ' + expectedSize);
            }
            var out = new Uint8Array(total);
            var offset = 0;
            for (var i = 0; i < chunks.length; i++) {
                out.set(chunks[i], offset);
                offset += chunks[i].length;
            }
            return out;
        }
        chunks.push(result.value);
        total += result.value.length;
        if (total > expectedSize) {
            reader.cancel();
            throw new Error('Entry exceeded its declared size');
        }
        return reader.read().then(readChunk);
    });
}

function decodeName(bytes, utf8Flag) {
    for (var i = 0; i < bytes.length; i++) {
        if (bytes[i] > 127 && !utf8Flag) {
            // Legacy non-UTF-8 encodings (e.g. CP437) are not supported; the
            // caller will fall back to JSZip which handles them.
            throw new Error('Non-UTF-8 file name in zip');
        }
    }
    return new TextDecoder('utf-8').decode(bytes);
}

function mapWithLimit(items, limit, worker) {
    var results = new Array(items.length);
    var next = 0;
    function run() {
        if (next >= items.length) {
            return Promise.resolve();
        }
        var index = next++;
        return Promise.resolve(worker(items[index])).then(function (value) {
            results[index] = value;
            return run();
        });
    }
    var runners = [];
    for (var i = 0; i < Math.min(limit, items.length); i++) {
        runners.push(run());
    }
    return Promise.all(runners).then(function () {
        return results;
    });
}

self.onmessage = function (event) {
    var id = event.data.id;
    var buffer = event.data.buffer;
    Promise.resolve().then(function () {
        if (!buffer || buffer.byteLength < 22) {
            throw new Error('File is too small to be a zip archive');
        }
        var bytes = new Uint8Array(buffer);
        var view = new DataView(buffer);
        var size = buffer.byteLength;

        var eocdOffset = findEOCD(view, size);
        var totalEntries = view.getUint16(eocdOffset + 10, true);
        var cdSize = view.getUint32(eocdOffset + 12, true);
        var cdOffset = view.getUint32(eocdOffset + 16, true);
        if (totalEntries > MAX_ENTRIES) {
            throw new Error('Archive declares too many entries: ' + totalEntries);
        }
        if (cdOffset + cdSize > size) {
            throw new Error('Central directory out of bounds');
        }

        var files = [];
        var promises = [];
        var transferables = [];
        var budget = MAX_TOTAL_BYTES;

        for (var i = 0; i < totalEntries; i++) {
            if (cdOffset + 46 > size) {
                throw new Error('Central directory truncated at entry ' + i);
            }
            if (view.getUint32(cdOffset, true) !== 0x02014b50) {
                throw new Error('Bad central directory signature at entry ' + i);
            }
            var flags = view.getUint16(cdOffset + 8, true);
            var method = view.getUint16(cdOffset + 10, true);
            var compSize = view.getUint32(cdOffset + 20, true);
            var uncompSize = view.getUint32(cdOffset + 24, true);
            var nameLen = view.getUint16(cdOffset + 28, true);
            var extraLen = view.getUint16(cdOffset + 30, true);
            var commentLen = view.getUint16(cdOffset + 32, true);
            var localOffset = view.getUint32(cdOffset + 42, true);

            var nameEnd = cdOffset + 46 + nameLen;
            if (nameEnd + extraLen + commentLen > size) {
                throw new Error('Central directory entry ' + i + ' runs past the archive');
            }
            var name = decodeName(bytes.subarray(cdOffset + 46, nameEnd), (flags & 0x800) !== 0);

            cdOffset = nameEnd + extraLen + commentLen;

            if (name.charAt(name.length - 1) === '/') {
                continue; // directory entry
            }
            if ((flags & 0x1) !== 0) {
                throw new Error('Encrypted zip entries are not supported');
            }
            if (compSize === 0xFFFFFFFF || uncompSize === 0xFFFFFFFF || localOffset === 0xFFFFFFFF) {
                throw new Error('Zip64 is not supported');
            }
            if (method !== STORE_METHOD && method !== DEFLATE_METHOD) {
                throw new Error('Unsupported compression method: ' + method);
            }
            if (localOffset + 30 > size) {
                throw new Error('Local header out of bounds');
            }
            if (view.getUint32(localOffset, true) !== 0x04034b50) {
                throw new Error('Bad local header signature');
            }
            var localNameLen = view.getUint16(localOffset + 26, true);
            var localExtraLen = view.getUint16(localOffset + 28, true);
            var dataStart = localOffset + 30 + localNameLen + localExtraLen;
            if (dataStart + compSize > size) {
                throw new Error('Compressed data out of bounds');
            }
            if (uncompSize > MAX_ENTRY_BYTES || uncompSize > budget) {
                throw new Error('Archive expands beyond the supported size');
            }
            budget -= uncompSize;

            var compressed = bytes.subarray(dataStart, dataStart + compSize);

            files.push({name: name, method: method, data: compressed, expected: uncompSize});
        }

        // project.json is decoded to a string here so the main thread can
        // validate it without re-unzipping anything.
        var jsonString = null;

        return mapWithLimit(files, INFLATE_CONCURRENCY, function (file) {
            var promise = file.method === STORE_METHOD ?
                Promise.resolve(file.data.slice()) :
                inflateRaw(file.data, file.expected);
            return promise.then(function (data) {
                if (data.length > MAX_ENTRY_BYTES) {
                    throw new Error('Entry expanded beyond the supported size');
                }
                if (basename(file.name) === PROJECT_JSON) {
                    jsonString = new TextDecoder('utf-8').decode(data);
                }
                transferables.push(data.buffer);
                return {name: file.name, data: data};
            });
        }).then(function (results) {
            self.postMessage({id: id, ok: true, json: jsonString, files: results}, transferables);
        });
    }).catch(function (error) {
        self.postMessage({id: id, ok: false, error: String(error && error.message || error)});
    });
};
`;

module.exports = WORKER_SOURCE;
