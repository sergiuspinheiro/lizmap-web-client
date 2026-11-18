/**
 * @module modules/ImportLibrary.js
 * @name ImportLibrary
 * @copyright 2026 3Liz
 * @license MPL-2.0
 */

/**
 * Temporary files imported in the data catalog, kept in the browser
 * (IndexedDB) so that they are available in the other maps and tabs. They
 * are separated by user and forgotten after MAX_AGE.
 */

const DB_NAME = 'lizmap-catalog';
const STORE = 'imports';

/** Files not used for 7 days are forgotten */
export const MAX_AGE = 7 * 24 * 3600 * 1000;

let dbPromise = null;

/**
 * Open the database
 * @returns {Promise<IDBDatabase|null>} the database, null without IndexedDB
 */
function openDb() {
    if (!dbPromise) {
        dbPromise = new Promise(resolve => {
            if (!globalThis.indexedDB) {
                resolve(null);
                return;
            }
            try {
                const request = globalThis.indexedDB.open(DB_NAME, 1);
                request.onupgradeneeded = () => {
                    request.result.createObjectStore(STORE, { keyPath: 'uid' });
                };
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => resolve(null);
                request.onblocked = () => resolve(null);
            } catch {
                resolve(null);
            }
        });
    }
    return dbPromise;
}

/**
 * Run a request on the store
 * @param {string} mode - readonly or readwrite
 * @param {function(IDBObjectStore): IDBRequest} action - creates the request
 * @returns {Promise<*>} the request result, undefined on error
 */
async function run(mode, action) {
    const db = await openDb();
    if (!db) {
        return undefined;
    }
    return new Promise(resolve => {
        try {
            const request = action(db.transaction(STORE, mode).objectStore(STORE));
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => resolve(undefined);
        } catch {
            resolve(undefined);
        }
    });
}

/**
 * Files of a user, the expired ones are deleted
 * @param {string} scope - the user scope
 * @returns {Promise<object[]>} the files, the last used first
 */
export async function listImports(scope) {
    const all = await run('readonly', store => store.getAll()) || [];
    const now = Date.now();
    const files = [];
    for (const entry of all) {
        if (now - (entry.updated || 0) > MAX_AGE) {
            await deleteImport(entry.uid);
        } else if (entry.scope === scope) {
            files.push(entry);
        }
    }
    return files.sort((a, b) => (b.updated || 0) - (a.updated || 0));
}

/**
 * Save a file
 * @param {object} entry - the file, with its uid and scope
 * @returns {Promise<boolean>} true if saved
 */
export async function putImport(entry) {
    return (await run('readwrite', store => store.put({ ...entry, updated: Date.now() }))) !== undefined;
}

/**
 * Delete a file
 * @param {string} uid - the file id
 * @returns {Promise<void>}
 */
export async function deleteImport(uid) {
    await run('readwrite', store => store.delete(uid));
}
