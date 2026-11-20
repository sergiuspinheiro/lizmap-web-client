/**
 * @module components/Snapping.js
 * @name Snapping
 * @copyright 2023 3Liz
 * @author BOISTEAULT Nicolas
 * @license MPL-2.0
 */

import { mainLizmap, mainEventDispatcher } from '../modules/Globals.js';
import { html, render } from 'lit-html';
import { snapSectionTemplate, snapPanelTooltips } from './SnapPanel.js';

/**
 * Snapping panel of the edition tool
 * @class
 * @name Snapping
 * @augments HTMLElement
 */
export default class Snapping extends HTMLElement {
    constructor() {
        super();
        this._open = true;
    }

    connectedCallback() {
        const mainTemplate = () => html`
        <div class="${mainLizmap.snapping.config !== undefined ? '' : 'hide'}">
            ${mainLizmap.snapping.config !== undefined
                ? snapSectionTemplate(mainLizmap.snapping, 'edition', this._open, (open) => { this._open = open; })
                : ''}
        </div>`;

        this._listener = () => {
            render(mainTemplate(), this);
            snapPanelTooltips(this);
        };
        this._listener();
        mainEventDispatcher.addListener(
            this._listener,
            [
                'snapping.config',
                'snapping.active',
                'snapping.refreshable'
            ]
        );
    }

    disconnectedCallback() {
        mainEventDispatcher.removeListener(
            this._listener,
            [
                'snapping.config',
                'snapping.active',
                'snapping.refreshable'
            ]
        );
    }
}
