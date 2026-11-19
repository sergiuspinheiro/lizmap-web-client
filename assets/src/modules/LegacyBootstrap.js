/**
 * @module modules/LegacyBootstrap.js
 * @name LegacyBootstrap
 * @copyright 2026 3Liz
 * @license MPL-2.0
 */

/** Methods of the Bootstrap 5 jQuery plugins */
const KNOWN_METHODS = ['show', 'hide', 'toggle', 'dispose', 'enable', 'disable', 'toggleEnabled', 'update', 'setContent'];

/**
 * Let the scripts written for the Bootstrap 2 or 3 of the old Lizmap versions
 * (the JavaScript files in the media/js folder of the projects) call the methods
 * of tooltips and popovers that Bootstrap 5 removed, like "fixTitle" or "destroy",
 * instead of stopping the map initialization with an error.
 * @param {object} $ - jQuery
 */
export function patchLegacyBootstrap($ = globalThis.jQuery) {
    if (!$?.fn) {
        return;
    }
    for (const name of ['tooltip', 'popover']) {
        const original = $.fn[name];
        if (typeof original !== 'function' || original.lizmapLegacyPatched) {
            continue;
        }
        const patched = function (config, ...args) {
            if (typeof config !== 'string' || KNOWN_METHODS.includes(config)) {
                return original.call(this, config, ...args);
            }
            if (config === 'destroy') {
                return original.call(this, 'dispose');
            }
            if (config === 'fixTitle') {
                // Bootstrap 2/3 read the title attribute again: give it to the Bootstrap 5 tooltip
                return this.each(function () {
                    const title = this.getAttribute('title');
                    if (title) {
                        this.setAttribute('data-bs-original-title', title);
                        this.setAttribute('data-bs-title', title);
                        const Plugin = name === 'tooltip' ? globalThis.bootstrap?.Tooltip : globalThis.bootstrap?.Popover;
                        Plugin?.getInstance(this)?.setContent(name === 'tooltip' ? { '.tooltip-inner': title } : { '.popover-header': title });
                    }
                });
            }
            console.warn(`Bootstrap ${name}: the method "${config}" does not exist anymore, it is ignored`);
            return this;
        };
        patched.lizmapLegacyPatched = true;
        patched.Constructor = original.Constructor;
        patched.noConflict = original.noConflict;
        $.fn[name] = patched;
    }
}
