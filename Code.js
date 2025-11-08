// ==UserScript==
// @name Gemini Multi-Part Prompt Assembler Refactored
// @namespace http://tampermonkey.net/
// @version 43.0
// @description Expert Refactor: Replaced native alert()/confirm() with a custom, centralized Notification Service.
// @match https://gemini.google.com/*
// @grant GM_setValue
// @grant GM_getValue
// @grant GM_deleteValue
// @grant GM_listValues
// @run-at document-start
// @noframes
// ==/UserScript==

(async function(){
'use strict';

// --- Global Constants (C) ---
const C = {
    VERSION: 'v43_0_',
    STORAGE_KEYS: {
        SLOT_PREFIX: 'gmp_slot_uni_', NAMES_KEY: 'gmp_slot_names_uni', DELETE_PREFIX: 'DEL_SLOT_',
        POSITION: 'gmp_pos_', IDS_ORDER: 'gmp_ids_', VISIBILITY: 'gmp_vis_', MODE: 'gmp_mode_',
        COLLAPSED_PREFIX: 'gmp_col_', NAME_PREFIX: 'gmp_name_', CONTENT_PREFIX: 'gmp_part_',
    },
    UI: {
        PANEL_ID: 'gmpPanel', HANDLE_ID: 'gmpHandle', DRAG_CLASS: 'gmp-drag', START_BUTTON: 'gmpStart', ADD_BUTTON: 'gmpAdd', SAVE_BUTTON: 'gmpSave',
        LOAD_SELECT: 'gmpLoadSel', EXPORT_SELECT: 'gmpExportSel', INPUT_CONTAINER: 'gmpCtr', TOGGLE_BUTTON: 'gmpToggle', EXPORT_BUTTON: 'gmpExport',
        IMPORT_BUTTON: 'gmpImport', IMPORT_FILE: 'gmpImpFile', CLEAR_ALL_BUTTON: 'gmpClear', MODE_TOGGLE: 'gmpModeTgl', REORDER_HANDLE: 'gmp-reorder',
        BUTTON: 'gmp-btn', INPUT: 'gmp-input', SELECT: 'gmp-select', HEADER: 'gmp-header', CONTROLS: 'gmp-controls', PART_GROUP: 'prompt-input-group',
        FLEX_ROW: 'gmp-flex-row', REMOVE_BUTTON: 'gmp-remove-btn', RESIZE_TEXTAREA: 'gmp-resize-ta', DELETE_OPTION: 'gmp-delete-opt', EXPORT_BUTTON_CLS: 'gmp-export-btn',
        MAIN_BUTTON: 'gmp-main-btn', INPUT_SELECTOR: 'div.ql-editor[contenteditable="true"], textarea[placeholder*="Enter a prompt"]',
        // New Modal Constants
        MODAL_ID: 'gmpVariableModal', MODAL_INPUT_CONTAINER: 'gmpModalInputs', MODAL_SUBMIT: 'gmpModalSubmit', MODAL_CANCEL: 'gmpModalCancel',
        // Notification Modal Constants
        NOTIFY_ID: 'gmpNotificationModal', NOTIFY_TITLE: 'gmpNotifyTitle', NOTIFY_MESSAGE: 'gmpNotifyMessage',
        NOTIFY_CONFIRM_CTN: 'gmpNotifyConfirmCtn', NOTIFY_ALERT_CTN: 'gmpNotifyAlertCtn',
        NOTIFY_CONFIRM_OK: 'gmpNotifyConfirmOk', NOTIFY_CONFIRM_CANCEL: 'gmpNotifyConfirmCancel', NOTIFY_ALERT_OK: 'gmpNotifyAlertOk',
    },
    MAX_H_MULT: 0.25,
    // Regex for finding [[VARIABLE_NAME]] - note the global flag 'g'
    VAR_RGX: /(\[\[([A-Z0-9_]+)\]\])/g,
    MODES: [
        {label:'📋 Clipboard Only', bg:'#fcc459', sText:'➡️ Start (Copy)', sBg:'#fcc459', title:'Copies to clipboard.'},
        {label:'⌨️ Input Only', bg:'#8ab4f8', sText:'➡️ Start (Transfer)', sBg:'#8ab4f8', title:'Transfers to the input line.'},
        {label:'🚀 EXECUTE', bg:'#34a853', sText:'🚀 Start (Execute)', sBg:'#34a853', title:'Transfers and immediately executes.'}
    ],
    INIT_IDS: [`${Date.now()}p1`],
    SAVE_DEBOUNCE_MS: 500
};

// --- Utilities (U) ---
const U = {
    Fn: {
        debounce: (fn, delay) => {
            let timeoutId;
            return function(...args) {
                clearTimeout(timeoutId);
                timeoutId = setTimeout(() => { fn.apply(this, args); }, delay);
            };
        }
    },
    UI: {
        getEl: (id) => document.getElementById(id),
        findInput: () => document.querySelector(C.UI.INPUT_SELECTOR),
        /** Sets up input event listener and immediately triggers sizing based on content. */
        setupAutoResize: (ta, maxHeightMult) => {
            const autoResize = () => {
                ta.style.height='auto';
                ta.style.height=Math.min(ta.scrollHeight, window.innerHeight * maxHeightMult)+'px';
            };
            // Remove existing listener if present to prevent duplication
            if (ta.resizer) ta.removeEventListener('input', ta.resizer);
            ta.resizer = autoResize;
            ta.addEventListener('input', ta.resizer);
            // Trigger initial sizing after content is set
            setTimeout(autoResize, 0);
        },
        sendInput: (text) => {
            const inputElement = U.UI.findInput(); if (!inputElement) return false;
            try {
                inputElement.innerHTML=''; inputElement.focus(); document.execCommand('insertText', false, text);
                ['input','change','keydown','keypress','keyup'].forEach(eventName => inputElement.dispatchEvent(new Event(eventName,{bubbles:true})));
                inputElement.focus(); inputElement.scrollIntoView({behavior:'smooth',block:'center'}); return true;
            } catch (error) {console.error('Input injection error:',error); return false;}
        },
        executeInput: () => {
            const inputElement = U.UI.findInput(); if (!inputElement) return false;
            try {
                document.activeElement.blur(); inputElement.focus();
                const enterEventData = {key:'Enter',code:'Enter',keyCode:13,which:13,bubbles:true,cancelable:true};
                inputElement.dispatchEvent(new KeyboardEvent('keydown', enterEventData)); inputElement.dispatchEvent(new KeyboardEvent('keyup', enterEventData)); return true;
            } catch (error) {console.error('Execution error:',error); return false;}
        }
    }
};

// --- Persistence Service (P) ---
class PersistenceService {
    constructor(C) {
        this.C = C;
        this.S = C.STORAGE_KEYS;
        this.VERSION_KEY = C.VERSION;
    }
    _key(key) {
        if (key.startsWith(this.S.SLOT_PREFIX) || key === this.S.NAMES_KEY) { return key; }
        return this.VERSION_KEY + key;
    }
    async get(key, defaultValue) {
        try { return await GM_getValue(this._key(key), defaultValue); }
        catch (error) { console.error(`Persistence get failed for ${key}:`, error); return defaultValue; }
    }
    async set(key, value) {
        try { await GM_setValue(this._key(key), value); }
        catch (error) { console.error(`Persistence set failed for ${key}:`, error); }
    }
    async del(key) {
        try { await GM_deleteValue(this._key(key)); }
        catch (error) { console.error(`Persistence del failed for ${key}:`, error); }
    }
    async loadInitialAppState() {
        const {STORAGE_KEYS: S, INIT_IDS} = this.C;
        const [ids, visibility, mode, sNames] = await Promise.all([
            this.get(S.IDS_ORDER, INIT_IDS),
            this.get(S.VISIBILITY, true),
            this.get(S.MODE, 1),
            this.get(S.NAMES_KEY, {})
        ]);
        return { ids, visibility, mode, sNames };
    }
    async loadPartData(id, index) {
        const S = this.C.STORAGE_KEYS;
        const defaultName = `Part ${index + 1}`;
        const [savedPrompt, savedName, isCollapsed] = await Promise.all([
            this.get(S.CONTENT_PREFIX + id, ''),
            this.get(S.NAME_PREFIX + id, defaultName),
            this.get(S.COLLAPSED_PREFIX + id, false)
        ]);
        // Return raw data; CoreService will now handle the model creation/defaults
        return { content: savedPrompt, name: savedName, isCollapsed: isCollapsed };
    }
}

// --- State and Cache Management (StateService) ---
class StateService {
    constructor(C) {
        this.C = C;
        this._state = {
            ids:[], vis:true, drag:false, offX:0, offY:0, sNames:{}, isExecuting:false, mode:1,
            partsModel: {} // Centralized source of truth for part data
        };
        this._cache = {};
        this.U = U;
    }
    get state() { return this._state; }
    get cache() { return this._cache; }
    setInitialState(data) {
        this._state.ids = data.ids || this.C.INIT_IDS;
        this._state.vis = data.visibility !== undefined ? data.visibility : true;
        this._state.mode = data.mode !== undefined ? data.mode : 1;
        this._state.sNames = data.sNames || {};
    }
    populateCache(panelElement, handleElement) {
        const UI = this.C.UI;
        this._cache = {
            panel: panelElement, handle: handleElement, inputCtr: panelElement.querySelector(`#${UI.INPUT_CONTAINER}`),
            toggleBtn: U.UI.getEl(UI.TOGGLE_BUTTON), loadSel: U.UI.getEl(UI.LOAD_SELECT),
            exportSel: U.UI.getEl(UI.EXPORT_SELECT), exportBtn: U.UI.getEl(UI.EXPORT_BUTTON),
            importBtn: U.UI.getEl(UI.IMPORT_BUTTON), importFile: U.UI.getEl(UI.IMPORT_FILE),
            clearAllBtn: U.UI.getEl(UI.CLEAR_ALL_BUTTON), modeTgl: U.UI.getEl(UI.MODE_TOGGLE),
            startBtn: U.UI.getEl(UI.START_BUTTON), saveBtn: U.UI.getEl(UI.SAVE_BUTTON),
            addBtn: U.UI.getEl(UI.ADD_BUTTON),
            // New Modal Caching
            variableModal: U.UI.getEl(UI.MODAL_ID),
            // Notification Caching
            notificationModal: U.UI.getEl(UI.NOTIFY_ID),
            notifyTitle: U.UI.getEl(UI.NOTIFY_TITLE),
            notifyMessage: U.UI.getEl(UI.NOTIFY_MESSAGE),
            notifyConfirmCtn: U.UI.getEl(UI.NOTIFY_CONFIRM_CTN),
            notifyAlertCtn: U.UI.getEl(UI.NOTIFY_ALERT_CTN),
            notifyConfirmOk: U.UI.getEl(UI.NOTIFY_CONFIRM_OK),
            notifyConfirmCancel: U.UI.getEl(UI.NOTIFY_CONFIRM_CANCEL),
            notifyAlertOk: U.UI.getEl(UI.NOTIFY_ALERT_OK),
        };
    }
}

// --- UI Utility Classes ---

class UIUtils {
    // Note: The flashButton logic is now owned by NotificationService.
    static getStyles() {
        return `
            .gmp-base { position: fixed; z-index: 99999; width: 400px; max-height: 90vh; padding: 15px; background-color: #202124; border: 1px solid #5f6368; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.5); font-size: 14px; color: #e8eaed; overflow-y: auto; }
            .gmp-handle-style { position:fixed; z-index:99999; right:10px; top:10px; padding:6px 12px; background-color:#202124; border:1px solid #5f6368; border-radius:4px; box-shadow:0 4px 12px rgba(0,0,0,0.5); cursor:pointer; font-weight:bold; color:#8ab4f8; }
            .gmp-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; border-bottom: 1px solid #3c4043; padding-bottom: 8px; user-select: none; }
            .gmp-drag-title { font-weight: bold; cursor: move; flex-grow: 1; display: flex; align-items: center; color: #8ab4f8; }
            .gmp-title-icon { font-size: 1.2em; margin-right: 8px; }
            .gmp-header-btn { background: #3c4043; border: none; color: #8ab4f8; font-size: 1.1em; cursor: pointer; line-height: 1; padding: 4px 10px; border-radius: 4px; }
            .gmp-controls { display: flex; justify-content: space-between; gap: 8px; margin-bottom: 12px; }
            .gmp-btn { flex-grow: 1; background: #424446; color: #e8eaed; border: 1px solid #5f6368; border-radius: 4px; padding: 8px 0; font-weight: bold; cursor: pointer; transition: background-color 0.2s; }
            .gmp-btn:hover { background-color: #555759; }
            .gmp-main-btn { font-size: 1.1em; }
            .gmp-select { flex-grow: 2; padding: 6px; border: 1px solid #5f6368; border-radius: 4px; background: #3c4043; color: #e8eaed; font-weight: bold; cursor: pointer; -webkit-appearance: none; appearance: none; }
            .gmp-delete-opt { color:#f28b82; font-weight:bold; }
            .gmp-export-btn { flex-grow: 1; padding: 6px 0; }
            .gmp-input { flex-grow: 1; padding: 4px; border: 1px solid #5f6368; border-radius: 4px; background: #3c4043; color: #e8eaed; font-weight: bold; font-size: 0.9em; height: 28px; box-sizing: border-box; }
            .gmp-part-name { margin-right: 8px; }
            .gmp-resize-ta { width: 100%; min-height: 50px; color: #e8eaed; background: #242424; padding: 6px; border-radius: 4px; border: 1px solid #5f6368; box-sizing: border-box; resize: vertical; overflow-y: auto; }
            .gmp-flex-row { display: flex; align-items: center; margin-bottom: 5px; }
            .gmp-no-style { background: none; border: none; cursor: pointer; line-height: 1; padding: 0 4px; height: 24px; }
            .gmp-reorder { color: #5f6368; font-size: 1.1em; cursor: grab; margin-right: 8px; }
            .gmp-collapse-btn { color: #8ab4f8; font-size: 1.1em; margin-right: 5px; }
            .gmp-remove-btn { color: #f28b82; font-weight: bold; font-size: 1.2em; }
            .gmp-dragging{opacity:0.6;border:1px dashed #fcc459;}
            .prompt-input-group{margin-bottom: 12px; transition: opacity 0.3s;}

            /* --- Modal Styling for Variable Input & Notifications --- */
            .gmp-modal-backdrop { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background-color: rgba(0, 0, 0, 0.75); z-index: 100000; display: flex; justify-content: center; align-items: center; }
            .gmp-modal-content { background-color: #202124; padding: 25px; border-radius: 8px; box-shadow: 0 5px 15px rgba(0, 0, 0, 0.8); width: 90%; max-width: 500px; max-height: 90vh; overflow-y: auto; }
            .gmp-modal-title { font-size: 1.5em; margin-bottom: 15px; color: #8ab4f8; border-bottom: 1px solid #3c4043; padding-bottom: 10px; }

            /* Variable Input Specific */
            .gmp-modal-input-group { margin-bottom: 15px; }
            .gmp-modal-input-group label { display: block; margin-bottom: 5px; font-weight: bold; color: #e8eaed; }
            .gmp-modal-input { width: 100%; padding: 8px; border: 1px solid #5f6368; border-radius: 4px; background: #3c4043; color: #e8eaed; box-sizing: border-box; }

            /* Notification Specific */
            .gmp-notify-title { font-size: 1.3em; margin-bottom: 10px; font-weight: bold; }
            .gmp-notify-message { margin-bottom: 20px; color: #ccc; }

            .gmp-modal-footer { display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px; }
            .gmp-modal-footer .gmp-btn { padding: 10px 15px; }
        `;
    }
    static getPanelMarkup(state, C) {
        const UI = C.UI;
        const modeData = C.MODES[state.mode];
        return `
            <div class="${UI.HEADER}">
                <div class="${UI.DRAG_CLASS} gmp-drag-title" title="Drag to move">
                    <span class="gmp-title-icon">↔️💾</span> **Prompt Assembler**
                </div>
                <button id="${UI.TOGGLE_BUTTON}" title="Minimize Panel" class="gmp-header-btn">${state.vis ? '—' : '☐'}</button>
            </div>
            <div id="${UI.INPUT_CONTAINER}"></div>
            <div class="${UI.CONTROLS}">
                <button id="${UI.ADD_BUTTON}" class="${UI.BUTTON}">+ Add Part</button>
                <button id="${UI.SAVE_BUTTON}" class="${UI.BUTTON}">💾 Save Slot</button>
            </div>
            <div class="${UI.CONTROLS}">
                <select id="${UI.LOAD_SELECT}" class="${UI.SELECT}"><option value="">Load Slot...</option></select>
                <select id="${UI.EXPORT_SELECT}" class="${UI.SELECT}"><option value="">Export Slot...</option></select>
                <button id="${UI.EXPORT_BUTTON}" class="${UI.BUTTON} ${UI.EXPORT_BUTTON_CLS}">⬇️ Export</button>
            </div>
            <div class="${UI.CONTROLS}">
                <button id="${UI.IMPORT_BUTTON}" class="${UI.BUTTON}">⬆️ Import</button>
                <input type="file" id="${UI.IMPORT_FILE}" style="display:none;" accept=".txt">
                <button id="${UI.CLEAR_ALL_BUTTON}" class="${UI.BUTTON}">🗑️ Clear All</button>
            </div>
            <div class="${UI.CONTROLS}">
                <button id="${UI.MODE_TOGGLE}" title="Click to cycle mode." class="${UI.BUTTON}" style="background-color:${modeData.bg}; color:#202124;">${modeData.label}</button>
                <button id="${UI.START_BUTTON}" title="${modeData.title}" class="${UI.BUTTON} ${UI.MAIN_BUTTON}" style="background-color:${modeData.sBg};">${modeData.sText}</button>
            </div>
        `;
    }
    static getModalMarkup(C) {
        const UI = C.UI;
        return `
            <!-- Variable Input Modal -->
            <div id="${UI.MODAL_ID}" class="gmp-modal-backdrop" style="display: none;">
                <div class="gmp-modal-content">
                    <div class="gmp-modal-title">Variable Input Required</div>
                    <div id="${UI.MODAL_INPUT_CONTAINER}">
                        <!-- Variable inputs dynamically injected here -->
                    </div>
                    <div class="gmp-modal-footer">
                        <button id="${UI.MODAL_CANCEL}" class="${UI.BUTTON} gmp-modal-footer-btn" style="background-color: #f28b82;">Cancel</button>
                        <button id="${UI.MODAL_SUBMIT}" class="${UI.BUTTON} gmp-modal-footer-btn" style="background-color: #34a853;">Submit Prompt</button>
                    </div>
                </div>
            </div>

            <!-- Notification/Confirmation Modal -->
            <div id="${UI.NOTIFY_ID}" class="gmp-modal-backdrop" style="display: none;">
                <div class="gmp-modal-content">
                    <div id="${UI.NOTIFY_TITLE}" class="gmp-notify-title"></div>
                    <div id="${UI.NOTIFY_MESSAGE}" class="gmp-notify-message"></div>
                    <div class="gmp-modal-footer">
                        <!-- Confirmation Buttons -->
                        <div id="${UI.NOTIFY_CONFIRM_CTN}" style="display:none;">
                            <button id="${UI.NOTIFY_CONFIRM_CANCEL}" class="${UI.BUTTON} gmp-modal-footer-btn" style="background-color: #5f6368;">Cancel</button>
                            <button id="${UI.NOTIFY_CONFIRM_OK}" class="${UI.BUTTON} gmp-modal-footer-btn" style="background-color: #fcc459;">Confirm</button>
                        </div>
                        <!-- Alert Button -->
                        <div id="${UI.NOTIFY_ALERT_CTN}" style="display:none;">
                            <button id="${UI.NOTIFY_ALERT_OK}" class="${UI.BUTTON} gmp-modal-footer-btn" style="background-color: #8ab4f8;">OK</button>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }
}

class PanelManager {
    constructor(state, persistence) {
        this.state = state;
        this.persistence = persistence;
        this.C = state.C;
        this.UI = this.C.UI;
        this.S = this.C.STORAGE_KEYS;
    }
    async renderPanel() {
        const {state} = this.state;
        const panelElement = document.createElement('div'); panelElement.id = this.UI.PANEL_ID; panelElement.className = 'gmp-base';
        panelElement.innerHTML = UIUtils.getPanelMarkup(state, this.C);
        await this._loadPosition(panelElement);
        document.body.appendChild(panelElement);

        const handleElement = document.createElement('div'); handleElement.id = this.UI.HANDLE_ID; handleElement.className = 'gmp-handle-style';
        handleElement.textContent = '💾 Prompt Assembler [Show]'; handleElement.addEventListener('click', () => this.toggleVis(true));
        document.body.appendChild(handleElement);

        // Render the Modals outside the panel (appended to body)
        const modalElementContainer = document.createElement('div');
        modalElementContainer.innerHTML = UIUtils.getModalMarkup(this.C);
        // Append both modals (Variable Modal is firstChild, Notification Modal is lastChild)
        document.body.appendChild(modalElementContainer.firstChild);
        document.body.appendChild(modalElementContainer.lastChild);

        this._injectStyles();
        this._initDrag(panelElement);
        this.toggleVis(state.vis);

        return {panel: panelElement, handle: handleElement};
    }
    async toggleVis(shouldShow) {
        const {state, cache} = this.state;
        state.vis = (shouldShow!==undefined)?shouldShow:cache.panel.style.display!=='block';
        [cache.panel.style.display, cache.handle.style.display] = [state.vis?'block':'none', state.vis?'none':'block'];
        if (cache.toggleBtn) cache.toggleBtn.textContent = state.vis ? '—' : '☐';
        await this.persistence.set(this.S.VISIBILITY, state.vis);
    }
    updateModeVisuals(mode) {
        const {cache} = this.state;
        const modeData = this.C.MODES[mode];
        if (!cache.modeTgl || !cache.startBtn) return;
        cache.modeTgl.textContent = modeData.label; cache.modeTgl.style.backgroundColor = modeData.bg;
        cache.modeTgl.style.color='#202124'; cache.modeTgl.title = 'Click to cycle mode.';
        cache.startBtn.textContent = modeData.sText; cache.startBtn.style.backgroundColor = modeData.sBg; cache.startBtn.title = modeData.title;
    }
    _injectStyles() {
        const styleEl = document.createElement('style'); styleEl.textContent = UIUtils.getStyles();
        document.head.appendChild(styleEl);
    }
    _initDrag(panelElement) {
        const {state} = this.state;
        const handleElement = panelElement.querySelector(`.${this.UI.DRAG_CLASS}`); if (!handleElement) return;
        const endDrag = async() => {
            state.drag=false; document.removeEventListener('mousemove', onDrag); document.removeEventListener('mouseup', endDrag);
            await this.persistence.set(this.S.POSITION, {top:panelElement.style.top, left:panelElement.style.left}); panelElement.style.transition='top 0.2s,left 0.2s,right 0.2s';
        };
        const onDrag = (e) => {
            if (!state.drag) return;
            let [newX, newY] = [e.clientX-state.offX, e.clientY-state.offY];
            [newX, newY] = [Math.max(0,Math.min(newX,window.innerWidth-panelElement.offsetWidth)), Math.max(0,Math.min(newY,window.innerHeight-panelElement.offsetHeight))];
            [panelElement.style.left, panelElement.style.top, panelElement.style.right] = [`${newX}px`, `${newY}px`, 'auto'];
        };
        const startDrag = (e) => {
            state.drag=true; panelElement.style.transition='none';
            [state.offX, state.offY] = [e.clientX-panelElement.getBoundingClientRect().left, e.clientY-panelElement.getBoundingClientRect().top];
            document.addEventListener('mousemove', onDrag); document.addEventListener('mouseup', endDrag); e.preventDefault();
        };
        handleElement.addEventListener('mousedown', startDrag);
    }
    async _loadPosition(panelElement) {
        const savedPosition = await this.persistence.get(this.S.POSITION, null);
        if (savedPosition?.top && savedPosition?.left) {[panelElement.style.top, panelElement.style.left, panelElement.style.right] = [savedPosition.top, savedPosition.left, 'auto'];}
        else {[panelElement.style.top, panelElement.style.right, panelElement.style.left] = ['10px', '10px', 'auto'];}
    }
}

// --- Notification Service (NotificationService) ---
class NotificationService {
    constructor(state) {
        this.state = state;
        this.C = state.C;
        this.cache = state.cache; // Reference to the global cache
        this.resolve = null;
    }

    init() {
        if (!this.cache.notificationModal) return console.error('Notification modal elements not found.');

        // Add listeners for the confirmation/alert buttons
        this.cache.notifyConfirmOk?.addEventListener('click', () => this._handleNotificationResponse(true));
        this.cache.notifyConfirmCancel?.addEventListener('click', () => this._handleNotificationResponse(false));
        this.cache.notifyAlertOk?.addEventListener('click', () => this._handleNotificationResponse(true));

        // Enable closing via Escape key (for confirmation/alert)
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.cache.notificationModal.style.display === 'flex') {
                // If it's a confirmation, treat ESC as cancel (false)
                if (this.cache.notifyConfirmCtn.style.display === 'flex') {
                    this._handleNotificationResponse(false);
                } else {
                    // If it's just an alert, treat ESC as OK (true)
                    this._handleNotificationResponse(true);
                }
            }
        });
    }

    /** Hides the modal and resolves the current promise. */
    _handleNotificationResponse(result) {
        this.cache.notificationModal.style.display = 'none';
        if (this.resolve) {
            this.resolve(result);
            this.resolve = null;
        }
    }

    /** Shows a custom confirmation dialog (replaces native confirm()). */
    showConfirm(message, title = 'Confirmation Required', okLabel = 'Confirm', cancelLabel = 'Cancel') {
        this.cache.notifyTitle.textContent = title;
        this.cache.notifyMessage.textContent = message;

        this.cache.notifyConfirmCtn.style.display = 'flex';
        this.cache.notifyAlertCtn.style.display = 'none';
        this.cache.notifyConfirmOk.textContent = okLabel;
        this.cache.notifyConfirmCancel.textContent = cancelLabel;

        this.cache.notificationModal.style.display = 'flex';
        setTimeout(() => this.cache.notifyConfirmCancel.focus(), 10); // Focus cancel by default

        return new Promise(resolve => {
            this.resolve = resolve;
        });
    }

    /** Shows a custom alert dialog (replaces native alert()). */
    showAlert(message, title = 'Attention', okLabel = 'OK') {
        this.cache.notifyTitle.textContent = title;
        this.cache.notifyMessage.textContent = message;

        this.cache.notifyConfirmCtn.style.display = 'none';
        this.cache.notifyAlertCtn.style.display = 'flex';
        this.cache.notifyAlertOk.textContent = okLabel;

        this.cache.notificationModal.style.display = 'flex';
        setTimeout(() => this.cache.notifyAlertOk.focus(), 10);

        return new Promise(resolve => {
            this.resolve = resolve;
        });
    }

    /** Flashes a button with temporary feedback (replaces UIUtils.flashButton). */
    flashButton(id, text, color, originalText, originalColor) {
        const btn = this.cache[id] || U.UI.getEl(id);
        if (!btn) return;

        [originalText, originalColor] = [originalText||btn.textContent, originalColor||btn.style.backgroundColor];
        btn.textContent = text; btn.style.backgroundColor = color;

        setTimeout(() => {
            // Check if the content changed during the flash duration (e.g., another action started)
            if (btn.textContent === text) {
                btn.textContent=originalText;
                btn.style.backgroundColor=originalColor;
            }
        }, 1500);
    }
}

// --- Modal Manager (ModalManager) ---
class ModalManager {
    constructor(state) {
        this.state = state;
        this.C = state.C;
        this.UI = this.C.UI;
        this.modal = null;
        this.inputContainer = null;
        this.resolve = null;
        this.reject = null;
    }

    init() {
        this.modal = U.UI.getEl(this.UI.MODAL_ID);
        this.inputContainer = U.UI.getEl(this.UI.MODAL_INPUT_CONTAINER);
        if (!this.modal || !this.inputContainer) {
            console.error('Variable modal elements not found.');
            return;
        }

        U.UI.getEl(this.UI.MODAL_SUBMIT)?.addEventListener('click', () => this._handleSubmit());
        U.UI.getEl(this.UI.MODAL_CANCEL)?.addEventListener('click', () => this._handleCancel());

        // Enable closing via Escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.modal.style.display === 'flex') {
                this._handleCancel();
            }
        });
    }

    /** Shows the modal and returns a Promise that resolves with the variable inputs. */
    show(variables) {
        this.inputContainer.innerHTML = '';
        const inputs = {};

        variables.forEach(varName => {
            const inputId = `var-input-${varName}`;
            const group = document.createElement('div');
            group.className = 'gmp-modal-input-group';
            group.innerHTML = `
                <label for="${inputId}">[[${varName}]]</label>
                <input type="text" id="${inputId}" class="gmp-modal-input" placeholder="Enter value for ${varName}" data-var-name="${varName}">
            `;
            this.inputContainer.appendChild(group);
            inputs[varName] = group.querySelector(`#${inputId}`);
        });

        // Focus the first input field
        setTimeout(() => inputs[variables[0]]?.focus(), 10);

        this.modal.style.display = 'flex';

        return new Promise((resolve, reject) => {
            this.resolve = resolve;
            this.reject = reject;
        });
    }

    hide() {
        this.modal.style.display = 'none';
        this.resolve = null;
        this.reject = null;
    }

    _handleSubmit() {
        const inputs = this.inputContainer.querySelectorAll('.gmp-modal-input');
        const replacements = {};

        inputs.forEach(input => {
            const varName = input.dataset.varName;
            const value = input.value.trim();
            replacements[varName] = value;
        });

        this.hide();
        this.resolve(replacements);
    }

    _handleCancel() {
        this.hide();
        // Resolve with a cancellation marker instead of rejecting, to be handled gracefully in ActionService
        this.resolve({ cancelled: true });
    }
}

