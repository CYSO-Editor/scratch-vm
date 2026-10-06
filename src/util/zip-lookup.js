/**
 * Locating assets inside a project archive.
 *
 * Assets normally live at the root of the archive, but archives produced by
 * other tools sometimes wrap every entry in a single folder. Historically that
 * fallback was implemented by building a RegExp from the file name, which made
 * the lookup cost O(entries) per asset and let archive metadata drive a regex
 * compile. These helpers keep the same matching semantics without either cost.
 */

const REGEXP_SPECIALS = /[.*+?^${}()|[\]\\]/g;

/**
 * @param {string} text untrusted text
 * @returns {string} text safe to embed in a RegExp as a literal
 */
const escapeRegExp = text => text.replace(REGEXP_SPECIALS, '\\$&');

/**
 * Resolve an asset entry by name, tolerating one level of wrapping folder.
 * @param {object} zip archive supporting JSZip's file() interface
 * @param {string} name entry name as referenced by the project
 * @returns {?object} the matching entry, or null when absent
 */
const findEntry = (zip, name) => {
    if (!zip || typeof name !== 'string' || name.length === 0) {
        return null;
    }

    const exact = zip.file(name);
    if (exact) {
        return exact;
    }

    // ZipStore exposes a prebuilt index, so wrapped archives resolve without
    // scanning or compiling anything.
    if (typeof zip.getByBasename === 'function') {
        return zip.getByBasename(name);
    }

    const matches = zip.file(new RegExp(`^([^/]*/)?${escapeRegExp(name)}$`));
    return matches && matches.length > 0 ? matches[0] : null;
};

module.exports = {
    escapeRegExp,
    findEntry
};
