const ScratchCommon = require('./tw-extension-api-common');
const createScratchX = require('./tw-scratchx-compatibility-layer');
const AsyncLimiter = require('../util/async-limiter');
const createTranslate = require('./tw-l10n');
const staticFetch = require('../util/tw-static-fetch');

let currentExtensionId = null;
const usedExtensionIds = new Set();

let runtimeToken = null;
const claimRuntimeToken = () => {
    if (runtimeToken) return;
    if (typeof EditorPreload !== 'undefined' && typeof EditorPreload.claimExtensionRuntime === 'function') {
        runtimeToken = EditorPreload.claimExtensionRuntime();
    }
};

const allocateExtensionId = (baseId) => {
    if (!usedExtensionIds.has(baseId)) {
        usedExtensionIds.add(baseId);
        return baseId;
    }
    let n = 1;
    let candidate;
    do {
        candidate = `${baseId}#${n}`;
        n++;
    } while (usedExtensionIds.has(candidate));
    usedExtensionIds.add(candidate);
    return candidate;
};

const getCurrentExtensionId = () => currentExtensionId;
const setCurrentExtensionId = id => {
    currentExtensionId = id;
};

const setCurrentExtensionInfo = (id) => {
    currentExtensionId = id;
    if (typeof EditorPreload !== 'undefined' && typeof EditorPreload.setActiveExtensionId === 'function') {
        EditorPreload.setActiveExtensionId(runtimeToken, id);
    }
};

const tagExtensionBlocks = (extensionObject, info, extId) => {
    const blocks = (info && info.blocks) || [];
    for (const b of blocks) {
        const opcode = b && b.opcode;
        if (opcode && typeof extensionObject[opcode] === 'function') {
            const original = extensionObject[opcode];
            extensionObject[opcode] = function (...args) {
                if (typeof EditorPreload !== 'undefined' && typeof EditorPreload.pushActiveExtensionId === 'function') {
                    EditorPreload.pushActiveExtensionId(runtimeToken, extId);
                }
                currentExtensionId = extId;
                let result;
                try {
                    result = original.apply(this, args);
                } finally {
                    const cleanup = () => {
                        if (typeof EditorPreload !== 'undefined' && typeof EditorPreload.popActiveExtensionId === 'function') {
                            EditorPreload.popActiveExtensionId(runtimeToken);
                        }
                    };
                    if (result && typeof result.then === 'function') {
                        result.then(cleanup, cleanup);
                    } else {
                        cleanup();
                    }
                }
                return result;
            };
        }
    }
};

const PERMISSION_TYPES = {
    FILE_READ: 'file-read',
    FILE_WRITE: 'file-write',
    FILE_DELETE: 'file-delete',
    FILE_METADATA: 'file-metadata',
    SYSTEM_COMMAND: 'system-command',
    GLOBAL_SHORTCUT: 'global-shortcut',
    DRAW_WINDOW: 'draw-window',
    SCREEN_CAPTURE: 'screen-capture',
    ADVANCED_WINDOW: 'advanced-window',
    HARDWARE_STATUS: 'hardware-status',
    SYSTEM_NOTIFICATION: 'system-notification',
    CLIPBOARD_READ: 'clipboard-read',
    CLIPBOARD_WRITE: 'clipboard-write',
    DEVICE_CAMERA: 'device-camera',
    DEVICE_MICROPHONE: 'device-microphone',
    DEVICE_GEOLOCATION: 'device-geolocation'
};

/* eslint-disable require-await */

const parseURL = url => {
    try {
        return new URL(url, location.href);
    } catch (e) {
        return null;
    }
};

