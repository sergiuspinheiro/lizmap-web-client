/**
 * @module components/DrawSnapping.js
 * @name DrawSnapping
 * @copyright 2026 3Liz
 * @license MPL-2.0
 */

import { mainLizmap, mainEventDispatcher } from '../modules/Globals.js';
import { render } from 'lit-html';
import { snapSectionTemplate, snapPanelTooltips } from './SnapPanel.js';

/**
 * Snapping panel of the draw tools
 * @class
 * @name DrawSnapping
 * @augments HTMLElement
 */
export default class DrawSnapping extends HTMLElement {
    constructor() {
        super();
        this._open = true;
    }

    connectedCallback() {
        const snap = mainLizmap.drawSnapping;
        if (!snap) {
            return;
        }
        const mainTemplate = () => snapSectionTemplate(
            snap,
            this.getAttribute('prefix') || 'draw',
            this._open,
            (open) => { this._open = open; }
        );

        this._listener = () => {
            render(mainTemplate(), this);
            snapPanelTooltips(this);
        };
        this._listener();
        mainEventDispatcher.addListener(this._listener, 'drawsnapping.changed');
    }

    disconnectedCallback() {
        if (this._listener) {
            mainEventDispatcher.removeListener(this._listener, 'drawsnapping.changed');
        }
    }
}
