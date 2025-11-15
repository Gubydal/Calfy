// UI orchestration module. Centralizes DOM event binding and state synchronization.
// Extension points:
// - swap Longcat for another model by adapting synthesizeSlides (state.longcat config is propagated).
// - replace Chart.js with custom visuals by editing charting.js while keeping renderPreview hooks intact.
// - plug in alternative exporters (e.g., WebCodecs) via exportVideo / exportStoryboard interface.
import { extractPdfText } from './pdfParser.js';
import { synthesizeSlides } from './analyzer.js';
import { renderSlideEditor, renderPreview, sanitizeSlideForExport } from './slideRenderer.js';
import { initializeVoices, speakSlides, stopSpeaking } from './tts.js';
import { exportVideo, exportStoryboard } from './exporter.js';
import { detectChartSpec } from './charting.js';

export function initializeUI(appState) {
    const { state } = appState;

    const refs = {
        dropzone: document.getElementById('dropzone'),
        fileInput: document.getElementById('file-input'),
        csvInput: document.getElementById('csv-input'),
        jsonInput: document.getElementById('json-input'),
        longcatKey: document.getElementById('longcat-key'),
        progressSteps: document.getElementById('progress-steps').querySelectorAll('li'),
        progressInfo: document.getElementById('progress-info'),
        renderLoader: document.getElementById('render-loader'),
        renderStart: document.getElementById('render-start'),
        slideList: document.getElementById('slide-list'),
        chartHelp: document.getElementById('chart-help'),
        chartHelpText: document.getElementById('chart-help-text'),
        previewCarousel: document.getElementById('preview-carousel'),
        stageHint: document.getElementById('stage-hint'),
        fileSummary: document.getElementById('file-summary'),
        fileName: document.getElementById('file-name'),
        fileMeta: document.getElementById('file-meta'),
        dropTitle: document.querySelector('.import-title'),
        dropHint: document.getElementById('drop-hint'),
        themeToggle: document.getElementById('theme-toggle'),
        orientationRadios: document.querySelectorAll('input[name="orientation"]'),
        layoutRadios: document.querySelectorAll('input[name="layout"]'),
        voiceSelect: document.getElementById('voice-select'),
        ttsToggle: document.getElementById('tts-toggle'),
        ttsStop: document.getElementById('tts-stop'),
        silentMode: document.getElementById('silent-mode'),
        exportVideo: document.getElementById('export-video'),
        exportAlt: document.getElementById('export-alt'),
        exportCanvas: document.getElementById('export-canvas'),
        helpToggle: document.getElementById('help-toggle'),
        helpContent: document.getElementById('help-content'),
        newSessionTrigger: document.getElementById('new-tab-trigger'),
        settingsTrigger: document.getElementById('settings-trigger'),
        settingsSheet: document.getElementById('settings-sheet'),
        closeSettings: document.getElementById('close-settings'),
        mobileNav: document.getElementById('mobile-step-nav'),
        previewButton: document.getElementById('preview-button'),
        previewModal: document.getElementById('preview-modal'),
        closePreview: document.getElementById('close-preview'),
        previewSave: document.getElementById('preview-save')
    };

    const preferenceInputs = {
        osmosis: document.querySelector('[data-preference-input="osmosis"]'),
        voiceOff: document.querySelector('[data-preference-input="voice-off"]'),
        orientationLandscape: document.querySelector('[data-preference-input="orientation-landscape"]'),
        orientationPortrait: document.querySelector('[data-preference-input="orientation-portrait"]')
    };

    const premiumControls = {
        videoStyles: document.querySelector('[data-premium="video-styles"]'),
        voice: document.querySelector('[data-premium="voice"]')
    };

    const defaultDropHint = refs.dropHint ? refs.dropHint.textContent : '';
    const loadedDropHint = 'Tap to replace or drop a new file';
    const stageHintCopy = {
        idle: 'Upload a PDF to begin.',
        'file-ready': 'Configure creative controls and start rendering.',
        rendering: 'Rendering your story...',
        ready: 'Review the preview or export your story.'
    };
    let currentStage = document.body.getAttribute('data-stage') || 'idle';

    function isSettingsOpen() {
        return document.body.classList.contains('settings-open');
    }

    function setSettingsOpen(shouldOpen) {
        const open = Boolean(shouldOpen);
        document.body.classList.toggle('settings-open', open);
        if (refs.settingsSheet) {
            refs.settingsSheet.setAttribute('aria-hidden', open ? 'false' : 'true');
        }
        if (refs.settingsTrigger) {
            refs.settingsTrigger.setAttribute('aria-expanded', open ? 'true' : 'false');
            refs.settingsTrigger.classList.toggle('is-active', open);
        }
    }

    function openSettingsSheet() {
        setSettingsOpen(true);
    }

    function closeSettingsSheet() {
        setSettingsOpen(false);
    }

    function setStage(nextStage) {
        if (!nextStage) {
            return;
        }
        if (currentStage === nextStage) {
            applyStage(nextStage);
            return;
        }
        currentStage = nextStage;
        document.body.setAttribute('data-stage', nextStage);
        if (nextStage === 'rendering') {
            closeSettingsSheet();
        }
        applyStage(nextStage);
    }

    function applyStage(stage) {
        if (refs.progressInfo) {
            const showProgress = stage === 'rendering' || stage === 'ready';
            refs.progressInfo.hidden = !showProgress;
        }
        if (refs.renderLoader) {
            refs.renderLoader.hidden = stage !== 'rendering';
        }
        if (refs.stageHint) {
            refs.stageHint.textContent = stageHintCopy[stage] || stageHintCopy.idle;
        }
        const disableTools = stage === 'rendering';
        if (refs.newSessionTrigger) {
            refs.newSessionTrigger.disabled = disableTools;
            if (disableTools) {
                refs.newSessionTrigger.setAttribute('aria-disabled', 'true');
            } else {
                refs.newSessionTrigger.removeAttribute('aria-disabled');
            }
        }
        if (refs.settingsTrigger) {
            refs.settingsTrigger.disabled = disableTools;
            if (disableTools) {
                refs.settingsTrigger.setAttribute('aria-disabled', 'true');
            } else {
                refs.settingsTrigger.removeAttribute('aria-disabled');
            }
        }
    }

    function updateImportSummary(meta) {
        if (!refs.fileSummary || !refs.fileName || !refs.fileMeta) {
            return;
        }
        if (!meta) {
            refs.fileSummary.hidden = true;
            refs.fileName.textContent = 'No file selected';
            refs.fileMeta.textContent = '';
            if (refs.dropTitle) {
                const emptyTitle = refs.dropTitle.dataset.emptyTitle || 'Import your PDF';
                refs.dropTitle.textContent = emptyTitle;
            }
            if (refs.dropHint) {
                refs.dropHint.textContent = defaultDropHint;
            }
            return;
        }

        const fileLabel = meta.fileName || meta.title || 'Imported PDF';
        const pageCount = Number(meta.totalPages) || 0;
        const sizeLabel = formatBytes(meta.rawSize);
        const summaryParts = [];

        if (pageCount > 0) {
            summaryParts.push(`${pageCount} page${pageCount === 1 ? '' : 's'}`);
        }
        if (sizeLabel) {
            summaryParts.push(sizeLabel);
        }

        refs.fileSummary.hidden = false;
        refs.fileName.textContent = fileLabel;
        refs.fileMeta.textContent = summaryParts.join(' - ');
        if (refs.dropTitle) {
            const loadedTitle = refs.dropTitle.dataset.loadedTitle || 'Change PDF';
            refs.dropTitle.textContent = loadedTitle;
        }
        if (refs.dropHint) {
            refs.dropHint.textContent = loadedDropHint || defaultDropHint;
        }
    }

    function formatBytes(bytes) {
        const size = Number(bytes);
        if (!Number.isFinite(size) || size <= 0) {
            return '';
        }
        const units = ['B', 'KB', 'MB', 'GB'];
        let index = 0;
        let value = size;
        while (value >= 1024 && index < units.length - 1) {
            value /= 1024;
            index += 1;
        }
        const formatted = value >= 100 ? Math.round(value) : Math.round(value * 10) / 10;
        return `${formatted} ${units[index]}`;
    }

    function resetSessionState() {
        stopSpeaking();
        if (refs.renderStart) {
            delete refs.renderStart.dataset.busy;
            refs.renderStart.disabled = true;
        }
        closeSettingsSheet();
        refs.dropzone?.classList.remove('dragover');
        refs.dropzone?.style.removeProperty('--parse-progress');
        updateImportSummary(null);
        appState.setSlides([]);
        appState.setPdfPages([]);
        appState.setPdf(null);
        appState.setProgress('pdf', 'pending');
        appState.setProgress('analysis', 'pending');
        appState.setProgress('assets', 'pending');
        appState.setProgress('assembly', 'pending');
        updateMobileNavState(appState.state);
        setStage('idle');
        resetDownloadButton();
    }

    function setDownloadState(state, { progress = null, message = '' } = {}) {
        const { button, status } = downloadUi;
        if (!button) return;
        const busy = state === 'rendering' || state === 'saving';
        button.dataset.state = state;
        button.classList.toggle('is-active', busy);
        button.classList.toggle('is-saving', state === 'saving');
        button.classList.toggle('is-complete', state === 'complete');
        button.classList.toggle('is-error', state === 'error');
        button.classList.toggle('is-cancelable', busy);
        if (busy || state === 'complete') {
            button.setAttribute('aria-busy', busy ? 'true' : 'false');
        } else {
            button.removeAttribute('aria-busy');
        }

        if (progress !== null && Number.isFinite(progress)) {
            const bounded = Math.min(100, Math.max(0, Math.round(progress)));
            button.style.setProperty('--download-circle-progress', `${bounded}%`);
        } else if (state === 'idle') {
            button.style.removeProperty('--download-circle-progress');
        }

        if (status) {
            status.textContent = message;
        }

        if (state === 'idle') {
            button.dataset.state = 'idle';
            button.classList.remove('is-active', 'is-complete', 'is-error');
            button.classList.remove('is-saving', 'is-cancelable');
            if (status) {
                status.textContent = '';
            }
        }

        if (refs.previewSave) {
            if (busy) {
                refs.previewSave.disabled = true;
            } else {
                refs.previewSave.disabled = !appState.state.slides.length;
            }
        }
    }

    function resetDownloadButton() {
        disposeDownloadSession();
        setDownloadState('idle');
    }

    function syncPreferenceUI(currentState) {
        if (!currentState) return;
        const orientation = currentState.orientation === 'portrait' ? 'portrait' : 'landscape';
        if (preferenceInputs.orientationLandscape) {
            preferenceInputs.orientationLandscape.checked = orientation === 'landscape';
        }
        if (preferenceInputs.orientationPortrait) {
            preferenceInputs.orientationPortrait.checked = orientation === 'portrait';
        }

        if (preferenceInputs.osmosis) {
            preferenceInputs.osmosis.checked = Boolean(currentState.osmosisEnabled);
        }

        const voiceWithout = currentState.voicePreference === 'without';
        if (preferenceInputs.voiceOff) {
            preferenceInputs.voiceOff.checked = voiceWithout;
        }
        if (premiumControls.voice) {
            const pressed = !voiceWithout && Boolean(currentState.premiumSelections?.voice);
            premiumControls.voice.setAttribute('aria-pressed', pressed ? 'true' : 'false');
        }
        if (premiumControls.videoStyles) {
            const pressed = Boolean(currentState.premiumSelections?.videoStyles);
            premiumControls.videoStyles.setAttribute('aria-pressed', pressed ? 'true' : 'false');
        }
    }

    const mobileNavButtons = Array.from((refs.mobileNav && refs.mobileNav.querySelectorAll('[data-panel-target]')) || []);
    const panelsRequiringSlides = new Set(['editor', 'preview']);

    setStage(currentStage);
    updateImportSummary(state.pdf);
    syncPreferenceUI(state);

    function setActivePanel(panelId) {
        if (!panelId) return;
        document.body.setAttribute('data-active-panel', panelId);
        mobileNavButtons.forEach(button => {
            const isActive = button.dataset.panelTarget === panelId;
            button.classList.toggle('active', isActive);
            button.setAttribute('aria-pressed', String(isActive));
        });
    }

    function updateMobileNavState(currentState) {
        if (!mobileNavButtons.length) return;
        const hasSlides = currentState.slides.length > 0;
        mobileNavButtons.forEach(button => {
            const target = button.dataset.panelTarget;
            const shouldLock = panelsRequiringSlides.has(target) && !hasSlides;
            button.classList.toggle('locked', shouldLock);
            button.setAttribute('aria-disabled', String(shouldLock));
        });
    }

    if (!document.body.hasAttribute('data-active-panel')) {
        setActivePanel('ingest');
    } else {
        setActivePanel(document.body.getAttribute('data-active-panel'));
    }

    setupAndroidFileBridge();
    const downloadBridge = setupAndroidDownloadBridge();

    const DOWNLOAD_FILE_NAME = 'storyweaver-video.webm';

    const downloadUi = {
        button: refs.exportVideo,
        status: refs.exportVideo?.querySelector('[data-download-status]') || null,
        session: null
    };

    resetDownloadButton();

    function cloneForExport(value) {
        if (value == null) {
            return value;
        }
        if (typeof structuredClone === 'function') {
            try {
                return structuredClone(value);
            } catch (err) {
                // Fallback below
            }
        }
        try {
            return JSON.parse(JSON.stringify(value));
        } catch (fallbackError) {
            if (Array.isArray(value)) {
                return value.slice();
            }
            if (typeof value === 'object') {
                return { ...value };
            }
            return value;
        }
    }

    function readSlideCardValues(card) {
        if (!card) {
            return null;
        }
        const headline = card.querySelector('[data-field="headline"]')?.value ?? '';
        const summary = card.querySelector('[data-field="summary"]')?.value ?? '';
        const bullets = Array.from(card.querySelectorAll('[data-field^="bullet-"]')).map(input => input.value ?? '');
        const heroPrompt = card.querySelector('[data-field="heroPrompt"]')?.value ?? '';
        const heroImage = card.querySelector('[data-field="heroImage"]')?.value ?? '';
        return { headline, summary, bullets, heroPrompt, heroImage };
    }

    function syncSlidesFromEditor() {
        if (!refs.slideList) {
            return;
        }
        const cards = Array.from(refs.slideList.querySelectorAll('.slide-card[data-slide-id]'));
        const pendingUpdates = cards.map((card, position) => {
            const declaredId = card.dataset.slideId;
            if (!declaredId) {
                return null;
            }
            let existing = state.slides.find(slide => slide.id === declaredId);
            if (!existing) {
                existing = state.slides[position];
            }
            if (!existing) {
                return null;
            }
            const slideId = existing.id;
            const formValues = readSlideCardValues(card);
            if (!formValues) {
                return null;
            }
            const updates = {};
            if (formValues.headline !== existing.headline) {
                updates.headline = formValues.headline;
            }
            if (formValues.summary !== existing.summary) {
                updates.summary = formValues.summary;
            }
            const normalizedBullets = Array.isArray(existing.bullets) ? existing.bullets.slice(0) : [];
            while (normalizedBullets.length < formValues.bullets.length) {
                normalizedBullets.push('');
            }
            let bulletsChanged = normalizedBullets.length !== formValues.bullets.length;
            formValues.bullets.forEach((value, index) => {
                const existingValue = normalizedBullets[index] ?? '';
                if (!bulletsChanged && value !== existingValue) {
                    bulletsChanged = true;
                }
            });
            if (bulletsChanged) {
                updates.bullets = formValues.bullets.slice();
            }
            if (formValues.heroPrompt !== existing.heroPrompt) {
                updates.heroPrompt = formValues.heroPrompt;
            }
            if (formValues.heroImage !== existing.heroImage) {
                updates.heroImage = formValues.heroImage;
            }
            const chartToggle = card.querySelector('[data-chart-toggle]');
            if (existing.template === 'text-image-chart' && chartToggle) {
                const enabled = chartToggle.checked;
                if (enabled !== Boolean(existing.chartEnabled)) {
                    updates.chartEnabled = enabled;
                }
            }
            return Object.keys(updates).length ? { slideId, updates } : null;
        }).filter(Boolean);

        pendingUpdates.forEach(item => {
            appState.updateSlide(item.slideId, item.updates);
        });
    }

    function buildSlidesForExport() {
        syncSlidesFromEditor();
        const sourceSlides = appState.state.slides || [];
        return sourceSlides.map(slide => {
            const sanitized = sanitizeSlideForExport(slide);
            const cloned = cloneForExport(sanitized);
            cloned.bullets = Array.isArray(cloned.bullets) ? cloned.bullets.map(text => String(text ?? '')) : [];
            cloned.sourcePages = Array.isArray(slide.sourcePages) ? [...slide.sourcePages] : [];
            cloned.chartSpec = sanitized.chartSpec ? cloneForExport(sanitized.chartSpec) : null;
            return cloned;
        });
    }

    function ensureDownloadSession() {
        if (downloadUi.session?.objectUrl) {
            URL.revokeObjectURL(downloadUi.session.objectUrl);
        }
        const controller = typeof AbortController === 'function'
            ? new AbortController()
            : {
                abort() {
                    this.signal.aborted = true;
                },
                signal: { aborted: false }
            };
        downloadUi.session = {
            controller,
            fileName: DOWNLOAD_FILE_NAME,
            blob: null,
            objectUrl: null,
            nativeResult: null,
            phase: 'idle'
        };
        return downloadUi.session;
    }

    function disposeDownloadSession({ keepBlob = false } = {}) {
        if (downloadUi.session?.objectUrl) {
            URL.revokeObjectURL(downloadUi.session.objectUrl);
        }
        if (!keepBlob && downloadUi.session) {
            downloadUi.session.blob = null;
        }
        downloadUi.session = null;
    }

    function isAbortError(error) {
        if (!error) return false;
        if (error.name === 'AbortError') return true;
        const message = typeof error.message === 'string' ? error.message : String(error);
        return /abort|cancel/i.test(message);
    }

    function createAbortException() {
        try {
            return new DOMException('Operation aborted', 'AbortError');
        } catch (domError) {
            const error = new Error('Operation aborted');
            error.name = 'AbortError';
            return error;
        }
    }

    initializeVoices(refs.voiceSelect);
    applyTheme(state.theme);
    hydrateLongcatKey(state.longcat.apiKey);
    if (refs.themeToggle) {
        refs.themeToggle.setAttribute('aria-pressed', state.theme === 'dark');
        refs.themeToggle.textContent = state.theme === 'dark' ? 'Toggle Light' : 'Toggle Dark';
    }
    if (refs.renderStart) {
        refs.renderStart.disabled = !hasPdfPayload(state);
    }
    updateActionStates(state);
    updateProgressUI(state.progress, refs.progressSteps);
    updateMobileNavState(state);

    mobileNavButtons.forEach(button => {
        button.addEventListener('click', () => {
            const targetPanel = button.dataset.panelTarget;
            const isLocked = button.classList.contains('locked');
            if (isLocked) {
                notify('Render slides to unlock this step.', true);
            }
            setActivePanel(targetPanel);
        });
    });

    appState.subscribe((updatedState, keys) => {
        if (keys.includes('theme')) {
            applyTheme(updatedState.theme);
            if (refs.themeToggle) {
                refs.themeToggle.setAttribute('aria-pressed', updatedState.theme === 'dark');
                refs.themeToggle.textContent = updatedState.theme === 'dark' ? 'Toggle Light' : 'Toggle Dark';
            }
        }
        if (keys.includes('slides') || keys.includes('activeSlideIndex') || keys.includes('layout') || keys.includes('orientation')) {
            renderSlideEditor(updatedState.slides, refs.slideList, { activeIndex: updatedState.activeSlideIndex });
            renderPreview(updatedState.slides, refs.previewCarousel, {
                activeIndex: updatedState.activeSlideIndex,
                orientation: updatedState.orientation,
                layout: updatedState.layout,
                theme: updatedState.theme
            });
            updateChartHelp(updatedState, refs);
            updateActionStates(updatedState);
            syncPreferenceUI(updatedState);
        }
        if (keys.includes('progress')) {
            updateProgressUI(updatedState.progress, refs.progressSteps);
        }
        if (keys.includes('longcat')) {
            hydrateLongcatKey(updatedState.longcat.apiKey);
        }
        if (keys.includes('voicePreference') || keys.includes('osmosisEnabled') || keys.includes('premiumSelections')) {
            syncPreferenceUI(updatedState);
        }
        if (keys.includes('pdf')) {
            updateImportSummary(updatedState.pdf);
            if (!updatedState.pdf && !updatedState.pdfPages?.length && !updatedState.slides.length) {
                setStage('idle');
            } else if (updatedState.pdf && !updatedState.slides.length && currentStage === 'idle') {
                setStage('file-ready');
            }
        }
        if (keys.includes('pdf') || keys.includes('pdfPages')) {
            if (refs.renderStart && !refs.renderStart.dataset.busy) {
                refs.renderStart.disabled = !hasPdfPayload(updatedState);
            }
        }
        if (keys.includes('slides')) {
            updateMobileNavState(updatedState);
            if (updatedState.slides.length) {
                setStage('ready');
            } else if (hasPdfPayload(updatedState)) {
                setStage('file-ready');
            } else if (currentStage !== 'rendering') {
                setStage('idle');
            }
            if (!updatedState.slides.length) {
                resetDownloadButton();
            }
        }
    });

    const launchFilePicker = event => {
        event.preventDefault();
        refs.fileInput.value = '';
        // Prefer the Android bridge when running inside the WebView so the native picker opens reliably.
        if (window.Android && typeof window.Android.selectFile === 'function') {
            try {
                window.Android.selectFile();
                return;
            } catch (bridgeError) {
                console.warn('Android bridge selectFile failed, falling back to DOM picker.', bridgeError);
            }
        }
        refs.fileInput.click();
    };

    refs.dropzone.addEventListener('click', launchFilePicker);
    refs.dropzone.addEventListener('touchend', launchFilePicker, { passive: false });
    refs.dropzone.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
            launchFilePicker(event);
        }
    });

    refs.dropzone.addEventListener('dragover', event => {
        event.preventDefault();
        refs.dropzone.classList.add('dragover');
    });

    refs.dropzone.addEventListener('dragleave', event => {
        event.preventDefault();
        refs.dropzone.classList.remove('dragover');
    });

    refs.dropzone.addEventListener('drop', event => {
        event.preventDefault();
        refs.dropzone.classList.remove('dragover');
        const [file] = event.dataTransfer.files;
        if (file) {
            handlePdfFile(file);
        }
    });

    refs.fileInput.addEventListener('change', event => {
        const [file] = event.target.files || [];
        if (file) {
            handlePdfFile(file);
        }
        event.target.value = '';
    });

    refs.csvInput.addEventListener('change', async event => {
        const [file] = event.target.files;
        if (!file) return;
        try {
            const text = await file.text();
            const rows = text.split(/\r?\n/).map(line => line.split(','));
            appState.setDataSource('csv', rows);
            refreshChartsFromData();
            notify('CSV data imported for chart enrichment.');
        } catch (error) {
            notify(`Unable to parse CSV: ${error.message}`, true);
        }
    });

    refs.jsonInput.addEventListener('change', async event => {
        const [file] = event.target.files;
        if (!file) return;
        try {
            const text = await file.text();
            const json = JSON.parse(text);
            appState.setDataSource('json', json);
            refreshChartsFromData();
            notify('JSON data imported for chart enrichment.');
        } catch (error) {
            notify(`Unable to parse JSON: ${error.message}`, true);
        }
    });

    refs.longcatKey.addEventListener('change', event => {
        appState.setLongcatKey(event.target.value.trim());
        notify('Longcat API key stored locally.');
    });

    if (refs.newSessionTrigger) {
        refs.newSessionTrigger.addEventListener('click', () => {
            if (refs.newSessionTrigger.disabled) {
                return;
            }
            const hadContent = Boolean(appState.state.pdf || appState.state.slides.length);
            resetSessionState();
            notify(hadContent ? 'Session reset.' : 'Ready for a new story.');
        });
    }

    function handleSettingsToggle(force) {
        if (!refs.settingsTrigger || !refs.settingsSheet) {
            return;
        }
        const shouldOpen = typeof force === 'boolean' ? force : !isSettingsOpen();
        if (shouldOpen) {
            openSettingsSheet();
        } else {
            closeSettingsSheet();
        }
    }

    if (refs.settingsTrigger && refs.settingsSheet) {
        refs.settingsTrigger.addEventListener('click', () => {
            if (refs.settingsTrigger.disabled) {
                return;
            }
            handleSettingsToggle();
        });
    }

    if (refs.closeSettings) {
        refs.closeSettings.addEventListener('click', () => {
            handleSettingsToggle(false);
            if (refs.settingsTrigger) {
                try {
                    refs.settingsTrigger.focus({ preventScroll: true });
                } catch (err) {
                    refs.settingsTrigger.focus();
                }
            }
        });
    }

    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && isSettingsOpen()) {
            handleSettingsToggle(false);
            if (refs.settingsTrigger) {
                try {
                    refs.settingsTrigger.focus({ preventScroll: true });
                } catch (err) {
                    refs.settingsTrigger.focus();
                }
            }
        }
    });

    document.addEventListener('pointerdown', event => {
        if (!isSettingsOpen()) {
            return;
        }
        const target = event.target;
        if ((refs.settingsSheet && refs.settingsSheet.contains(target)) || (refs.settingsTrigger && refs.settingsTrigger.contains(target))) {
            return;
        }
        handleSettingsToggle(false);
    });

    refs.renderStart.addEventListener('click', async () => {
        const currentState = appState.state;
        if (!hasPdfPayload(currentState)) {
            notify('Upload a PDF before rendering.', true);
            return;
        }
        setStage('rendering');
        refs.renderStart.disabled = true;
        refs.renderStart.dataset.busy = 'true';
        appState.setProgress('analysis', 'active');
        appState.setProgress('assets', 'pending');
        appState.setProgress('assembly', 'pending');

        try {
            const slides = await synthesizeSlides({
                pdfMeta: currentState.pdf,
                pages: currentState.pdfPages,
                orientation: currentState.orientation,
                layout: currentState.layout,
                longcatConfig: currentState.longcat,
                dataSources: currentState.dataSources
            });
            const normalizedSlides = slides.map(slide => ({
                ...slide,
                duration: 14000
            }));
            appState.setSlides(normalizedSlides);
            updateMobileNavState(appState.state);
            setActivePanel('editor');
            appState.setProgress('analysis', 'complete');
            appState.setProgress('assets', 'active');
            appState.setProgress('assets', 'complete');
            appState.setProgress('assembly', 'pending');
            notify('Slides ready. Adjust copy or export when ready.');
        } catch (error) {
            console.error(error);
            appState.setProgress('analysis', 'pending');
            appState.setProgress('assets', 'pending');
            setStage(hasPdfPayload(appState.state) ? 'file-ready' : 'idle');
            notify(`Unable to synthesize slides: ${error.message}`, true);
        } finally {
            delete refs.renderStart.dataset.busy;
            refs.renderStart.disabled = !hasPdfPayload(appState.state);
        }
    });

    if (refs.themeToggle) {
        refs.themeToggle.addEventListener('click', () => {
            const nextTheme = state.theme === 'dark' ? 'light' : 'dark';
            appState.setTheme(nextTheme);
        });
    }

    refs.orientationRadios.forEach(radio => {
        radio.checked = radio.value === state.orientation;
        radio.addEventListener('change', () => {
            if (radio.checked) {
                appState.setOrientation(radio.value);
            }
        });
    });

    refs.layoutRadios.forEach(radio => {
        radio.checked = radio.value === state.layout;
        radio.addEventListener('change', () => {
            if (radio.checked) {
                appState.setLayout(radio.value);
            }
        });
    });

    if (preferenceInputs.osmosis) {
        preferenceInputs.osmosis.addEventListener('change', event => {
            appState.setOsmosisEnabled(event.target.checked);
        });
    }

    if (preferenceInputs.voiceOff) {
        preferenceInputs.voiceOff.addEventListener('change', event => {
            const checked = event.target.checked;
            appState.setVoicePreference(checked ? 'without' : 'with');
            appState.setPremiumSelection('voice', !checked);
        });
    }

    if (preferenceInputs.orientationLandscape) {
        preferenceInputs.orientationLandscape.addEventListener('change', event => {
            if (event.target.checked) {
                appState.setOrientation('landscape');
            } else if (!preferenceInputs.orientationPortrait || !preferenceInputs.orientationPortrait.checked) {
                preferenceInputs.orientationLandscape.checked = true;
            }
        });
    }

    if (preferenceInputs.orientationPortrait) {
        preferenceInputs.orientationPortrait.addEventListener('change', event => {
            if (event.target.checked) {
                appState.setOrientation('portrait');
            } else if (!preferenceInputs.orientationLandscape || !preferenceInputs.orientationLandscape.checked) {
                preferenceInputs.orientationPortrait.checked = true;
            }
        });
    }

    if (premiumControls.videoStyles) {
        premiumControls.videoStyles.addEventListener('click', () => {
            const next = premiumControls.videoStyles.getAttribute('aria-pressed') !== 'true';
            appState.setPremiumSelection('videoStyles', next);
        });
    }

    if (premiumControls.voice) {
        premiumControls.voice.addEventListener('click', () => {
            const currentPressed = premiumControls.voice.getAttribute('aria-pressed') === 'true';
            const nextPressed = !currentPressed;
            appState.setPremiumSelection('voice', nextPressed);
            appState.setVoicePreference(nextPressed ? 'with' : 'without');
        });
    }

    refs.slideList.addEventListener('input', event => {
        const card = event.target.closest('.slide-card');
        if (!card) return;
        let slideId = card.dataset.slideId;
        let resolvedSlide = state.slides.find(slide => slide.id === slideId);
        if (!resolvedSlide) {
            const cards = Array.from(refs.slideList.querySelectorAll('.slide-card'));
            const position = cards.indexOf(card);
            if (position >= 0 && state.slides[position]) {
                slideId = state.slides[position].id;
                resolvedSlide = state.slides[position];
            }
        }
        const field = event.target.dataset.field;
        if (!field) return;

        const updates = {};
        if (field === 'headline') {
            updates.headline = event.target.value;
        } else if (field === 'summary') {
            updates.summary = event.target.value;
        } else if (field.startsWith('bullet-')) {
            const index = Number(field.split('-')[1]);
            const slide = resolvedSlide ?? state.slides.find(item => item.id === slideId);
            const bullets = Array.isArray(slide?.bullets) ? [...slide.bullets] : [];
            bullets[index] = event.target.value;
            updates.bullets = bullets;
        } else if (field === 'heroPrompt') {
            updates.heroPrompt = event.target.value;
        } else if (field === 'heroImage') {
            updates.heroImage = event.target.value;
        }

        appState.updateSlide(slideId, updates);
        if (refs.previewCarousel) {
            renderPreview(state.slides, refs.previewCarousel, {
                activeIndex: state.activeSlideIndex,
                orientation: state.orientation,
                layout: state.layout,
                theme: state.theme
            });
        }
        updateChartHelp(state, refs);
    });

    refs.slideList.addEventListener('click', event => {
        const card = event.target.closest('.slide-card');
        if (!card) return;
        const slideId = card.dataset.slideId;
        const index = state.slides.findIndex(slide => slide.id === slideId);

        if (event.target.dataset.move === 'up') {
            appState.reorderSlides(index, Math.max(index - 1, 0));
        }

        if (event.target.dataset.move === 'down') {
            appState.reorderSlides(index, Math.min(index + 1, state.slides.length - 1));
        }
    });

    refs.slideList.addEventListener('change', event => {
        const card = event.target.closest('.slide-card');
        if (!card) return;
        const slideId = card.dataset.slideId;

        if (event.target.dataset.field === 'template') {
            const templateValue = event.target.value;
            const target = state.slides.find(item => item.id === slideId);
            const updates = { template: templateValue };
            if (templateValue !== 'text-image-chart') {
                updates.chartEnabled = false;
            }
            if (templateValue === 'quad-grid') {
                updates.bullets = (target?.bullets || []).slice(0, 4);
            }
            appState.updateSlide(slideId, updates);
            if (refs.previewCarousel) {
                renderPreview(state.slides, refs.previewCarousel, {
                    activeIndex: state.activeSlideIndex,
                    orientation: state.orientation,
                    layout: state.layout,
                    theme: state.theme
                });
            }
            updateChartHelp(state, refs);
            return;
        }

        if (event.target.matches('[data-chart-toggle]')) {
            appState.toggleSlideChart(slideId, event.target.checked);
            if (refs.previewCarousel) {
                renderPreview(state.slides, refs.previewCarousel, {
                    activeIndex: state.activeSlideIndex,
                    orientation: state.orientation,
                    layout: state.layout,
                    theme: state.theme
                });
            }
            updateChartHelp(state, refs);
        }
    });

    refs.previewCarousel.addEventListener('click', event => {
        const target = event.target.closest('.preview-slide');
        if (!target) return;
        const slideId = target.dataset.slideId;
        const index = state.slides.findIndex(slide => slide.id === slideId);
        appState.setActiveSlide(index);
        setActivePanel('preview');
    });

    refs.previewCarousel.addEventListener('keydown', event => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        const target = event.target.closest('.preview-slide');
        if (!target) return;
        event.preventDefault();
        const slideId = target.dataset.slideId;
        const index = state.slides.findIndex(slide => slide.id === slideId);
        appState.setActiveSlide(index);
        setActivePanel('preview');
    });

    refs.ttsToggle.addEventListener('click', () => {
        if (!state.slides.length) {
            notify('Generate slides before previewing voiceover.', true);
            return;
        }
        if (refs.silentMode.checked) {
            notify('Silent mode enabled. Disable it to hear the voiceover preview.', true);
            return;
        }
        if (!('speechSynthesis' in window)) {
            notify('Speech synthesis is not available in this browser.', true);
            return;
        }
        const voiceIndex = Number(refs.voiceSelect.value) || 0;
        speakSlides(state.slides, {
            voiceIndex,
            onStart: idx => appState.setActiveSlide(idx),
            onComplete: () => notify('Voiceover preview completed.')
        });
    });

    refs.ttsStop.addEventListener('click', () => stopSpeaking());

    async function startVideoExport() {
        if (!state.slides.length) {
            notify('Render slides before exporting video.', true);
            return;
        }

        const exportSlides = buildSlidesForExport();
        const session = ensureDownloadSession();
        session.phase = 'rendering';
        const { controller } = session;

        const updateRenderProgress = percent => {
            const bounded = Math.min(100, Math.max(0, Math.round(percent || 0)));
            setDownloadState('rendering', {
                progress: bounded,
                message: `Rendering video… ${bounded}%`
            });
        };

        if (!refs.silentMode.checked) {
            notify('Voiceovers are preview-only right now. Exported video will be silent.', true);
        }

        setDownloadState('rendering', { progress: 0, message: 'Rendering video… 0%' });
        appState.setProgress('assembly', 'active');

        try {
            const blob = await exportVideo({
                slides: exportSlides,
                canvas: refs.exportCanvas,
                orientation: state.orientation,
                theme: state.theme,
                includeAudio: false,
                onProgress: updateRenderProgress,
                signal: controller.signal
            });

            if (controller.signal.aborted) {
                throw createAbortException();
            }

            session.blob = blob;
            session.phase = 'rendered';
            updateRenderProgress(100);

            if (downloadBridge?.isAvailable) {
                session.phase = 'saving';
                setDownloadState('saving', { progress: 0, message: 'Saving to device…' });
                const result = await downloadBridge.saveBlob(blob, {
                    fileName: session.fileName,
                    mimeType: blob.type,
                    signal: controller.signal,
                    onProgress: (written, total) => {
                        if (!Number.isFinite(total) || total <= 0) {
                            return;
                        }
                        const percent = Math.min(100, Math.max(0, Math.round((written / total) * 100)));
                        setDownloadState('saving', {
                            progress: percent,
                            message: `Saving to device… ${percent}%`
                        });
                    }
                });

                if (controller.signal.aborted) {
                    throw createAbortException();
                }

                session.nativeResult = {
                    ...result,
                    mimeType: result?.mimeType || blob.type || 'video/webm'
                };
                session.phase = 'complete';
                appState.setProgress('assembly', 'complete');
                setDownloadState('complete', { progress: 100, message: 'Video saved to device.' });
            } else {
                session.phase = 'saving';
                setDownloadState('saving', { progress: 100, message: 'Preparing download…' });
                const tempUrl = URL.createObjectURL(blob);
                triggerDownload(tempUrl, session.fileName);
                setTimeout(() => URL.revokeObjectURL(tempUrl), 750);
                session.phase = 'complete';
                appState.setProgress('assembly', 'complete');
                setDownloadState('complete', { progress: 100, message: 'Video ready. Check downloads.' });
            }
        } catch (error) {
            if (isAbortError(error)) {
                appState.setProgress('assembly', 'pending');
                notify('Video export cancelled.');
                resetDownloadButton();
                return;
            }

            appState.setProgress('assembly', 'pending');
            const message = error?.message || String(error);
            setDownloadState('error', { progress: 0, message: `Video export failed: ${message}` });
            notify(`Video export failed: ${message}`, true);
        }
    }

    function cancelActiveDownload() {
        const session = downloadUi.session;
        if (!session || !session.controller || session.controller.signal.aborted) {
            return;
        }
        session.controller.abort();
    }

    async function openCompletedDownload() {
        const session = downloadUi.session;
        if (!session || session.phase !== 'complete') {
            return;
        }

        if (downloadBridge?.isAvailable && session.nativeResult?.uri) {
            try {
                await downloadBridge.openSavedDownload(session.nativeResult.uri, session.nativeResult.mimeType || session.blob?.type || 'video/webm');
            } catch (error) {
                notify('Unable to open file automatically. Check your downloads.', true);
            }
            return;
        }

        if (session.blob instanceof Blob) {
            const url = URL.createObjectURL(session.blob);
            triggerDownload(url, session.fileName || DOWNLOAD_FILE_NAME);
            setTimeout(() => URL.revokeObjectURL(url), 750);
        } else {
            notify('Video ready. Check your downloads folder.', false);
        }
    }

    let previewKeyListener = null;

    function openPreviewModal() {
        if (!refs.previewModal) {
            return;
        }
        if (!state.slides.length) {
            notify('Render slides before previewing.', true);
            return;
        }
        if (previewKeyListener) {
            document.removeEventListener('keydown', previewKeyListener);
        }
        refs.previewModal.setAttribute('aria-hidden', 'false');
        document.body.classList.add('preview-open');
        previewKeyListener = event => {
            if (event.key === 'Escape') {
                closePreviewModal();
            }
        };
        document.addEventListener('keydown', previewKeyListener);
    }

    function closePreviewModal() {
        if (!refs.previewModal) {
            return;
        }
        refs.previewModal.setAttribute('aria-hidden', 'true');
        document.body.classList.remove('preview-open');
        if (previewKeyListener) {
            document.removeEventListener('keydown', previewKeyListener);
            previewKeyListener = null;
        }
        if (refs.previewButton && typeof refs.previewButton.focus === 'function') {
            try {
                refs.previewButton.focus({ preventScroll: true });
            } catch (focusError) {
                refs.previewButton.focus();
            }
        }
    }

    if (refs.exportVideo) {
        refs.exportVideo.addEventListener('click', () => {
            const buttonState = downloadUi.button?.dataset.state || 'idle';
            if (buttonState === 'rendering' || buttonState === 'saving') {
                cancelActiveDownload();
                return;
            }
            if (buttonState === 'complete') {
                void openCompletedDownload();
                return;
            }
            if (buttonState === 'error') {
                resetDownloadButton();
            }
            void startVideoExport();
        });
    }

    refs.previewButton?.addEventListener('click', () => {
        openPreviewModal();
    });

    refs.closePreview?.addEventListener('click', () => {
        closePreviewModal();
    });

    refs.previewModal?.addEventListener('click', event => {
        if (event.target === refs.previewModal) {
            closePreviewModal();
        }
    });

    if (refs.previewSave) {
        refs.previewSave.addEventListener('click', () => {
            if (!state.slides.length) {
                notify('Render slides before exporting video.', true);
                return;
            }
            const buttonState = downloadUi.button?.dataset.state || 'idle';
            if (buttonState === 'rendering' || buttonState === 'saving') {
                notify('Video export already in progress. Cancel it before starting a new render.', true);
                return;
            }
            if (buttonState === 'complete' || buttonState === 'error') {
                resetDownloadButton();
            }
            closePreviewModal();
            if (downloadUi.button && typeof downloadUi.button.focus === 'function') {
                try {
                    downloadUi.button.focus({ preventScroll: true });
                } catch (err) {
                    downloadUi.button.focus();
                }
            }
            notify('Exporting video with your latest edits…');
            void startVideoExport();
        });
    }

    if (refs.exportAlt) {
        refs.exportAlt.addEventListener('click', async () => {
            if (!state.slides.length) {
                notify('Render slides before downloading assets.', true);
                return;
            }
            refs.exportAlt.disabled = true;
            try {
                const blob = await exportStoryboard(state.slides, refs.exportCanvas, {
                    orientation: state.orientation,
                    theme: state.theme
                });
                const fileName = 'storyweaver_storyboard.json';
                if (downloadBridge?.isAvailable) {
                    notify('Select where to save your storyboard.');
                    await downloadBridge.saveBlob(blob, {
                        fileName,
                        mimeType: blob.type
                    });
                    notify('Storyboard saved to device.');
                } else {
                    const url = URL.createObjectURL(blob);
                    triggerDownload(url, fileName);
                    URL.revokeObjectURL(url);
                    notify('Storyboard downloaded.');
                }
            } catch (error) {
                const message = error?.message || String(error);
                const cancelled = /cancel/i.test(message || '');
                notify(cancelled ? 'Storyboard download cancelled.' : `Storyboard export failed: ${message}`, !cancelled);
            } finally {
                refs.exportAlt.disabled = !state.slides.length;
            }
        });
    }

    if (refs.helpToggle && refs.helpContent) {
        refs.helpToggle.addEventListener('click', () => {
            const expanded = refs.helpToggle.getAttribute('aria-expanded') === 'true';
            refs.helpToggle.setAttribute('aria-expanded', String(!expanded));
            refs.helpContent.hidden = expanded;
        });
    }

    async function handlePdfFile(file) {
        if (!file.name.toLowerCase().endsWith('.pdf')) {
            notify('Please select a PDF file.', true);
            return;
        }

        setActivePanel('ingest');
        refs.renderStart.disabled = true;
        appState.setProgress('analysis', 'pending');
        appState.setProgress('assets', 'pending');
        appState.setProgress('assembly', 'pending');
        appState.setProgress('pdf', 'active');
        try {
            const pdfMeta = await extractPdfText(file, {
                onProgress: percent => refs.dropzone.style.setProperty('--parse-progress', percent)
            });
            const { pages, ...metaWithoutPages } = pdfMeta;
            const enrichedMeta = { ...metaWithoutPages, fileName: file.name };
            appState.setPdf(enrichedMeta);
            appState.setPdfPages(Array.isArray(pages) ? pages : []);
            appState.setSlides([]);
            updateMobileNavState(appState.state);
            appState.setProgress('pdf', 'complete');
            appState.setProgress('analysis', 'pending');
            appState.setProgress('assets', 'pending');
            appState.setProgress('assembly', 'pending');
            refs.dropzone.style.removeProperty('--parse-progress');
            setStage('file-ready');
            notify('PDF loaded. Click Render Story to generate slides.');
            refs.renderStart.disabled = !hasPdfPayload(appState.state);
        } catch (error) {
            console.error(error);
            appState.setProgress('pdf', 'pending');
            appState.setProgress('analysis', 'pending');
            notify(`Unable to process PDF: ${error.message}`, true);
            refs.dropzone.style.removeProperty('--parse-progress');
            setStage(hasPdfPayload(appState.state) ? 'file-ready' : 'idle');
            refs.renderStart.disabled = !hasPdfPayload(appState.state);
        }
    }

    // Expose for native bridge so it can inject files selected through Android's picker.
    window.StoryWeaver = window.StoryWeaver || {};
    window.StoryWeaver.handlePdfFile = handlePdfFile;
    window.handlePdfFile = handlePdfFile;

    function setupAndroidFileBridge() {
        if (!window.Android) {
            return;
        }

        window.StoryWeaver = window.StoryWeaver || {};
        window.StoryWeaver.onAndroidFileSelected = payload => {
            const normalized = normalizeBridgePayload(payload);
            if (!normalized) {
                return;
            }
            handleAndroidBridgeSelection(normalized).catch(error => {
                console.error('Android bridge file handling failed', error);
                notify(`Unable to load file: ${error.message}`, true);
            });
        };

        if (Array.isArray(window.AndroidPendingFiles) && window.AndroidPendingFiles.length) {
            const pending = window.AndroidPendingFiles.splice(0);
            pending.forEach(item => {
                const normalized = normalizeBridgePayload(item);
                if (normalized) {
                    handleAndroidBridgeSelection(normalized).catch(error => {
                        console.error('Pending Android file failed', error);
                        notify(`Unable to load file: ${error.message}`, true);
                    });
                }
            });
        }
    }

    function normalizeBridgePayload(payload) {
        if (!payload) return null;
        if (typeof payload === 'string') {
            try {
                return JSON.parse(payload);
            } catch (error) {
                console.error('Unable to parse Android payload', error);
                return null;
            }
        }
        return payload;
    }

    async function handleAndroidBridgeSelection(meta) {
        const android = window.Android;
        if (!android || typeof android.readFileChunk !== 'function') {
            console.warn('Android bridge missing readFileChunk');
            return;
        }

        const token = meta.token;
        if (!token) {
            console.warn('Android payload missing token');
            return;
        }

        const expectedSize = Number(meta.size) || 0;
    const chunkRequestSize = 96 * 1024;
        const byteChunks = [];
        let offset = 0;
        let continueReading = true;

        console.log('StoryWeaver: streaming file from Android bridge', meta.name, meta.mimeType, expectedSize);
    notify('Importing PDF from device...');
        refs.dropzone.style.setProperty('--parse-progress', expectedSize > 0 ? 5 : 35);

        try {
            while (continueReading) {
                const base64 = android.readFileChunk(token, offset, chunkRequestSize);
                if (!base64) {
                    break;
                }
                const binary = atob(base64);
                const length = binary.length;
                if (!length) {
                    break;
                }
                const bytes = new Uint8Array(length);
                for (let index = 0; index < length; index += 1) {
                    bytes[index] = binary.charCodeAt(index);
                }
                byteChunks.push(bytes);
                offset += length;

                if (expectedSize > 0) {
                    const percent = Math.min(95, Math.round((offset / expectedSize) * 100));
                    refs.dropzone.style.setProperty('--parse-progress', percent);
                    if (offset >= expectedSize) {
                        continueReading = false;
                    }
                } else {
                    const progressive = Math.min(90, 35 + byteChunks.length * 8);
                    refs.dropzone.style.setProperty('--parse-progress', progressive);
                }

                if (length < chunkRequestSize) {
                    break;
                }

                await new Promise(resolve => requestAnimationFrame(resolve));
            }

            const totalBytes = byteChunks.reduce((sum, chunk) => sum + chunk.length, 0);
            if (!totalBytes) {
                throw new Error('No data received from Android bridge.');
            }

            const merged = new Uint8Array(totalBytes);
            let position = 0;
            byteChunks.forEach(chunk => {
                merged.set(chunk, position);
                position += chunk.length;
            });

            const blob = new Blob([merged], { type: meta.mimeType || 'application/pdf' });
            const filename = typeof meta.name === 'string' && meta.name.length ? meta.name : 'document.pdf';
            const file = new File([blob], filename, { type: blob.type });
            await handlePdfFile(file);
        } finally {
            refs.dropzone.style.removeProperty('--parse-progress');
            if (window.Android && typeof window.Android.releaseFile === 'function') {
                window.Android.releaseFile(token);
            }
        }
    }

    function hydrateLongcatKey(key) {
        refs.longcatKey.value = key || '';
    }

    function applyTheme(theme) {
        document.body.classList.toggle('theme-dark', theme === 'dark');
        document.body.classList.toggle('theme-light', theme === 'light');
    }

    function updateChartHelp(currentState, elements) {
        const slide = currentState.slides[currentState.activeSlideIndex];
        if (slide?.chartEnabled && slide.chartSpec) {
            elements.chartHelp.hidden = false;
            elements.chartHelpText.textContent = slide.chartRationale || slide.chartSpec.rationale || 'Chart suggested based on numeric patterns.';
        } else {
            elements.chartHelp.hidden = true;
        }
    }

    function refreshChartsFromData() {
        if (!state.slides.length) return;
        state.slides.forEach(slide => {
            if (slide.template !== 'text-image-chart') return;
            const combined = [slide.summary, ...(slide.bullets || [])].join(' ');
            const spec = detectChartSpec(combined, state.dataSources);
            appState.updateSlide(slide.id, {
                chartSpec: spec,
                chartEnabled: Boolean(spec),
                chartRationale: spec?.rationale || slide.chartRationale
            });
        });
    }
}

