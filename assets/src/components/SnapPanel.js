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
 * The snapping panel
 * @param {object} snap   - a snapping controller: active, toggle(), refreshable, refresh(),
 *                          layers, toggleLayer(id), modes, setMode(mode, enabled), tolerance
 * @param {string} prefix - prefix of the element ids
 * @returns {import('lit-html').TemplateResult} the template
 */
export function snapPanelTemplate(snap, prefix) {
    const layers = snap.layers;
    const checkedCount = layers.filter(l => l.checked).length;
    return html`
    <div class="snap-panel">
        <div class="snap-toolbar">
        <div class="btn-group">
            <button
                type="button"
                class="btn snap-toggle ${snap.active ? 'active btn-success' : ''}"
                @click=${() => snap.toggle()}
                >
                ${snap.active ? t('geolocate.toolbar.stop', 'Stop') : t('geolocate.toolbar.start', 'Start')}
            </button>
            <button
                type="button"
                class="btn snap-refresh ${snap.refreshable ? 'btn-warning' : ''}"
                ?disabled=${!snap.refreshable}
                title="${t('snapping.refresh', 'Reload the features of the layers in the map extent')}"
                @click=${() => snap.refresh()}
                >
                <svg width="14" height="14">
                    <use href="${lizUrls.svgSprite}#refresh"/>
                </svg>
            </button>
        </div>
        ${typeof snap.undoVertex === 'function' ? html`
        <button
            type="button"
            class="btn snap-undo"
            title="${t('snapping.undo.title', 'Remove the last vertex of the drawing (Ctrl+Z or Backspace)')}"
            @mousedown=${(event) => event.preventDefault()}
            @click=${() => snap.undoVertex()}
            >
            <svg class="snap-undo-icon" width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
                <path d="M6 3 L2 7 L6 11 M2 7 H10 A4 4 0 0 1 10 15 H7" fill="none" stroke="currentColor" stroke-width="1.8"/>
            </svg>
            <span>${t('snapping.undo', 'Undo vertex')}</span>
        </button>` : ''}
        </div>
        <div class="snap-panel-controls">
            <p class="snap-layers-list-title">${t('snapping.modes.title', 'Snap modes')}</p>
            <div class="snap-modes">
                ${SnapModes.map(mode => html`
                <div class="snap-mode form-check">
                    <input
                        id="${prefix + '-snap-mode-' + mode}"
                        class="form-check-input"
                        type="checkbox"
                        .checked=${!!snap.modes[mode]}
                        @change=${(event) => snap.setMode(mode, event.target.checked)}
                        />
                    <label class="form-check-label" for="${prefix + '-snap-mode-' + mode}">
                        <span class="snap-mode-icon">${unsafeHTML(snapModeIcons[mode])}</span>
                        ${t(modeLabels[mode][0], modeLabels[mode][1])}
                    </label>
                </div>`)}
            </div>
            <div class="snap-tolerance input-group input-group-sm">
                <span class="input-group-text">${t('snapping.tolerance', 'Tolerance')}</span>
                <input
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
            <p class="snap-layers-list-title">
                ${t('snapping.layers.title', 'Layers')}
                <span class="snap-layers-count">(${checkedCount})</span>
            </p>
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
        </div>
    </div>`;
}