class DropdownManager {
    constructor(state) {
        this.state = state;
        this.C = state.C;
        this.S = this.C.STORAGE_KEYS;
        this.UI = this.C.UI;
    }
    updateDropdowns = async (sNames) => {
        const {loadSel, exportSel} = this.state.cache; const S = this.S; const UI = this.UI;
        if (!loadSel || !exportSel) return;
        const createBaseOptions = (title) => {
            const base = document.createElement('option'); base.value = ''; base.textContent = title;
            const divider = document.createElement('option'); divider.disabled = true; divider.textContent = '—————————';
            return [base, divider];
        };
        const updateSelect = (selectEl, title, includeDelete) => {
            selectEl.innerHTML = '';
            const fragment = document.createDocumentFragment();
            createBaseOptions(title).forEach(opt => fragment.appendChild(opt));

            const slots = Object.keys(sNames).filter(key=>key.startsWith(S.SLOT_PREFIX)).sort((a,b)=>sNames[a].localeCompare(sNames[b]));
            slots.forEach(key => {
                const name = sNames[key], display = name.substring(0,30)+(name.length>30?'...':'');
                const opt = document.createElement('option'); opt.value = key; opt.textContent = selectEl === loadSel ? `▶ ${display}` : display;
                fragment.appendChild(opt);

                if (includeDelete) {
                    const deleteOpt = document.createElement('option');
                    deleteOpt.value = S.DELETE_PREFIX + key;
                    deleteOpt.textContent = `🗑️ [DELETE] ${display}`;
                    deleteOpt.className = UI.DELETE_OPTION;
                    fragment.appendChild(deleteOpt);
                }
            });
            selectEl.appendChild(fragment);
        };
        updateSelect(loadSel, 'Load Slot...', true);
        updateSelect(exportSel, 'Export Slot...', false);
    }
}

