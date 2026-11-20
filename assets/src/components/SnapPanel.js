/**
 * @module components/SnapPanel.js
 * @name SnapPanel
 * @copyright 2026 3Liz
 * @license MPL-2.0
 * @description Template of the snapping panel shared by the edition and the draw tools.
 */

import { html } from 'lit-html';
import { unsafeHTML } from 'lit-html/directives/unsafe-html.js';
import { SnapModes } from '../modules/SnapTargets.js';
import { snapModeIcons } from '../modules/SnapStyles.js';

const modeLabels = {
    vertices: ['snapping.mode.vertices', 'Vertices'],
    segments: ['snapping.mode.segments', 'Segments'],
    midpoints: ['snapping.mode.midpoints', 'Segment midpoints'],
    intersections: ['snapping.mode.intersections', 'Intersections'],
    tracing: ['snapping.mode.tracing', 'Tracing (follow the features)'],
};

/**
 * Translation with a fallback
 * @param {string} key      - dictionary key
 * @param {string} fallback - text used when the key is missing
 * @returns {string} the text
 */
const t = (key, fallback) => (globalThis['lizDict'] && lizDict[key]) || fallback;

/**
 * Icon of the snapping tool (magnet)
 * @type {string}
 */
const MAGNET_ICON = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 2 V8 A5 5 0 0 0 13 8 V2 H10 V8 A2 2 0 0 1 6 8 V2 Z" '
    + 'fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M3 4.5 H6 M10 4.5 H13" stroke="currentColor" stroke-width="1.5"/></svg>';

/**
 * Icons of undo and redo
 * @type {Object<string, string>}
 */
const ARROW_ICONS = {
    undo: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3 L2 7 L6 11 M2 7 H10 A4 4 0 0 1 10 15 H7" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>',
    redo: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3 L14 7 L10 11 M14 7 H6 A4 4 0 0 0 6 15 H9" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>',
};

/**
 * Add the Bootstrap tooltips of the snapping panel (help on the buttons, like the draw tools)
 * @param {HTMLElement} element - the element containing the panel
 */
export function snapPanelTooltips(element) {
    if (!globalThis['bootstrap']?.Tooltip) {
        return;
    }
    for (const el of element.querySelectorAll('.snap-panel [data-bs-toggle="tooltip"]')) {
        const tooltip = bootstrap.Tooltip.getOrCreateInstance(el, { trigger: 'hover' });
        // title changed after a render (e.g. start / stop)
        if (el.dataset.snapTitle !== el.dataset.bsTitle) {
            el.dataset.snapTitle = el.dataset.bsTitle;
            tooltip.setContent?.({ '.tooltip-inner': el.dataset.bsTitle });
        }
    }
}

/**
 * The snapping panel: a toolbar (start, reload, undo, redo, modes, tolerance) and the layers
 * @param {object} snap   - a snapping controller: active, toggle(), refreshable, refresh(),
 *                          layers, toggleLayer(id), modes, setMode(mode, enabled), tolerance,
 *                          undoVertex(), redoVertex()
 * @param {string} prefix - prefix of the element ids
 * @returns {import('lit-html').TemplateResult} the template
 */
