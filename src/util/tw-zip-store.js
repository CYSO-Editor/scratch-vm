const textDecoder = new TextDecoder('utf-8');

class StoredZipEntry {
    /**
     * @param {Uint8Array} data decompressed contents of the entry
     * @param {string} name entry name, exposed for parity with JSZipObject
     */
    constructor (data, name) {
        this._data = data;
        this._name = name;
        this._decoded = null;
    }

    get name () {
        return this._name;
    }

    /**
     * Decoded at most once per entry: callers ask for the same document more
     * than once and re-decoding megabyte-sized strings is pure waste.
     * @returns {string}
     */
    text () {
        if (this._decoded === null) {
            this._decoded = textDecoder.decode(this._data);
        }
        return this._decoded;
    }

    /**
     * @param {string} type 'uint8array' (main use), 'string', 'arraybuffer' or 'blob'
     * @returns {*} contents in the requested representation
     */
    read (type) {
        if (type === 'uint8array') {
            return this._data;
        }
        if (type === 'string') {
            return this.text();
        }
        if (type === 'arraybuffer') {
            return this._data.buffer.slice(
                this._data.byteOffset,
                this._data.byteOffset + this._data.byteLength
            );
        }
        // 'blob' and others are not used by the deserializer; return raw data
        // so callers at least get something instead of crashing.
        return this._data;
    }

    /**
     * Mimics JSZipObject.async(), which always hands back a promise even though
     * the data is already in memory.
     * @param {string} type 'uint8array' (main use), 'string', 'arraybuffer' or 'blob'
     * @returns {Promise<*>}
     */
    async (type) {
        return Promise.resolve(this.read(type));
    }
}

class ZipStore {
    /**
     * @param {Map<string, Uint8Array>} files map of file name to decompressed data
     */
    constructor (files) {
        this._files = files instanceof Map ? files : new Map(Object.entries(files));
        this._entries = new Map();
        this._basenames = null;
    }

    /**
     * @param {string} name entry name
     * @returns {StoredZipEntry}
     */
    _entry (name) {
        let entry = this._entries.get(name);
        if (!entry) {
            entry = new StoredZipEntry(this._files.get(name), name);
            this._entries.set(name, entry);
        }
        return entry;
    }

    /**
     * Lazily built index of the trailing path segment of every entry that sits
     * at the archive root or one folder deep. Deeper entries are excluded so the
     * index accepts exactly what a single-optional-folder lookup would accept.
     * @returns {Map<string, string>} basename to full entry name
     */
    _basenameIndex () {
        if (this._basenames) {
            return this._basenames;
        }
        const index = new Map();
        for (const name of this._files.keys()) {
            const firstSlash = name.indexOf('/');
            let basename;
            if (firstSlash === -1) {
                basename = name;
            } else if (name.indexOf('/', firstSlash + 1) === -1) {
                basename = name.slice(firstSlash + 1);
            } else {
                continue;
            }
            // The regexp fallback this replaces returned the first match, so
            // keep the earliest entry when folders repeat a base name.
            if (!index.has(basename)) {
                index.set(basename, name);
            }
        }
        this._basenames = index;
        return index;
    }

    /**
     * Mimics JSZip.file():
     * - with a string: returns the single matching entry or null
     * - with a RegExp: returns an array of all matching entries
     * @param {string|RegExp} nameOrRegex
     * @returns {StoredZipEntry|Array<StoredZipEntry>|null}
     */
    file (nameOrRegex) {
        if (typeof nameOrRegex === 'string') {
            if (!this._files.has(nameOrRegex)) {
                return null;
            }
            return this._entry(nameOrRegex);
        }
        if (nameOrRegex && typeof nameOrRegex.test === 'function') {
            const results = [];
            for (const name of this._files.keys()) {
                // A /g regex carries state between calls to test().
                nameOrRegex.lastIndex = 0;
                if (nameOrRegex.test(name)) {
                    results.push(this._entry(name));
                }
            }
            return results;
        }
        return null;
    }

    /**
     * Resolve an entry that may sit one folder deep, without compiling a regex.
     * @param {string} basename entry name as referenced by the project
     * @returns {?StoredZipEntry}
     */
    getByBasename (basename) {
        if (this._files.has(basename)) {
            return this._entry(basename);
        }
        const fullName = this._basenameIndex().get(basename);
        return fullName === undefined ? null : this._entry(fullName);
    }

    /**
     * @returns {Array<string>} all file names
     */
    getNames () {
        return Array.from(this._files.keys());
    }
}

module.exports = ZipStore;
