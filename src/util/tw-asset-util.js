const StringUtil = require('./string-util');
const {findEntry} = require('./zip-lookup');

class AssetUtil {
    /**
     * @param {Runtime} runtime runtime with storage attached
     * @param {JSZip} zip optional JSZip to search for asset in
     * @param {Storage.assetType} assetType scratch-storage asset type
     * @param {string} md5ext full md5 with file extension
     * @returns {Promise<Storage.Asset>} scratch-storage asset object
     */
    static getByMd5ext (runtime, zip, assetType, md5ext) {
        const idParts = StringUtil.splitFirst(md5ext, '.');
        const md5 = idParts[0];
        const ext = (idParts[1] || '').toLowerCase();

        // createAsset refuses to build an asset without a format, and storage
        // can pick the default one, so bare names go straight to storage.
        if (zip && ext) {
            // Look at the root of the zip first, then one folder deep.
            const file = findEntry(zip, md5ext);

            if (file) {
                return runtime.wrapAssetRequest(() => file.async('uint8array').then(data => runtime.storage.createAsset(
                    assetType,
                    ext,
                    data,
                    md5,
                    false
                )));
            }
        }

        return runtime.wrapAssetRequest(() => runtime.storage.load(assetType, md5, ext));
    }
}

module.exports = AssetUtil;
