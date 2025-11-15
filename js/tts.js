let voices = [];
let speaking = false;
let currentQueue = [];

export function initializeVoices(selectEl) {
    if (!('speechSynthesis' in window)) {
        selectEl.disabled = true;
        selectEl.innerHTML = '<option>No speech synthesis support</option>';
        return;
    }

    function populate() {
        voices = window.speechSynthesis.getVoices();
        selectEl.innerHTML = voices
            .filter(voice => voice.lang.startsWith('en'))
            .map((voice, index) => `<option value="${index}">${voice.name} (${voice.lang})</option>`)
            .join('');
        if (!selectEl.value && voices.length) {
            selectEl.value = '0';
        }
    }

    populate();
    window.speechSynthesis.onvoiceschanged = populate;
}

export function speakSlides(slides, { voiceIndex = 0, onStart, onComplete, onError } = {}) {
    if (!('speechSynthesis' in window)) {
        onError?.(new Error('Speech synthesis unsupported'));
        return;
    }

    stopSpeaking();
    speaking = true;
    currentQueue = slides.map(slide => buildUtterance(slide, voiceIndex));

    currentQueue.forEach((utterance, idx) => {
        utterance.onstart = () => {
            onStart?.(idx);
        };
        utterance.onend = () => {
            if (idx === currentQueue.length - 1) {
                speaking = false;
                onComplete?.();
            }
        };
        utterance.onerror = event => {
            speaking = false;
            onError?.(event.error instanceof Error ? event.error : new Error(event.error || 'TTS error'));
        };
        window.speechSynthesis.speak(utterance);
    });
}

export function stopSpeaking() {
    if (!('speechSynthesis' in window)) return;
    if (speaking) {
        window.speechSynthesis.cancel();
    }
    speaking = false;
    currentQueue = [];
}

function buildUtterance(slide, voiceIndex) {
    const utterance = new SpeechSynthesisUtterance();
    const voice = voices[voiceIndex];
    if (voice) {
        utterance.voice = voice;
    }
    utterance.text = `${slide.headline}. ${slide.summary}. ${slide.bullets.join('. ')}.`;
    utterance.rate = 1.01;
    utterance.pitch = 1;
    utterance.volume = 0.85;
    return utterance;
}