class PartUIManager {
    constructor(state, coreCallbacks) {
        this.state = state;
        this.C = state.C;
        this.S = this.C.STORAGE_KEYS;
        this.UI = this.C.UI;
        this.callbacks = coreCallbacks;
    }
    /** Toggles the visual state of collapse and sets the button icon. */
    toggleCollapseVisuals = (id, newIsCollapsedState) => {
        const {inputCtr} = this.state.cache;
        const group = inputCtr.querySelector(`#group-${id}`); if (!group) return;
        const [contentDiv, collapseBtn] = [group.querySelector(`#content-${id}`), group.querySelector(`#collapse-btn-${id}`)];
        if (!contentDiv || !collapseBtn) return;
        [contentDiv.style.display, collapseBtn.textContent] = [newIsCollapsedState ? 'none' : 'block', newIsCollapsedState ? '▶' : '▼'];
    }
    /** Applies fetched data to the part's UI elements. */
    applyPartData(id, savedPrompt, savedName, isCollapsed) {
        const {inputCtr} = this.state.cache;
        const [fieldId, nameId] = [this.S.CONTENT_PREFIX + id, this.S.NAME_PREFIX + id];
        const group = inputCtr.querySelector(`#group-${id}`); if (!group) return;
        const [promptInput, nameInput] = [
            group.querySelector(`#${fieldId}`),
            group.querySelector(`#${nameId}`),
        ];
        if (promptInput) {
            promptInput.value = savedPrompt;
            // Use the abstracted utility via callback to ensure proper listener management
            this.callbacks.setupResize(promptInput);
        }
        if (nameInput) nameInput.value = savedName;
        this.toggleCollapseVisuals(id, isCollapsed);
    }
    updateLabels(ids) {
        const {inputCtr} = this.state.cache; if (!inputCtr) return;
        ids.forEach((id, index) => {
            const group = inputCtr.querySelector(`#group-${id}`);
            const [nameInput, promptInput] = [group?.querySelector(`#${this.S.NAME_PREFIX+id}`), group?.querySelector(`#${this.S.CONTENT_PREFIX+id}`)];
            const defaultName = `Part ${index+1}`;
            if (nameInput) { if (nameInput.value.startsWith('Part ') || nameInput.value.trim() === '') nameInput.value = defaultName; }
            if (promptInput) promptInput.placeholder = `Input for prompt part ${index+1}... Use [[VAR_NAME]] for variables.`;
        });
    }
    removeGroupUI = (id) => {
        U.UI.getEl(`group-${id}`)?.remove();
    }
    /** Initializes drag-and-drop for reordering. */
    _initReorder = (group) => {
        const {inputCtr} = this.state.cache;
        const handle = group.querySelector(`.${this.UI.REORDER_HANDLE}`); if (!handle || !inputCtr) return;
        const endDrag = () => {
            group.classList.remove('gmp-dragging');
            document.removeEventListener('mousemove', onDragOver);
            document.removeEventListener('mouseup', endDrag);

            const newIds = Array.from(inputCtr.children)
                .map(g => g.id.replace('group-', ''))
                .filter(Boolean);
            this.callbacks.updateOrder(newIds);
        };
        const onDragOver = (e) => {
            if (!group.classList.contains('gmp-dragging')) return;
            const targetGroup = e.target.closest(`.${this.UI.PART_GROUP}`);
            if (!targetGroup || targetGroup === group || !inputCtr.contains(targetGroup)) return;
            const isBelow = e.clientY > (targetGroup.getBoundingClientRect().top + targetGroup.offsetHeight / 2);
            targetGroup.insertAdjacentElement(isBelow ? 'afterend' : 'beforebegin', group);
        };
        const startDrag = (e) => {
            group.classList.add('gmp-dragging');
            document.addEventListener('mousemove', onDragOver);
            document.addEventListener('mouseup', endDrag);
            e.preventDefault();
        };
        handle.addEventListener('mousedown', startDrag);
    }

