/**
 * @module components/Snapping.js
 * @name Snapping
 * @copyright 2023 3Liz
 * @author BOISTEAULT Nicolas
 * @license MPL-2.0
 */

import { mainLizmap, mainEventDispatcher } from '../modules/Globals.js';
import { html, render } from 'lit-html';
import { snapPanelTemplate } from './SnapPanel.js';

/**
 * Snapping panel of the edition tool
 * @class
 * @name Snapping
 * @augments HTMLElement
 */
export default class Snapping extends HTMLElement {
    constructor() {
        super();
    }

    connectedCallback() {
        const mainTemplate = () => html`
        <div class="${mainLizmap.snapping.config !== undefined ? '' : 'hide'}">
            <h3>${lizDict['snapping.title']}</h3>
            <div class="form-group">
                ${mainLizmap.snapping.config !== undefined
                    ? snapPanelTemplate(mainLizmap.snapping, 'edition')
                    : ''}
            </div>
        </div>`;

        render(mainTemplate(), this);

        this._listener = () => render(mainTemplate(), this);
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
