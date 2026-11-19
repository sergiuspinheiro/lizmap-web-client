/**
 * @module modules/DockResizer.js
 * @name DockResizer
 * @copyright 2026 3Liz
 * @license MPL-2.0
 */

const MIN_WIDTH = 200;
const SWAP_KEY = 'lizmap-docks-swapped';

/**
 * Let the map and the components use the new size of a panel
 */
function notifyResize() {
    window.dispatchEvent(new Event('resize'));
}

/**
 * Read a value in the browser storage
 * @param {string} key - the storage key
 * @returns {string|null} the value
 */
function readStorage(key) {
    try {
        return window.localStorage.getItem(key);
    } catch {
        return null;
    }
}

/**
 * Write a value in the browser storage, remove it if the value is null
 * @param {string} key - the storage key
 * @param {string|null} value - the value
 */
function writeStorage(key, value) {
    try {
        if (value === null) {
            window.localStorage.removeItem(key);
        } else {
            window.localStorage.setItem(key, value);
        }
    } catch {
        // Browser storage not available
    }
}

/**
 * Let the user resize a panel by dragging a handle on one of its borders.
 * The border used (left or right) is read from the layout when the drag starts,
 * so it works wherever the panel is displayed.
 * The width is kept in the browser, a double click restores the default.
 * @param {HTMLElement} panel - the panel to resize
 * @param {HTMLElement} handle - the handle to drag
 * @param {string} storageKey - the browser storage key of the width
 * @param {Function} apply - apply a width in pixels to the panel, 0 restores the default
 */
function makeResizable(panel, handle, storageKey, apply) {
    const setWidth = (width) => {
        if (width) {
            const max = Math.max(MIN_WIDTH, window.innerWidth - 100);
            apply(Math.round(Math.min(Math.max(width, MIN_WIDTH), max)));
        } else {
            apply(0);
        }
    };

    setWidth(Number(readStorage(storageKey)) || 0);

    handle.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) {
            return;
        }
        e.preventDefault();
        handle.setPointerCapture(e.pointerId);
        handle.classList.add('resizing');
        const panelRect = panel.getBoundingClientRect();
        const handleRect = handle.getBoundingClientRect();
        // The handle is on the right border of the panel when it is
        // closer to the right side of the panel than to its left side
        const onRight = (handleRect.left + handleRect.width / 2) > (panelRect.left + panelRect.width / 2);
        const move = (ev) => {
            setWidth(onRight ? ev.clientX - panelRect.left : panelRect.right - ev.clientX);
        };
        const stop = () => {
            handle.classList.remove('resizing');
            handle.removeEventListener('pointermove', move);
            handle.removeEventListener('pointerup', stop);
            handle.removeEventListener('pointercancel', stop);
            writeStorage(storageKey, String(Math.round(panel.getBoundingClientRect().width)));
            notifyResize();
        };
        handle.addEventListener('pointermove', move);
        handle.addEventListener('pointerup', stop);
        handle.addEventListener('pointercancel', stop);
    });

    handle.addEventListener('dblclick', () => {
        setWidth(0);
        writeStorage(storageKey, null);
        notifyResize();
    });
}

/**
 * Apply a width to a panel through its inline style
 * @param {HTMLElement} panel - the panel
 * @returns {Function} the function applying a width in pixels, 0 restores the default
 */
function styleWidth(panel) {
    return (width) => {
        panel.style.width = width ? width + 'px' : '';
        panel.style.maxWidth = width ? 'none' : '';
    };
}

/**
 * Swap the places of the sub-dock and of the right dock
 * @param {Document} doc - the document
 * @param {boolean} swapped - true to display the sub-dock on the right
 * and the right dock next to the left dock
 */
function setSwapped(doc, swapped) {
    const content = doc.getElementById('content');
    if (!content) {
        return;
    }
    content.classList.toggle('docks-swapped', swapped);
    doc.querySelectorAll('.dock-swap-btn').forEach(btn => btn.classList.toggle('active', swapped));
    writeStorage(SWAP_KEY, swapped ? '1' : null);
}