    _createHeaderRowElements = (id, nameId, index) => {
        const flexRow = document.createElement('div'); flexRow.className = this.UI.FLEX_ROW;

        const reorderBtn = document.createElement('button');
        reorderBtn.className = `${this.UI.REORDER_HANDLE} gmp-no-style`; reorderBtn.title = "Drag to reorder part"; reorderBtn.textContent = '☰';

        const collapseBtn = document.createElement('button');
        collapseBtn.id = `collapse-btn-${id}`; collapseBtn.className = `gmp-no-style gmp-collapse-btn`; collapseBtn.title = "Toggle Collapse";
        collapseBtn.addEventListener('click',()=>this.callbacks.toggleCollapse(id));

        const nameInput = document.createElement('input');
        nameInput.type = 'text'; nameInput.id = nameId; nameInput.placeholder = "Custom Part Name";
        nameInput.className = `${this.UI.INPUT} gmp-part-name`;
        nameInput.addEventListener('input', (e) => this.callbacks.updateModel(id, 'name', e.target.value));

        const removeBtn = document.createElement('button');
        removeBtn.className = `remove-part-btn ${this.UI.REMOVE_BUTTON} gmp-no-style`; removeBtn.title = "Remove this part"; removeBtn.textContent = '×';
        removeBtn.addEventListener('click',()=>this.callbacks.removeGroup(id));

        [reorderBtn, collapseBtn, nameInput, removeBtn].forEach(el => flexRow.appendChild(el));
        return { flexRow, reorderBtn, collapseBtn, nameInput, removeBtn };
    }

