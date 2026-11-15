/**
 * @module modules/DockResizer.js
 * @name DockResizer
 * @copyright 2026 3Liz
 * @license MPL-2.0
 */

const STORAGE_KEY = 'lizmap-dock-width';
const MIN_WIDTH = 200;

/**
 * Let the user resize the left dock by dragging its right border.
 * The width is kept in the browser, a double click restores the default.
 * @param {Document} doc - the document
 */
export function initDockResizer(doc = document) {
    const dock = doc.getElementById('dock');
    const handle = doc.getElementById('dock-resizer');
    if (!dock || !handle) {
        return;
    }

    const setWidth = (width) => {
        if (width) {
            const max = Math.max(MIN_WIDTH, window.innerWidth - 100);
            const value = Math.min(Math.max(width, MIN_WIDTH), max);
            dock.style.width = value + 'px';
            dock.style.maxWidth = 'none';
        } else {
            dock.style.width = '';
            dock.style.maxWidth = '';
        }
    };

    try {
        setWidth(Number(window.localStorage.getItem(STORAGE_KEY)) || 0);
    } catch {
        // Browser storage not available
    }

    handle.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        handle.setPointerCapture(e.pointerId);
        handle.classList.add('resizing');
        const left = dock.getBoundingClientRect().left;
        const move = (ev) => setWidth(ev.clientX - left);
        const stop = () => {
            handle.classList.remove('resizing');
            handle.removeEventListener('pointermove', move);
            handle.removeEventListener('pointerup', stop);
            handle.removeEventListener('pointercancel', stop);
            try {
                window.localStorage.setItem(STORAGE_KEY, String(Math.round(dock.getBoundingClientRect().width)));
            } catch {
                // Browser storage not available
            }
            // Let the map and the components use the new size
            window.dispatchEvent(new Event('resize'));
        };
        handle.addEventListener('pointermove', move);
        handle.addEventListener('pointerup', stop);
        handle.addEventListener('pointercancel', stop);
    });

    handle.addEventListener('dblclick', () => {
        setWidth(0);
        try {
            window.localStorage.removeItem(STORAGE_KEY);
        } catch {
            // Browser storage not available
        }
        window.dispatchEvent(new Event('resize'));
    });
}