const setupUnsandboxedExtensionAPI = vm => new Promise(resolve => {
    claimRuntimeToken();

    const extensionObjects = [];
    
    const register = (extensionObject, declaredPermissions = null) => {
        extensionObjects.push(extensionObject);
        const info = extensionObject.getInfo();
        if (info && info.id) {
            const extId = allocateExtensionId(info.id);
            info.id = extId;
            const extName = info.name || extId;
            const permissions = declaredPermissions || info.permissions || [];
            
        setCurrentExtensionInfo(extId, extName, permissions);

        tagExtensionBlocks(extensionObject, info, extId);
        
        if (vm.securityManager.registerExtension) {
          vm.securityManager.registerExtension(extId, extName, permissions);
        }

        if (typeof EditorPreload !== 'undefined' && typeof EditorPreload.registerExtensionPermissions === 'function') {
          EditorPreload.registerExtensionPermissions(runtimeToken, extId, permissions, extName).catch(() => {});
        }
        }
        resolve(extensionObjects);
    };

    const Scratch = Object.assign({}, global.Scratch || {}, ScratchCommon);
    
    Scratch.PERMISSION_TYPES = PERMISSION_TYPES;
    
    Scratch.extensions = {
        unsandboxed: true,
        register
    };
    Scratch.vm = vm;
    Scratch.renderer = vm.runtime.renderer;

    const wrapWithExtensionId = (fn, permissionType) => {
        return async (...args) => {
            const extId = getCurrentExtensionId();
            if (extId && vm.securityManager.setCurrentExtensionId) {
                vm.securityManager.setCurrentExtensionId(extId);
            }
            return fn(...args);
        };
    };

    Scratch.canFetch = wrapWithExtensionId(async url => {
        const parsed = parseURL(url);
        if (!parsed) {
            return false;
        }
        // Always allow protocols that don't involve a remote request.
        if (parsed.protocol === 'blob:' || parsed.protocol === 'data:') {
            return true;
        }
        return vm.securityManager.canFetch(parsed.href);
    }, 'fetch');

    Scratch.canOpenWindow = wrapWithExtensionId(async url => {
        const parsed = parseURL(url);
        if (!parsed) {
            return false;
        }
        // Always reject protocols that would allow code execution.
        // eslint-disable-next-line no-script-url
        if (parsed.protocol === 'javascript:') {
            return false;
        }
        return vm.securityManager.canOpenWindow(parsed.href);
    }, 'openWindow');

    Scratch.canRedirect = wrapWithExtensionId(async url => {
        const parsed = parseURL(url);
        if (!parsed) {
            return false;
        }
        // Always reject protocols that would allow code execution.
        // eslint-disable-next-line no-script-url
        if (parsed.protocol === 'javascript:') {
            return false;
        }
        return vm.securityManager.canRedirect(parsed.href);
    }, 'redirect');

    Scratch.canRecordAudio = wrapWithExtensionId(async () => vm.securityManager.canRecordAudio(), 'recordAudio');

    Scratch.canRecordVideo = wrapWithExtensionId(async () => vm.securityManager.canRecordVideo(), 'recordVideo');

    Scratch.canReadClipboard = wrapWithExtensionId(async () => vm.securityManager.canReadClipboard(), 'readClipboard');

    Scratch.canNotify = wrapWithExtensionId(async () => vm.securityManager.canNotify(), 'notify');

    Scratch.canGeolocate = wrapWithExtensionId(async () => vm.securityManager.canGeolocate(), 'geolocate');

    Scratch.canEmbed = wrapWithExtensionId(async url => {
        const parsed = parseURL(url);
        if (!parsed) {
            return false;
        }
        return vm.securityManager.canEmbed(parsed.href);
    }, 'embed');

    Scratch.canDownload = wrapWithExtensionId(async (url, name) => {
        const parsed = parseURL(url);
        if (!parsed) {
            return false;
        }
        // Always reject protocols that would allow code execution.
        // eslint-disable-next-line no-script-url
        if (parsed.protocol === 'javascript:') {
            return false;
        }
        return vm.securityManager.canDownload(url, name);
    }, 'download');

    Scratch.fetch = async (url, options) => {
        const actualURL = url instanceof Request ? url.url : url;

        const staticFetchResult = staticFetch(url);
        if (staticFetchResult) {
            return staticFetchResult;
        }

        if (!await Scratch.canFetch(actualURL)) {
            throw new Error(`Permission to fetch ${actualURL} rejected.`);
        }
        return fetch(url, options);
    };

    Scratch.openWindow = async (url, features) => {
        if (!await Scratch.canOpenWindow(url)) {
            throw new Error(`Permission to open tab ${url} rejected.`);
        }
        // Use noreferrer to prevent new tab from accessing `window.opener`
        const baseFeatures = 'noreferrer';
        features = features ? `${baseFeatures},${features}` : baseFeatures;
        return window.open(url, '_blank', features);
    };

    Scratch.redirect = async url => {
        if (!await Scratch.canRedirect(url)) {
            throw new Error(`Permission to redirect to ${url} rejected.`);
        }
        location.href = url;
    };

    Scratch.download = async (url, name) => {
        if (!await Scratch.canDownload(url, name)) {
            throw new Error(`Permission to download ${name} rejected.`);
        }
        const link = document.createElement('a');
        link.href = url;
        link.download = name;
        document.body.appendChild(link);
        link.click();
        link.remove();
    };

    Scratch.translate = createTranslate(vm);

    global.Scratch = Scratch;
    global.ScratchExtensions = createScratchX(Scratch);

    vm.emit('CREATE_UNSANDBOXED_EXTENSION_API', Scratch);
});