    _createTextArea = (id, index) => {
        const [fieldId] = [this.S.CONTENT_PREFIX + id];
        const contentDiv = document.createElement('div'); contentDiv.id = `content-${id}`;

        const textArea = document.createElement('textarea');
        textArea.id = fieldId; textArea.className = `${this.UI.INPUT} ${this.UI.RESIZE_TEXTAREA}`;
        textArea.placeholder = `Input for prompt part ${index}... Use [[VAR_NAME]] for variables.`;
        textArea.style.maxHeight = `${this.C.MAX_H_MULT * 100}vh`;
        textArea.addEventListener('input', (e) => this.callbacks.updateModel(id, 'content', e.target.value));

        contentDiv.appendChild(textArea);
        return { contentDiv, textArea };
    }

    /** Creates and appends the UI group for a new prompt part. */
    createGroupUI = (id, index) => {
        const {inputCtr} = this.state.cache;
        const [nameId] = [this.S.NAME_PREFIX + id];
        const group = document.createElement('div'); group.id = `group-${id}`; group.className = this.UI.PART_GROUP;

        const { flexRow } = this._createHeaderRowElements(id, nameId, index);
        const { contentDiv } = this._createTextArea(id, index);

        group.appendChild(flexRow);
        group.appendChild(contentDiv);
        inputCtr.appendChild(group);

        this._initReorder(group);
        return group;
    }
}