function updateProgressUI(progress, nodes) {
    nodes.forEach(node => {
        const step = node.dataset.step;
        const status = progress[step];
        node.classList.remove('pending', 'active', 'complete');
        node.classList.add(status || 'pending');
    });
}

function updateActionStates(currentState) {
    const hasSlides = currentState.slides.length > 0;
    const exportVideoButton = document.getElementById('export-video');
    const exportAltButton = document.getElementById('export-alt');
    const previewSaveButton = document.getElementById('preview-save');
    if (exportVideoButton) {
        exportVideoButton.disabled = !hasSlides;
    }
    if (exportAltButton) {
        exportAltButton.disabled = !hasSlides;
    }
    if (previewSaveButton) {
        previewSaveButton.disabled = !hasSlides;
    }
}

function hasPdfPayload(currentState) {
    return Boolean(currentState.pdf && Array.isArray(currentState.pdfPages) && currentState.pdfPages.length > 0);
}

function notify(message, isError = false) {
    const toast = document.createElement('div');
    toast.textContent = message;
    toast.className = `toast ${isError ? 'toast-error' : ''}`;
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    document.body.appendChild(toast);
    setTimeout(() => {
        toast.classList.add('visible');
        setTimeout(() => {
            toast.classList.remove('visible');
            setTimeout(() => toast.remove(), 300);
        }, 3200);
    }, 0);
}