/**
 * Disable the existing global.Scratch unsandboxed extension APIs.
 * This helps debug poorly designed extensions.
 */
const teardownUnsandboxedExtensionAPI = () => {
    // We can assume global.Scratch already exists.
    global.Scratch.extensions.register = () => {
        throw new Error('Too late to register new extensions.');
    };
};

/**
 * Load an unsandboxed extension from an arbitrary URL. This is dangerous.
 * @param {string} extensionURL
 * @param {Virtualmachine} vm
 * @returns {Promise<object[]>} Resolves with a list of extension objects if the extension was loaded successfully.
 */
const loadUnsandboxedExtension = (extensionURL, vm) => new Promise((resolve, reject) => {
    setupUnsandboxedExtensionAPI(vm).then(resolve);

    const script = document.createElement('script');
    script.onerror = () => {
        reject(new Error(`Error in unsandboxed script ${extensionURL}. Check the console for more information.`));
    };
    const loadTimeout = setTimeout(() => {
        script.remove();
        reject(new Error(`Timed out loading unsandboxed extension ${extensionURL}`));
    }, 20000);
    script.addEventListener('load', () => clearTimeout(loadTimeout), {once: true});
    let started = false;
    const startLoading = src => {
        if (started) return;
        started = true;
        script.src = src;
        document.body.appendChild(script);
    };
    let cachePromise = null;
    if (typeof window !== 'undefined' && window.__cysoExtensionCache &&
        typeof window.__cysoExtensionCache.get === 'function') {
        try {
            cachePromise = Promise.resolve(window.__cysoExtensionCache.get(extensionURL));
        } catch (e) {
            cachePromise = null;
        }
    }
    if (cachePromise) {
        // The script must ALWAYS start loading, even if the cache never
        // answers: race the cache against a short timeout.
        const timeout = new Promise(resolve => setTimeout(() => resolve(null), 3000));
        Promise.race([cachePromise.catch(() => null), timeout]).then(cached => {
            if (cached && typeof cached.content === 'string') {
                const blobURL = URL.createObjectURL(new Blob([cached.content], {type: 'text/javascript'}));
                script.addEventListener('load', () => URL.revokeObjectURL(blobURL), {once: true});
                startLoading(blobURL);
            } else {
                startLoading(extensionURL);
            }
        });
    } else {
        startLoading(extensionURL);
    }
}).then(objects => {
    teardownUnsandboxedExtensionAPI();
    return objects;
});

// Because loading unsandboxed extensions requires messing with global state (global.Scratch),
// only let one extension load at a time.
const limiter = new AsyncLimiter(loadUnsandboxedExtension, 1);
const load = (extensionURL, vm) => limiter.do(extensionURL, vm);

module.exports = {
    setupUnsandboxedExtensionAPI,
    load
};