/**
 * Create a button swapping the places of the sub-dock and of the right dock
 * @param {Document} doc - the document
 * @param {string} title - the button title
 * @returns {HTMLButtonElement} the button
 */
function createSwapButton(doc, title) {
    const btn = doc.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-sm dock-swap-btn';
    btn.title = title;
    btn.setAttribute('aria-label', title);
    btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16" aria-hidden="true">'
        + '<path fill-rule="evenodd" d="M1 11.5a.5.5 0 0 0 .5.5h11.793l-3.147 3.146a.5.5 0 0 0 .708.708l4-4a.5.5 0 0 0 0-.708l-4-4a.5.5 0 0 0-.708.708L13.293 11H1.5a.5.5 0 0 0-.5.5zm14-7a.5.5 0 0 1-.5.5H2.707l3.147 3.146a.5.5 0 1 1-.708.708l-4-4a.5.5 0 0 1 0-.708l4-4a.5.5 0 1 1 .708.708L2.707 4H14.5a.5.5 0 0 1 .5.5z"/>'
        + '</svg>';
    btn.classList.toggle('active', doc.getElementById('content')?.classList.contains('docks-swapped'));
    btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        setSwapped(doc, !doc.getElementById('content').classList.contains('docks-swapped'));
        notifyResize();
    });
    return btn;
}

/**
 * Let the user resize the left dock, the sub-dock and the right dock
 * by dragging their inner border, and swap the places of the sub-dock
 * and of the right dock.
 * The sizes and the places are kept in the browser.
 * @param {Document} doc - the document
 */
export function initDockResizer(doc = document) {
    // Left dock
    const dock = doc.getElementById('dock');
    const dockHandle = doc.getElementById('dock-resizer');
    if (dock && dockHandle) {
        makeResizable(dock, dockHandle, 'lizmap-dock-width', styleWidth(dock));
    }

    const content = doc.getElementById('content');
    const subDock = doc.getElementById('sub-dock');
    const subDockHandle = doc.getElementById('sub-dock-resizer');
    const rightDock = doc.getElementById('right-dock');
    const rightDockHandle = doc.getElementById('right-dock-resizer');
    const swapTitle = subDockHandle?.dataset.swapTitle || rightDockHandle?.dataset.swapTitle || '';

    if (content) {
        setSwapped(doc, readStorage(SWAP_KEY) === '1');
    }

    // Sub-dock: its content is replaced each time a layer information is displayed,
    // so its handle is next to it and follows its height
    if (subDock && subDockHandle) {
        makeResizable(subDock, subDockHandle, 'lizmap-sub-dock-width', styleWidth(subDock));
        const syncHandle = () => {
            const visible = subDock.offsetParent !== null && subDock.offsetHeight > 0;
            subDockHandle.classList.toggle('visible', visible);
            subDockHandle.style.height = visible ? subDock.offsetHeight + 'px' : '';
        };
        new ResizeObserver(syncHandle).observe(subDock);
        // Add the swap button to every new content
        const addSwapButton = () => {
            if (subDock.childElementCount && !subDock.querySelector(':scope > .dock-swap-btn')) {
                subDock.prepend(createSwapButton(doc, swapTitle));
            }
            syncHandle();
        };
        new MutationObserver(addSwapButton).observe(subDock, { childList: true });
        new MutationObserver(syncHandle).observe(subDock, { attributes: true, attributeFilter: ['style', 'class'] });
        addSwapButton();
    }

    // Right dock: its width is shared with the map margin through a CSS variable
    if (content && rightDock && rightDockHandle) {
        makeResizable(rightDock, rightDockHandle, 'lizmap-right-dock-width', (width) => {
            if (width) {
                content.style.setProperty('--lizmap-right-dock-width', width + 'px');
            } else {
                content.style.removeProperty('--lizmap-right-dock-width');
            }
        });
        const close = doc.getElementById('right-dock-close');
        if (close) {
            close.before(createSwapButton(doc, swapTitle));
        }
    }
}