export function snapPanelTemplate(snap, prefix) {
    const layers = snap.layers;
    const checkedCount = layers.filter(l => l.checked).length;
    const toggleTitle = snap.active
        ? t('snapping.toolbar.stop', 'Stop snapping')
        : t('snapping.toolbar.start', 'Start snapping');
    return html`
    <div class="snap-panel">
        <div class="snap-toolbar">
            <div class="btn-group">
                <button
                    type="button"
                    class="btn snap-toggle ${snap.active ? 'active btn-primary' : ''}"
                    data-bs-toggle="tooltip"
                    data-bs-title="${toggleTitle}"
                    aria-label="${toggleTitle}"
                    @click=${() => snap.toggle()}
                    >${unsafeHTML(MAGNET_ICON)}</button>
                <button
                    type="button"
                    class="btn snap-refresh ${snap.refreshable ? 'btn-warning' : ''}"
                    ?disabled=${!snap.refreshable}
                    data-bs-toggle="tooltip"
                    data-bs-title="${t('snapping.refresh', 'Reload the features of the layers in the map extent')}"
                    @click=${() => snap.refresh()}
                    >
                    <svg><use href="${lizUrls.svgSprite}#refresh"/></svg>
                </button>
            </div>
            ${typeof snap.undoVertex === 'function' ? html`
            <div class="btn-group">
                <button
                    type="button"
                    class="btn snap-undo"
                    data-bs-toggle="tooltip"
                    data-bs-title="${t('snapping.undo.title', 'Undo vertex (Ctrl+Z or Backspace)')}"
                    @mousedown=${(event) => event.preventDefault()}
                    @click=${() => snap.undoVertex()}
                    >${unsafeHTML(ARROW_ICONS.undo)}</button>
                <button
                    type="button"
                    class="btn snap-redo"
                    data-bs-toggle="tooltip"
                    data-bs-title="${t('snapping.redo.title', 'Redo vertex (Ctrl+Y or Ctrl+Shift+Z)')}"
                    @mousedown=${(event) => event.preventDefault()}
                    @click=${() => snap.redoVertex?.()}
                    >${unsafeHTML(ARROW_ICONS.redo)}</button>
            </div>` : ''}
            <div class="btn-group snap-modes" role="group">
                ${SnapModes.map(mode => html`
                <button
                    type="button"
                    class="btn snap-mode snap-mode-${mode} ${snap.modes[mode] ? 'active' : ''}"
                    aria-pressed="${snap.modes[mode] ? 'true' : 'false'}"
                    data-bs-toggle="tooltip"
                    data-bs-title="${t(modeLabels[mode][0], modeLabels[mode][1])}"
                    aria-label="${t(modeLabels[mode][0], modeLabels[mode][1])}"
                    @click=${() => snap.setMode(mode, !snap.modes[mode])}
                    >${unsafeHTML(snapModeIcons[mode])}</button>`)}
            </div>
            <div
                class="snap-tolerance input-group input-group-sm"
                data-bs-toggle="tooltip"
                data-bs-title="${t('snapping.tolerance.title', 'Snapping distance, in pixels')}"
                >
                <span class="input-group-text">${t('snapping.tolerance', 'Tolerance')}</span>
                <input
                    id="${prefix + '-snap-tolerance'}"
                    type="number"
                    class="form-control"
                    min="1"
                    max="100"
                    step="1"
                    .value=${String(snap.tolerance)}
                    @change=${(event) => { snap.tolerance = event.target.value; }}
                    />
                <span class="input-group-text">px</span>
            </div>
        </div>
        <details class="snap-layers" open>
            <summary>
                ${t('snapping.layers.title', 'Layers')}
                <span class="snap-layers-count">(${checkedCount})</span>
            </summary>
            <div class="snap-layers-list">
                ${layers.length === 0 ? html`
                <p class="snap-layers-empty">${t('snapping.list.empty', 'No layer to snap to.')}</p>
                ` : ''}
                ${layers.map(layer => html`
                <div class="snap-layer form-check">
                    <input
                        id="${prefix + '-snap-layer-' + layer.id}"
                        name="${layer.id}"
                        class="form-check-input"
                        type="checkbox"
                        .disabled=${!layer.enabled}
                        .checked=${layer.checked}
                        @change=${() => snap.toggleLayer(layer.id)}
                        />
                    <label
                        title="${layer.enabled ? t('snapping.list.toggle', 'Toggle snapping for this layer') : t('snapping.list.disabled', 'This layer is hidden')}"
                        for="${prefix + '-snap-layer-' + layer.id}"
                        class="${layer.enabled ? '' : 'snap-disabled'} form-check-label"
                        >
                        ${layer.title}
                    </label>
                </div>`)}
            </div>
        </details>
    </div>`;
}

/**
 * The snapping section, the same in the edition, the draw tools and the overlay analysis
 * @param {object}   snap     - the snapping controller
 * @param {string}   prefix   - prefix of the element ids
 * @param {boolean}  open     - the section is open
 * @param {Function} onToggle - called with the open state
 * @returns {import('lit-html').TemplateResult} the template
 */
export function snapSectionTemplate(snap, prefix, open, onToggle) {
    return html`
    <details class="snap-section" ?open=${open} @toggle=${(event) => onToggle(event.target.open)}>
        <summary>
            ${t('snapping.title', 'Snapping')}
            ${snap.active ? html`<span class="badge bg-success">${t('snapping.on', 'on')}</span>` : ''}
        </summary>
        ${snapPanelTemplate(snap, prefix)}
    </details>`;
}