function setupAndroidDownloadBridge() {
    const android = window.Android;
    const requiredMethods = ['requestDownloadDestination', 'writeDownloadChunk', 'completeDownload', 'abortDownload'];
    const hasNativeBridge = android && requiredMethods.every(method => typeof android[method] === 'function');

    if (!hasNativeBridge) {
        return null;
    }

    window.StoryWeaver = window.StoryWeaver || {};

    if (window.StoryWeaver.__androidDownloadBridge) {
        return window.StoryWeaver.__androidDownloadBridge;
    }

    const sessions = new Map();
    const defaultChunkSize = typeof android.getMaxDownloadChunkSize === 'function'
        ? android.getMaxDownloadChunkSize()
        : 96 * 1024;

    function createSession(requestId) {
        const session = {
            requestId,
            handshake: createDeferred(),
            completion: createDeferred(),
            token: null,
            maxChunkSize: defaultChunkSize,
            bytesWritten: 0,
            mimeType: null
        };
        sessions.set(requestId, session);
        return session;
    }

    function getSession(requestId) {
        return sessions.get(requestId);
    }

    function removeSession(requestId) {
        sessions.delete(requestId);
    }

    function normalizeDownloadPayload(payload) {
        if (!payload) return null;
        if (typeof payload === 'string') {
            try {
                return JSON.parse(payload);
            } catch (error) {
                console.error('Unable to parse Android download payload', error);
                return null;
            }
        }
        return payload;
    }

    const handlers = {
        ready: raw => {
            const message = normalizeDownloadPayload(raw);
            if (!message?.requestId) return;
            const session = getSession(message.requestId);
            if (!session) {
                console.warn('Download ready for unknown request', message.requestId);
                return;
            }
            session.token = message.token;
            if (Number.isFinite(Number(message.maxChunkSize))) {
                session.maxChunkSize = Number(message.maxChunkSize);
            }
            if (typeof message.mimeType === 'string' && message.mimeType) {
                session.mimeType = message.mimeType;
            }
            session.handshake.resolve({
                token: session.token,
                maxChunkSize: session.maxChunkSize,
                fileName: message.fileName,
                mimeType: message.mimeType
            });
        },
        cancelled: raw => {
            const message = normalizeDownloadPayload(raw);
            if (!message?.requestId) return;
            const session = getSession(message.requestId);
            if (!session) return;
            const error = new Error('Download cancelled by user');
            if (!session.handshake.settled) {
                session.handshake.reject(error);
            }
            if (!session.completion.settled) {
                session.completion.reject(error);
            }
            removeSession(message.requestId);
        },
        error: raw => {
            const message = normalizeDownloadPayload(raw);
            if (!message?.requestId) return;
            const session = getSession(message.requestId);
            if (!session) return;
            const error = new Error(message.message || 'Native download error');
            if (!session.handshake.settled) {
                session.handshake.reject(error);
            }
            if (!session.completion.settled) {
                session.completion.reject(error);
            }
            removeSession(message.requestId);
        },
        complete: raw => {
            const message = normalizeDownloadPayload(raw);
            if (!message?.requestId) return;
            const session = getSession(message.requestId);
            if (!session) return;
            const result = {
                requestId: message.requestId,
                uri: message.uri,
                bytesWritten: Number(message.bytesWritten) || session.bytesWritten,
                mimeType: session.mimeType
            };
            session.completion.resolve(result);
            removeSession(message.requestId);
        }
    };

    window.StoryWeaver.onAndroidDownloadReady = handlers.ready;
    window.StoryWeaver.onAndroidDownloadCancelled = handlers.cancelled;
    window.StoryWeaver.onAndroidDownloadError = handlers.error;
    window.StoryWeaver.onAndroidDownloadComplete = handlers.complete;

    if (Array.isArray(window.AndroidPendingDownloads) && window.AndroidPendingDownloads.length) {
        const pending = window.AndroidPendingDownloads.splice(0);
        pending.forEach(item => {
            const message = normalizeDownloadPayload(item);
            if (!message?.type) return;
            const handler = handlers[message.type];
            if (handler) {
                handler(message);
            }
        });
    }

    const bridge = {
        isAvailable: true,
        async saveBlob(blob, options = {}) {
            if (!(blob instanceof Blob)) {
                throw new Error('A valid Blob is required for native download.');
            }

            const {
                fileName = 'storyweaver_export.bin',
                mimeType = blob.type || 'application/octet-stream',
                onProgress,
                signal
            } = options;

            const requestId = generateRequestId();
            const session = createSession(requestId);
            session.mimeType = mimeType;

            try {
                android.requestDownloadDestination(requestId, fileName, mimeType);
            } catch (error) {
                removeSession(requestId);
                throw error;
            }

            let handshake;
            let token;
            let aborted = false;
            const abortError = createDownloadAbortError();

            const abortHandler = () => {
                aborted = true;
                if (token) {
                    try {
                        android.abortDownload(token);
                    } catch (abortException) {
                        console.warn('Unable to abort native download', abortException);
                    }
                }
            };

            if (signal) {
                if (signal.aborted) {
                    removeSession(requestId);
                    throw abortError;
                }
                if (typeof signal.addEventListener === 'function') {
                    signal.addEventListener('abort', abortHandler, { once: true });
                }
            }
            try {
                handshake = await session.handshake.promise;
            } catch (error) {
                if (signal && typeof signal.removeEventListener === 'function') {
                    signal.removeEventListener('abort', abortHandler);
                }
                removeSession(requestId);
                if (signal?.aborted || aborted) {
                    throw abortError;
                }
                throw error;
            }

            token = handshake.token;
            if (!token) {
                removeSession(requestId);
                throw new Error('Native download did not provide a token.');
            }

            const targetChunkSize = Math.max(8192, Math.min(handshake.maxChunkSize || session.maxChunkSize, 512 * 1024));
            const totalBytes = Number(blob.size) || 0;
            let offset = 0;

            try {
                if (signal?.aborted || aborted) {
                    throw abortError;
                }
                while (offset < totalBytes) {
                    if (signal?.aborted || aborted) {
                        throw abortError;
                    }
                    const slice = blob.slice(offset, offset + targetChunkSize);
                    const buffer = await slice.arrayBuffer();
                    const chunk = encodeBase64(new Uint8Array(buffer));
                    const accepted = android.writeDownloadChunk(token, chunk);
                    if (!accepted) {
                        throw new Error('Native downloader rejected a data chunk.');
                    }
                    offset += buffer.byteLength;
                    session.bytesWritten += buffer.byteLength;
                    if (typeof onProgress === 'function') {
                        onProgress(session.bytesWritten, totalBytes);
                    }
                    await new Promise(resolve => setTimeout(resolve, 0));
                }

                if (totalBytes === 0) {
                    if (signal?.aborted || aborted) {
                        throw abortError;
                    }
                    const buffer = await blob.arrayBuffer();
                    if (buffer.byteLength > 0) {
                        const accepted = android.writeDownloadChunk(token, encodeBase64(new Uint8Array(buffer)));
                        if (!accepted) {
                            throw new Error('Native downloader rejected data.');
                        }
                        session.bytesWritten = buffer.byteLength;
                    }
                }

                if (signal?.aborted || aborted) {
                    throw abortError;
                }

                android.completeDownload(token);
                const result = await session.completion.promise;
                return {
                    ...result,
                    mimeType: session.mimeType || mimeType
                };
            } catch (error) {
                if (token) {
                    try {
                        android.abortDownload(token);
                    } catch (abortError) {
                        console.warn('Unable to abort native download', abortError);
                    }
                }
                if (!session.completion.settled) {
                    session.completion.reject(error);
                }
                if (signal?.aborted || aborted) {
                    throw abortError;
                }
                throw error;
            } finally {
                if (signal && typeof signal.removeEventListener === 'function') {
                    signal.removeEventListener('abort', abortHandler);
                }
                removeSession(requestId);
            }
        },

        async openSavedDownload(uri, mimeType = 'application/octet-stream') {
            if (!uri) {
                throw new Error('A valid URI is required to open the download.');
            }
            if (!android || typeof android.openDownload !== 'function') {
                throw new Error('Native open-download bridge unavailable.');
            }
            android.openDownload(uri, mimeType);
        }
    };

    window.StoryWeaver.__androidDownloadBridge = bridge;
    return bridge;

    function createDownloadAbortError() {
        const error = new Error('Download cancelled');
        error.name = 'AbortError';
        return error;
    }
}

function encodeBase64(bytes) {
    if (!bytes || !bytes.length) {
        return '';
    }
    const chunkSize = 0x8000;
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
        const chunk = bytes.subarray(offset, offset + chunkSize);
        binary += String.fromCharCode.apply(null, chunk);
    }
    return btoa(binary);
}

function createDeferred() {
    let resolveFn;
    let rejectFn;
    const deferred = {
        settled: false,
        promise: null,
        resolve(value) {
            if (deferred.settled) return;
            deferred.settled = true;
            resolveFn(value);
        },
        reject(reason) {
            if (deferred.settled) return;
            deferred.settled = true;
            rejectFn(reason);
        }
    };
    deferred.promise = new Promise((resolve, reject) => {
        resolveFn = resolve;
        rejectFn = reject;
    });
    return deferred;
}

function generateRequestId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    return `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function triggerDownload(url, filename) {
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}
