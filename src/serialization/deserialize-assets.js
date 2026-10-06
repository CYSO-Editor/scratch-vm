const JSZip = require('@turbowarp/jszip');
const log = require('../util/log');
const {findEntry} = require('../util/zip-lookup');

const MD5EXT_PATTERN = /^[0-9a-f]{32}\./;

const readZipFile = file => file.async('uint8array');

const createAsset = (storage, assetType, dataFormat, data, trustedId, generateId) =>
    storage.createAsset(assetType, dataFormat, data, trustedId, generateId);

/**
 * The id of an asset can only be trusted when it is a real content hash; sb2
 * and malformed projects carry arbitrary names that must be re-hashed.
 * @param {string} fileName entry name the asset was read from
 * @param {string} [assetFileName] name supplied by sb2, which is never a hash
 * @returns {?string}
 */
const trustedIdFor = (fileName, assetFileName) => (
    !assetFileName && MD5EXT_PATTERN.test(fileName) ? fileName.substring(0, 32) : null
);

/**
 * Deserializes sound from file into storage cache so that it can
 * be loaded into the runtime.
 * @param {object} sound Descriptor for sound from sb3 file
 * @param {Runtime} runtime The runtime containing the storage to cache the sounds in
 * @param {JSZip} zip The zip containing the sound file being described by `sound`
 * @param {string} assetFileName Optional file name for the given asset
 * (sb2 files have filenames of the form [int].[ext],
 * sb3 files have filenames of the form [md5].[ext])
 * @return {Promise} Promise that resolves after the described sound has been stored
 * into the runtime storage cache, the sound was already stored, or an error has
 * occurred.
 */
const deserializeSound = function (sound, runtime, zip, assetFileName) {
    const fileName = assetFileName ? assetFileName : sound.md5;
    const storage = runtime.storage;
    if (!storage) {
        log.warn('No storage module present; cannot load sound asset: ', fileName);
        return Promise.resolve(null);
    }

    if (!zip) { // Zip will not be provided if loading project json from server
        return Promise.resolve(null);
    }

    const soundFile = findEntry(zip, fileName);
    if (!soundFile) {
        log.error(`Could not find sound file associated with the ${sound.name} sound.`);
        return Promise.resolve(null);
    }

    if (!JSZip.support.uint8array) {
        log.error('JSZip uint8array is not supported in this browser.');
        return Promise.resolve(null);
    }

    const declaredFormat = typeof sound.dataFormat === 'string' ? sound.dataFormat.toLowerCase() : '';
    const dataFormat = declaredFormat === 'mp3' ?
        storage.DataFormat.MP3 : storage.DataFormat.WAV;
    const trustedId = trustedIdFor(fileName, assetFileName);
    return readZipFile(soundFile).then(data => createAsset(
        storage,
        storage.AssetType.Sound,
        dataFormat,
        data,
        trustedId,
        !trustedId
    ))
        .then(asset => {
            sound.asset = asset;
            sound.assetId = asset.assetId;
            sound.md5 = `${asset.assetId}.${asset.dataFormat}`;
        });
};

/**
 * Deserializes costume from file into storage cache so that it can
 * be loaded into the runtime.
 * @param {object} costume Descriptor for costume from sb3 file
 * @param {Runtime} runtime The runtime containing the storage to cache the costumes in
 * @param {JSZip} zip The zip containing the costume file being described by `costume`
 * @param {string} assetFileName Optional file name for the given asset
 * (sb2 files have filenames of the form [int].[ext],
 * sb3 files have filenames of the form [md5].[ext])
 * @param {string} textLayerFileName Optional file name for the given asset's text layer
 * (sb2 only; files have filenames of the form [int].png)
 * @return {Promise} Promise that resolves after the described costume has been stored
 * into the runtime storage cache, the costume was already stored, or an error has
 * occurred.
 */
const deserializeCostume = function (costume, runtime, zip, assetFileName, textLayerFileName) {
    const storage = runtime.storage;
    const assetId = costume.assetId;
    const fileName = assetFileName ? assetFileName :
        `${assetId}.${costume.dataFormat}`;

    if (!storage) {
        log.warn('No storage module present; cannot load costume asset: ', fileName);
        return Promise.resolve(null);
    }

    if (costume.asset) {
        // When uploading a sprite from an image file, the asset data will be provided
        // @todo Cache the asset data somewhere and pull it out here
        return Promise.resolve(storage.createAsset(
            costume.asset.assetType,
            costume.asset.dataFormat,
            new Uint8Array(Object.keys(costume.asset.data).map(key => costume.asset.data[key])),
            null,
            true
        )).then(asset => {
            costume.asset = asset;
            costume.assetId = asset.assetId;
            costume.md5 = `${asset.assetId}.${asset.dataFormat}`;
        });
    }

    if (!zip) {
        // Zip will not be provided if loading project json from server
        return Promise.resolve(null);
    }

    const costumeFile = findEntry(zip, fileName);
    if (!costumeFile) {
        log.error(`Could not find costume file associated with the ${costume.name} costume.`);
        return Promise.resolve(null);
    }

    const costumeFormat = typeof costume.dataFormat === 'string' ? costume.dataFormat.toLowerCase() : '';
    let assetType = null;
    if (costumeFormat === 'svg') {
        assetType = storage.AssetType.ImageVector;
    } else if (['png', 'bmp', 'jpeg', 'jpg', 'gif'].indexOf(costumeFormat) >= 0) {
        assetType = storage.AssetType.ImageBitmap;
    } else {
        // Without a type the renderer would receive an unusable asset; skipping
        // leaves the costume absent, which the runtime already tolerates.
        log.error(`Unexpected file format for costume: ${costumeFormat}`);
        return Promise.resolve(null);
    }

    if (!JSZip.support.uint8array) {
        log.error('JSZip uint8array is not supported in this browser.');
        return Promise.resolve(null);
    }

    // textLayerMD5 exists if there is a text layer, which is a png of text from Scratch 1.4
    // that was opened in Scratch 2.0. In this case, set costume.textLayerAsset.
    let textLayerFilePromise;
    if (costume.textLayerMD5) {
        const textLayerFile = findEntry(zip, textLayerFileName);
        if (!textLayerFile) {
            log.error(`Could not find text layer file associated with the ${costume.name} costume.`);
            return Promise.resolve(null);
        }
        textLayerFilePromise = readZipFile(textLayerFile)
            .then(data => createAsset(
                storage,
                storage.AssetType.ImageBitmap,
                'png',
                data,
                costume.textLayerMD5
            ))
            .then(asset => {
                costume.textLayerAsset = asset;
            });
    } else {
        textLayerFilePromise = Promise.resolve(null);
    }

    const trustedId = trustedIdFor(fileName, assetFileName);
    return Promise.all([textLayerFilePromise,
        readZipFile(costumeFile)
            .then(data => createAsset(
                storage,
                assetType,
                // TODO eventually we want to map non-png's to their actual file types?
                costumeFormat,
                data,
                trustedId,
                !trustedId
            ))
            .then(asset => {
                costume.asset = asset;
                costume.assetId = asset.assetId;
                costume.md5 = `${asset.assetId}.${asset.dataFormat}`;
            })
    ]);
};

module.exports = {
    deserializeSound,
    deserializeCostume
};
