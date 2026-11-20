/**
 * @module components/DrawSnapping.js
 * @name DrawSnapping
 * @copyright 2026 3Liz
 * @license MPL-2.0
 */

import { mainLizmap, mainEventDispatcher } from '../modules/Globals.js';
import { html, render } from 'lit-html';
import { snapPanelTemplate } from './SnapPanel.js';

/**
 * Snapping panel of the draw tools
 * @class
 * @name DrawSnapping
 * @augments HTMLElement
 */
export default class DrawSnapping extends HTMLElement {
    constructor() {
        super();
        this._open = false;
    }

    connectedCallback() {
        const snap = mainLizmap.drawSnapping;
        if (!snap) {
            return;
        }
        const mainTemplate = () => html`
        <details class="draw-snapping" ?open=${this._open}
            @toggle=${(event) => { this._open = event.target.open; }}>
            <summary>
                ${lizDict['snapping.title'] || 'Snapping'}
                ${snap.active ? html`<span class="badge bg-success">${lizDict['snapping.on'] || 'on'}</span>` : ''}
            </summary>
            ${snapPanelTemplate(snap, this.getAttribute('prefix') || 'draw')}
        </details>`;

        this._listener = () => render(mainTemplate(), this);
        render(mainTemplate(), this);
        mainEventDispatcher.addListener(this._listener, 'drawsnapping.changed');
    }

    disconnectedCallback() {
        if (this._listener) {
            mainEventDispatcher.removeListener(this._listener, 'drawsnapping.changed');
        }
    }
}