// --- Core Logic (CoreService) - Data/Model Orchestrator ---
class CoreService {
    constructor(stateService, uiManagers, persistenceService, notificationService) {
        this.state = stateService;
        this.persistence = persistenceService;
        this.notifications = notificationService;
        this.C = stateService.C;
        this.U = stateService.U;
        this.S = this.C.STORAGE_KEYS;
        this.panelManager = uiManagers.panelManager;
        this.dropdownManager = uiManagers.dropdownManager;
        this.partUIManager = uiManagers.partUIManager;
        this.debouncedSaveAll = this.U.Fn.debounce(() => this.saveAll(), this.C.SAVE_DEBOUNCE_MS);
    }
    flash(id, text, color, originalText, originalColor) {
        this.notifications.flashButton(id, text, color, originalText, originalColor);
    }
    /** Factory method to create a consistent part model structure with defaults. */
    _createPartModel(id, partData = {}, index = 0) {
        const defaultName = `Part ${index + 1}`;
        return {
            id: id,
            content: partData.content || '',
            name: partData.name || defaultName,
            isCollapsed: partData.isCollapsed || false
        };
    }
    // New utility method to expose auto-resize from Core to UIManager
    setupPartResize = (ta) => {
        this.U.UI.setupAutoResize(ta, this.C.MAX_H_MULT);
    }
    updatePartModel = (id, key, value) => {
        const part = this.state.state.partsModel[id];
        if (!part) {console.warn(`Part model not found for ID: ${id}`); return;}
        part[key] = value;
        this.debouncedSaveAll();
    }
    updateOrder = (newIds) => {
        this.state.state.ids = newIds;
        this.debouncedSaveAll();
        this.partUIManager.updateLabels(newIds);
    }
    getPartsData() {
        return this.state.state.ids
            .map(id => this.state.state.partsModel[id])
            .filter(part => part?.content || part?.name);
    }
    async saveAll() {
        if (!this.state.cache.inputCtr) return;
        const {ids, partsModel} = this.state.state;
        if (ids.length === 0) {
            return await this.persistence.set(this.S.IDS_ORDER, []);
        }
        const persistOps = ids.flatMap(id => {
            const part = partsModel[id];
            if (!part) return [];
            return [
                this.persistence.set(this.S.CONTENT_PREFIX + id, part.content || ''),
                this.persistence.set(this.S.NAME_PREFIX + id, part.name),
                this.persistence.set(this.S.COLLAPSED_PREFIX + id, part.isCollapsed)
            ];
        });
        await Promise.all([...persistOps, this.persistence.set(this.S.IDS_ORDER, ids)]);
    }
    /** Initializes a part by creating the model and rendering the UI. */
    initializePart(id, partData, index) {
        // 1. Initialize Model (Source of Truth) using the centralized factory
        this.state.state.partsModel[id] = this._createPartModel(id, partData, index);
        const part = this.state.state.partsModel[id];
        // 2. Render UI (View)
        this.partUIManager.createGroupUI(id, index + 1);
        this.partUIManager.applyPartData(id, part.content, part.name, part.isCollapsed);
    }
    loadPartsIntoUI = async (partsData) => {
        if (!this.state.cache.inputCtr) return false;
        await this.clearAllParts(false, false);
        const newIds = [];
        const loadOps = partsData.map(async (part, index) => {
            const newId = part.id || `${Date.now()}_${index}_L`; newIds.push(newId);
            // Use factory method to ensure imported part data is correctly structured
            const model = this._createPartModel(newId, part, index);
            this.state.state.partsModel[newId] = model;
            await Promise.all([
                this.persistence.set(this.S.CONTENT_PREFIX + newId, model.content),
                this.persistence.set(this.S.NAME_PREFIX + newId, model.name),
                this.persistence.set(this.S.COLLAPSED_PREFIX + newId, model.isCollapsed)
            ]);
            this.initializePart(newId, model, index);
        });
        await Promise.all(loadOps);
        this.state.state.ids = newIds;
        await this.saveAll();
        return true;
    }
    clearAllParts = async (doConfirm = true, doFlash = true) => {
        if (doConfirm) {
            const confirmed = await this.notifications.showConfirm("This will delete ALL current prompt parts. Are you sure?", "Delete All Parts");
            if (!confirmed) return;
        }

        const {ids} = this.state.state;
        const clearOps = ids.flatMap(id => {
            this.partUIManager.removeGroupUI(id);
            return [this.S.CONTENT_PREFIX, this.S.NAME_PREFIX, this.S.COLLAPSED_PREFIX].map(pre => this.persistence.del(pre + id));
        });
        await Promise.all(clearOps);
        this.state.state.ids = [];
        this.state.state.partsModel = {};
        await this.persistence.set(this.S.IDS_ORDER, this.state.state.ids);
        this.partUIManager.updateLabels(this.state.state.ids);
        if (doFlash && this.state.cache.clearAllBtn) this.flash(this.C.UI.CLEAR_ALL_BUTTON, '🗑️ Cleared!', '#f28b82');
    }
    /** Assembles the raw prompt and extracts unique variables. */
    assemblePrompt = () => {
        let rawPrompt = this.state.state.ids.map(id => this.state.state.partsModel[id]?.content).filter(Boolean).join('\n\n').trim();
        const variables = new Set();
        // Reset the regex state before execution to ensure we find all matches from the start
        this.C.VAR_RGX.lastIndex = 0;
        let match;
        while ((match = this.C.VAR_RGX.exec(rawPrompt)) !== null) {
            // match[2] is the inner variable name (e.g., "TOPIC")
            variables.add(match[2]);
        }
        // Return raw prompt and unique variable names (string array)
        return { rawPrompt, variables: Array.from(variables) };
    }
    addGroup = async () => {
        const newId=`${Date.now()}_${Math.random().toString(36).substring(2,6)}`;
        this.state.state.ids.push(newId);
        const index = this.state.state.ids.length - 1;
        // Initialization uses the factory method implicitly
        this.initializePart(newId, {}, index);
        await this.saveAll();
        this.state.cache.inputCtr.querySelector(`#group-${newId}`)?.scrollIntoView({behavior:'smooth',block:'end'});
    }
    removeGroup = async (id) => {
        this.partUIManager.removeGroupUI(id);
        delete this.state.state.partsModel[id];
        this.state.state.ids = this.state.state.ids.filter(partId => partId !== id);
        await Promise.all([this.S.CONTENT_PREFIX, this.S.NAME_PREFIX, this.S.COLLAPSED_PREFIX].map(pre => this.persistence.del(pre + id)));
        await this.saveAll();
    }
    toggleCollapse = async (id) => {
        const part = this.state.state.partsModel[id]; if (!part) return;
        const isCollapsed = !part.isCollapsed;
        part.isCollapsed = isCollapsed;
        this.partUIManager.toggleCollapseVisuals(id, isCollapsed);
        await this.persistence.set(this.S.COLLAPSED_PREFIX + id, isCollapsed);
    }
    toggleMode = async () => {
        const {state, cache} = this.state;
        state.mode = (state.mode + 1) % this.C.MODES.length; await this.persistence.set(this.S.MODE, state.mode);
        this.panelManager.updateModeVisuals(state.mode);
    }
}

// --- Action Service (ActionService) - Feature Execution Layer ---
class ActionService {
    constructor(coreService, stateService, uiManagers, modalManager, persistenceService, notificationService) {
        this.core = coreService;
        this.state = stateService;
        this.persistence = persistenceService;
        this.modalManager = modalManager;
        this.notifications = notificationService; // New dependency
        this.dropdownManager = uiManagers.dropdownManager;
        this.C = coreService.C;
        this.U = coreService.U;
        this.S = coreService.S;
    }

