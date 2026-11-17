/**
 * @module components/AiAssistant.js
 * @name AiAssistant
 * @copyright 2026 3Liz
 * @license MPL-2.0
 */

import { render } from 'lit-html';

/**
 * Dock of the AI assistant: search of the data catalog layers in natural
 * language. The search, the results and the layers added to the map are
 * handled by the data catalog component, shared with the catalog dock.
 * @class
 * @name AiAssistant
 * @augments HTMLElement
 */
export default class AiAssistant extends HTMLElement {
    connectedCallback() {
        this._renderHandler = () => this._render();
        document.addEventListener('lizmapcatalogchanged', this._renderHandler);
        this._dockHandler = (e) => {
            if (e.id !== 'assistant') {
                return;
            }
            // The results need the list of the maps of the catalog
            const catalog = this._catalog();
            if (catalog && catalog._repositories === null) {
                catalog.load();
            }
            this._render();
            this.querySelector('.catalog-ai-question')?.focus();
        };
        lizMap.events.on({ dockopened: this._dockHandler });
        this._render();
    }

    disconnectedCallback() {
        document.removeEventListener('lizmapcatalogchanged', this._renderHandler);
        lizMap.events.off({ dockopened: this._dockHandler });
    }

    /**
     * @returns {HTMLElement|null} the data catalog component
     */
    _catalog() {
        return document.querySelector('lizmap-catalog');
    }

    _render() {
        const catalog = this._catalog();
        if (catalog?.assistantTemplate) {
            render(catalog.assistantTemplate(), this);
        }
    }
}
