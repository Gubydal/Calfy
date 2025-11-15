// Application state container with a minimal pub/sub interface.
// Extension point: wire into a different reactive system by replacing notify/subscribe with
// custom observers without altering consuming modules.
export function createAppState() {
    const state = {
        pdf: null,
        pdfPages: [],
        slides: [],
        orientation: 'landscape',
        layout: 'hero',
        theme: 'light',
        progress: {
            pdf: 'pending',
            analysis: 'pending',
            assets: 'pending',
            assembly: 'pending'
        },
        activeSlideIndex: 0,
        dataSources: {
            csv: null,
            json: null
        },
        voicePreference: 'with',
        osmosisEnabled: false,
        premiumSelections: {
            videoStyles: false,
            voice: true
        },
        capabilities: {
            webCodecs: 'VideoEncoder' in window,
            mediaRecorder: 'MediaRecorder' in window,
            speech: 'speechSynthesis' in window
        },
        longcat: {
            apiKey: localStorage.getItem('storyweaver-longcat-key') || 'ak_1Co58b18G06O1Av6hD1X43Gw00k5J',
            endpoint: 'https://api.longcat.chat'
        }
    };

    const listeners = new Set();

    function notify(updatedKeys = []) {
        listeners.forEach(listener => listener(state, updatedKeys));
    }

    function setProgress(step, value) {
        if (!state.progress[step]) return;
        state.progress[step] = value;
        notify(['progress']);
    }

    function setSlides(slides) {
        state.slides = slides.map(normalizeSlide);
        state.activeSlideIndex = 0;
        notify(['slides']);
    }

    function updateSlide(id, updates) {
        const target = state.slides.find(slide => slide.id === id);
        if (!target) return;
        Object.assign(target, updates);
        normalizeSlide(target);
        notify(['slides']);
    }

    function reorderSlides(from, to) {
        if (from === to || from < 0 || to < 0 || from >= state.slides.length || to >= state.slides.length) return;
        const updated = [...state.slides];
        const [moved] = updated.splice(from, 1);
        updated.splice(to, 0, moved);
        state.slides = updated;
        state.activeSlideIndex = to;
        notify(['slides']);
    }

    function toggleSlideChart(id, enabled) {
        const target = state.slides.find(slide => slide.id === id);
        if (!target) return;
        if (target.template !== 'text-image-chart') return;
        target.chartEnabled = enabled;
        notify(['slides']);
    }

    function setTheme(theme) {
        state.theme = theme;
        localStorage.setItem('storyweaver-theme', theme);
        notify(['theme']);
    }

    function setOrientation(value) {
        state.orientation = value;
        notify(['orientation']);
    }

    function setLayout(value) {
        state.layout = value;
        notify(['layout']);
    }

    function setPdf(pdfMeta) {
        state.pdf = pdfMeta;
        notify(['pdf']);
    }

    function setPdfPages(pages) {
        state.pdfPages = pages;
        notify(['pdfPages']);
    }

    function setDataSource(type, payload) {
        if (!state.dataSources[type]) {
            state.dataSources[type] = payload;
        } else {
            state.dataSources[type] = payload;
        }
        notify(['dataSources']);
    }

    function setVoicePreference(value) {
        const next = value === 'without' ? 'without' : 'with';
        if (state.voicePreference === next) {
            return;
        }
        state.voicePreference = next;
        notify(['voicePreference']);
    }

    function setOsmosisEnabled(enabled) {
        const flag = Boolean(enabled);
        if (state.osmosisEnabled === flag) {
            return;
        }
        state.osmosisEnabled = flag;
        notify(['osmosisEnabled']);
    }

    function setPremiumSelection(key, enabled) {
        if (!(key in state.premiumSelections)) {
            return;
        }
        const flag = Boolean(enabled);
        if (state.premiumSelections[key] === flag) {
            return;
        }
        state.premiumSelections[key] = flag;
        notify(['premiumSelections']);
    }

    function setActiveSlide(index) {
        if (index < 0 || index >= state.slides.length) return;
        state.activeSlideIndex = index;
        notify(['activeSlideIndex']);
    }

    function setLongcatKey(key) {
        state.longcat.apiKey = key;
        if (key) {
            localStorage.setItem('storyweaver-longcat-key', key);
        } else {
            localStorage.removeItem('storyweaver-longcat-key');
        }
        notify(['longcat']);
    }

    function subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
    }

    const storedTheme = localStorage.getItem('storyweaver-theme');
    if (storedTheme === 'dark' || storedTheme === 'light') {
        state.theme = storedTheme;
    }

    if (!localStorage.getItem('storyweaver-longcat-key')) {
        localStorage.setItem('storyweaver-longcat-key', state.longcat.apiKey);
    }

    return {
        state,
        subscribe,
        setProgress,
        setSlides,
        updateSlide,
        reorderSlides,
        toggleSlideChart,
        setTheme,
        setOrientation,
        setLayout,
        setPdf,
        setPdfPages,
        setDataSource,
        setActiveSlide,
        setLongcatKey,
        setVoicePreference,
        setOsmosisEnabled,
        setPremiumSelection
    };
}

function normalizeSlide(slide) {
    slide.template = normalizeTemplate(slide.template);
    slide.bullets = normalizeBulletsForTemplate(slide.bullets || [], slide.template);
    if (slide.template !== 'text-image-chart') {
        slide.chartEnabled = false;
    }
    if (slide.template === 'text-image-chart' && slide.chartSpec) {
        slide.chartEnabled = slide.chartEnabled !== false;
    }
    return slide;
}

function normalizeTemplate(template) {
    if (template === 'text-image-chart' || template === 'quad-grid') {
        return template;
    }
    return 'text-image';
}

function normalizeBulletsForTemplate(bullets, template) {
    const clone = [...bullets];
    const targetLength = template === 'quad-grid' ? 4 : 3;
    while (clone.length < targetLength) {
        clone.push('');
    }
    return clone.slice(0, targetLength);
}