    /** Executes the action based on the current mode (Copy-Only, Transfer-Only, Execute). */
    handleStartAction = async () => {
        const {state, cache} = this.state; const UI = this.C.UI;
        if (state.isExecuting || !cache.startBtn) return;
        state.isExecuting=true;

        let result = { status: 'failure', message: '❌ CRITICAL FAILED', color: '#f28b82' };
        const [originalText, originalColor] = [cache.startBtn.textContent, cache.startBtn.style.backgroundColor];
        let finalPrompt = '';

        try {
            await this.core.saveAll();
            const { rawPrompt, variables } = this.core.assemblePrompt();
            finalPrompt = rawPrompt;

            if (!rawPrompt) {
                result = { status: 'warning', message: '⚠️ Prompt Empty', color: '#fcc459' };
            } else {
                if (variables.length > 0) {
                    // *** ASYNCHRONOUS VARIABLE SUBSTITUTION ***
                    const substitutionResult = await this._substituteVariables(rawPrompt, variables);

                    if (substitutionResult.cancelled) {
                        result = { status: 'warning', message: '⚠️ Variable Input Cancelled', color: '#fcc459' };
                        // Throw to exit the rest of the try block and move to finally
                        throw new Error('Variable Input Cancelled');
                    }
                    finalPrompt = substitutionResult.prompt;
                }

                switch (state.mode) {
                    case 0: result = await this._executeModeClipboard(finalPrompt); break;
                    case 1: result = await this._executeModeTransfer(finalPrompt); break;
                    case 2: result = await this._executeModeExecute(finalPrompt); break;
                    default: console.warn(`Invalid execution mode: ${state.mode}`);
                }
            }
        } catch (err) {
            if (err.message !== 'Variable Input Cancelled') {
                console.error('Start Action failed (Critical Error):', err);
            }
            // Result remains default critical failure or the cancelled warning
        } finally {
            this.core.flash(UI.START_BUTTON, result.message, result.color, originalText, originalColor);
            setTimeout(() => state.isExecuting=false, 1500);
        }
    }

    /** Prompts the user for each variable using the ModalManager and performs substitution. */
    _substituteVariables = async (rawPrompt, variables) => {
        let finalPrompt = rawPrompt;

        // ModalManager handles the UI and returns a promise that resolves with the replacements map.
        const replacements = await this.modalManager.show(variables);

        if (replacements.cancelled) {
            return { cancelled: true };
        }

        // Perform substitution based on the returned map
        for (const varName of variables) {
            const value = replacements[varName] || ''; // Use empty string if value is missing/undefined
            // Create a specific, non-global regex for this variable to ensure all instances are replaced
            const varRegex = new RegExp('\\[\\[' + varName + '\\]\\]', 'g');
            finalPrompt = finalPrompt.replace(varRegex, value);
        }

        return { cancelled: false, prompt: finalPrompt };
    }

    /** Mode 0: Copies the prompt directly to the clipboard. */
    _executeModeClipboard = async (prompt) => {
        try {
            await navigator.clipboard.writeText(prompt);
            const modeLabel = this.C.MODES[0].label.split(' ')[0];
            return { status: 'success', message: `✅ Copied (${modeLabel})`, color: this.C.MODES[0].bg };
        } catch (error) {
            return { status: 'failure', message: '❌ Copy Failed', color: '#f28b82' };
        }
    }

    /** Mode 1: Transfers the prompt to the input, with clipboard fallback on failure. */
    _executeModeTransfer = async (prompt) => {
        const transferSuccess = this.U.UI.sendInput(prompt);
        if (transferSuccess) {
            return { status: 'success', message: '✅ Transferred!', color: this.C.MODES[1].bg };
        } else {
            await navigator.clipboard.writeText(prompt); // Fallback copy
            return { status: 'warning', message: '⚠️ Transfer Failed (Copied)', color: '#f28b82' };
        }
    }

    /** Mode 2: Transfers the prompt and immediately simulates Enter press. */
    _executeModeExecute = async (prompt) => {
        const transferSuccess = this.U.UI.sendInput(prompt);
        if (transferSuccess) {
            await new Promise(r=>setTimeout(r,50)); // Small delay for rendering
            const executeSuccess = this.U.UI.executeInput();
            return executeSuccess ? { status: 'success', message: '✅ Executed!', color: this.C.MODES[2].bg } :
                                   { status: 'failure', message: '❌ Execute Failed', color: '#f28b82' };
        } else {
            await navigator.clipboard.writeText(prompt); // Fallback copy
            return { status: 'warning', message: '⚠️ Transfer Failed (Copied)', color: '#f28b82' };
        }
    }

    handleSaveSlot = async (partsData, slotName) => {
        const {state, cache} = this.state; const UI = this.C.UI; const S = this.S;
        if (!cache.saveBtn) return false;
        const [originalText, originalColor] = [cache.saveBtn.textContent, cache.saveBtn.style.backgroundColor];
        if (!partsData) { await this.core.saveAll(); partsData = this.core.getPartsData(); }
        if (partsData.length === 0) return this.core.flash(UI.SAVE_BUTTON, '⚠️ Prompt Empty', '#fcc459', originalText, originalColor);

        // Use custom input modal for saving (not yet fully implemented in modal manager, so sticking to old prompt for now)
        const name = prompt("Enter a name for this prompt configuration:");

        if (!name?.trim()) return false;
        try {
            const key = S.SLOT_PREFIX+Date.now(); await this.persistence.set(key, partsData);
            state.sNames[key]=name.trim(); await this.persistence.set(S.NAMES_KEY, state.sNames);
            await this.dropdownManager.updateDropdowns(state.sNames); this.core.flash(UI.SAVE_BUTTON, `✅ Saved: ${name.substring(0,20)}...`, '#34a853', originalText, originalColor); return true;
        } catch (error) {
            console.error('Save slot failed:', error); this.core.flash(UI.SAVE_BUTTON, '❌ Save Failed', '#f28b82', originalText, originalColor); return false;
        }
    }
    handleDeleteSlot = async (key) => {
        const {state, cache} = this.state; const S = this.S;
        const name=state.sNames[key]||'Unknown Slot';

        const confirmed = await this.notifications.showConfirm(`Permanently delete "${name}"?`, "Confirm Deletion");
        if(!confirmed) return;

        await this.persistence.del(key); delete state.sNames[key]; await this.persistence.set(S.NAMES_KEY, state.sNames);
        await this.dropdownManager.updateDropdowns(state.sNames); if(cache.saveBtn) this.core.flash(this.C.UI.SAVE_BUTTON, '✅ Slot Deleted!', '#34a853');
    }
    handleLoadSlot = async (event) => {
        const {cache, state} = this.state; const S = this.S;
        if (!cache.loadSel) return;
        const slotKey=event.target.value; if (!slotKey) {event.target.value=''; return;} event.target.value='';
        if(slotKey.startsWith(S.DELETE_PREFIX)) { this.handleDeleteSlot(slotKey.replace(S.DELETE_PREFIX,'')); return; }
        const slotName = state.sNames[slotKey]||'this configuration';
        try {
            const partsConfig = await this.persistence.get(slotKey, null);
            if (!Array.isArray(partsConfig) || partsConfig.length === 0) throw new Error('Load failed or slot was empty.');

            const confirmed = await this.notifications.showConfirm(`Load "${slotName}"? This will REPLACE all current parts.`, "Confirm Load");
            if (!confirmed) return;

            await this.core.loadPartsIntoUI(partsConfig); this.core.flash(this.C.UI.LOAD_SELECT, '✅ Loaded!', '#34a853');
        } catch(error) {
            console.error('Load Slot Failed:',error);
            this.core.flash(this.C.UI.LOAD_SELECT, '❌ Load Failed', '#f28b82');
            this.notifications.showAlert(`Load failed: ${error.message||'Unknown error.'}`, "Error");
        }
    }
    handleExportLoadout = async () => {
        const {cache, state} = this.state; const UI = this.C.UI;
        if (!cache.exportSel || !cache.exportSel.value) {this.core.flash(UI.EXPORT_BUTTON, '⚠️ Select Slot', '#fcc459'); return;}
        if (!cache.exportBtn) return;
        const [originalText, originalColor] = [cache.exportBtn.textContent, cache.exportBtn.style.backgroundColor];
        try {
            const partsData = await this.persistence.get(cache.exportSel.value, null);
            const slotName = state.sNames[cache.exportSel.value] || 'Unknown Loadout';
            if (!Array.isArray(partsData) || partsData.length === 0) throw new Error('Selected slot is empty or invalid.');
            const parts = partsData.map((part, index) => `### PART NAME: ${part.name || `Part ${index+1}`}\n${part.content.trim()}`);
            const text = `// Gemini Prompt Assembler Loadout Export v${GM_info.script.version}\n// Export Date: ${new Date().toISOString()}\n// Loadout Name: ${slotName}\n\n` + parts.join('\n\n---\n\n');
            const downloadLink = document.createElement('a'); downloadLink.href=URL.createObjectURL(new Blob([text],{type:'text/plain'})); downloadLink.download=`${slotName.replace(/[<>:"/\\|?*]/g, '-')}.txt`;
            document.body.appendChild(downloadLink); downloadLink.click(); document.body.removeChild(downloadLink); URL.revokeObjectURL(downloadLink.href);
            this.core.flash(UI.EXPORT_BUTTON, `✅ Exported`, '#34a853', originalText, originalColor); cache.exportSel.value = '';
        } catch(error) {
            console.error('Export failed:',error);
            this.core.flash(UI.EXPORT_BUTTON, '❌ Export Failed', '#f28b82', originalText, originalColor);
            this.notifications.showAlert(`Export failed: ${error.message||'Unknown error.'}`, "Error");
        }
    }
    handleImportLoadout = async () => {
        const {cache} = this.state; const UI = this.C.UI;
        if (!cache.importFile || !cache.importBtn) return;

        const confirmed = await this.notifications.showConfirm("Importing will REPLACE current parts AND automatically save the imported configuration as a new slot. Continue?", "Confirm Import");
        if (!confirmed) { this.core.flash(UI.IMPORT_BUTTON,'Import Cancelled','#fcc459'); return;}

        cache.importFile.click();
        cache.importFile.onchange = (event) => {
            const file = event.target.files[0];
            if (!file) {this.core.flash(UI.IMPORT_BUTTON,'Import Cancelled','#fcc459'); return;}

            const reader = new FileReader();
            reader.onload = async (readerEvent) => {
                try {
                    const importFileName = file.name.replace(/\.txt$/i, '').trim();
                    const partsData = [], partBlocks = readerEvent.target.result.split('\n\n---\n\n').filter(block=>block.trim()!=='');
                    partBlocks.forEach((block, index) => {
                        let [content, name] = [block.trim(), `Part ${index+1}`];
                        const nameMatch=block.match(/### PART NAME: (.+)/i);
                        if(nameMatch) {name=nameMatch[1].trim(); content=block.replace(nameMatch[0],'').trim();}
                        partsData.push({id:`${Date.now()}_${index}_imp`,content:content,name:name,isCollapsed:false});
                    });
                    if(partsData.length===0) throw new Error("No valid prompt parts found.");

                    await this.core.loadPartsIntoUI(partsData);
                    const saved = await this.handleSaveSlot(partsData, importFileName);
                    this.core.flash(UI.IMPORT_BUTTON, saved ? `✅ Imported & Saved` : '⚠️ Imported (Save Failed)', saved ? '#34a853' : '#fcc459');
                } catch (error) {
                    console.error('Loadout import failed:', error);
                    this.core.flash(UI.IMPORT_BUTTON, '❌ Import Failed', '#f28b82');
                    this.notifications.showAlert(`Loadout import failed: ${error.message}`, "Error");
                }
            };
            reader.readAsText(file); cache.importFile.value='';
        };
    }
}


/** Centralizes all event listeners for the main panel controls. */
function addListeners(coreService, actionService, panelManager) {
    const {cache} = coreService.state;

    cache.panel.addEventListener('contextmenu', event=>event.preventDefault());
    cache.toggleBtn?.addEventListener('click', () => panelManager.toggleVis());

    // Core Actions (Execution Layer)
    cache.startBtn?.addEventListener('click', actionService.handleStartAction);
    cache.saveBtn?.addEventListener('click', () => actionService.handleSaveSlot());
    cache.loadSel?.addEventListener('change', (event) => actionService.handleLoadSlot(event));
    cache.exportBtn?.addEventListener('click', actionService.handleExportLoadout);
    cache.importBtn?.addEventListener('click', actionService.handleImportLoadout);

    // Data/State Actions (Core Layer)
    cache.clearAllBtn?.addEventListener('click', () => coreService.clearAllParts());
    cache.modeTgl?.addEventListener('click', () => coreService.toggleMode());
    cache.addBtn?.addEventListener('click', coreService.addGroup);
}

// --- Initialization ---

async function init() {
    // 1. Initialize Persistence Service
    const persistence = new PersistenceService(C);

    // 2. Load primary application state data from persistence
    const appData = await persistence.loadInitialAppState();

    // 3. Initialize State Service and set the loaded data (pure in-memory state)
    const state = new StateService(C);
    state.setInitialState(appData);

    // 4. Initialize Managers and Services (Order matters for cache population)
    const modalManager = new ModalManager(state);

    const partUIManagerCallbacks = { removeGroup: null, toggleCollapse: null, updateModel: null, updateOrder: null, setupResize: null };

    const panelManager = new PanelManager(state, persistence);
    const dropdownManager = new DropdownManager(state);
    const uiManagers = { panelManager, dropdownManager, partUIManager: new PartUIManager(state, partUIManagerCallbacks) };

    // 5. Render UI and Populate Cache (MUST happen before NotificationService init)
    const {panel, handle} = await panelManager.renderPanel();
    state.populateCache(panel, handle);

    // 6. Initialize services dependent on cached elements
    const notificationService = new NotificationService(state);
    notificationService.init();
    modalManager.init();

    // 7. Initialize Core and Action Services, injecting the new NotificationService
    const coreService = new CoreService(state, uiManagers, persistence, notificationService);
    const actionService = new ActionService(coreService, state, uiManagers, modalManager, persistence, notificationService);

    // 8. Complete the PartUIManager callback closure with coreService methods
    partUIManagerCallbacks.removeGroup = coreService.removeGroup;
    partUIManagerCallbacks.toggleCollapse = coreService.toggleCollapse;
    partUIManagerCallbacks.updateModel = coreService.updatePartModel;
    partUIManagerCallbacks.updateOrder = coreService.updateOrder;
    partUIManagerCallbacks.setupResize = coreService.setupPartResize;

    // 9. Load Part Groups: Fetch individual part data and initialize model/UI
    const partCreationOps = state.state.ids.map(async (id, index) => {
        const partData = await persistence.loadPartData(id, index);
        coreService.initializePart(id, partData, index);
    });
    await Promise.all(partCreationOps);

    // 10. Final visual state updates
    uiManagers.partUIManager.updateLabels(state.state.ids);
    panelManager.updateModeVisuals(state.state.mode);
    await dropdownManager.updateDropdowns(state.state.sNames);

    // 11. Add Event Listeners
    addListeners(coreService, actionService, panelManager);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
})();