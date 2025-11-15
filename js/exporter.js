// Client-side media exporter. Uses Canvas capture + MediaRecorder with a Ken Burns style render loop.
// Swap in WebCodecs by replacing exportVideo implementation but keeping the drawSlideToCanvas contract.
import { drawSlideToCanvas } from './slideRenderer.js';

export async function exportVideo({
    slides,
    canvas,
    orientation,
    theme,
    includeAudio = false,
    onProgress,
    signal
}) {
    if (!('MediaRecorder' in window)) {
        throw new Error('MediaRecorder API unavailable');
    }

    const videoStream = canvas.captureStream(30);
    let recordStream = videoStream;
    if (includeAudio && 'AudioContext' in window) {
        const audioContext = new AudioContext();
        const destination = audioContext.createMediaStreamDestination();
        recordStream = mergeStreams(videoStream, destination.stream);
    }

    const mimeType = selectMimeType();
    const recorder = new MediaRecorder(recordStream, { mimeType, videoBitsPerSecond: 4_000_000 });
    const chunks = [];
    let cancelled = false;

    const abortHandler = () => {
        cancelled = true;
        try {
            if (recorder.state !== 'inactive') {
                recorder.stop();
            }
        } catch (stopError) {
            console.warn('MediaRecorder stop error after abort', stopError);
        }
    };

    if (signal) {
        if (signal.aborted) {
            abortHandler();
            throw createAbortError();
        }
        signal.addEventListener('abort', abortHandler, { once: true });
    }

    recorder.ondataavailable = event => {
        if (event.data.size) {
            chunks.push(event.data);
        }
    };

    const recordingComplete = new Promise(resolve => {
        recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }));
    });

    recorder.start();

    const fps = 30;
    const fadeFrames = 12;
    const frameBudgets = slides.map(slide => {
        const durationMs = slide.duration || 6500;
        return Math.ceil((durationMs / 1000) * fps);
    });
    const totalFrames = frameBudgets.reduce((sum, frames) => sum + frames, 0) + Math.max(0, slides.length - 1) * fadeFrames;
    let renderedFrames = 0;
    let lastProgress = -1;

    if (typeof onProgress === 'function') {
        onProgress(0);
        lastProgress = 0;
    }

    const emitProgress = () => {
        if (typeof onProgress !== 'function' || totalFrames <= 0) {
            return;
        }
        const percent = Math.min(100, Math.max(0, Math.floor((renderedFrames / totalFrames) * 100)));
        if (percent !== lastProgress) {
            lastProgress = percent;
            onProgress(percent);
        }
    };

    try {
        for (let slideIndex = 0; slideIndex < slides.length; slideIndex += 1) {
            if (cancelled) break;
            const slide = slides[slideIndex];
            const totalFramesForSlide = frameBudgets[slideIndex] || 0;
            for (let frame = 0; frame < totalFramesForSlide; frame += 1) {
                if (cancelled) break;
                if (signal?.aborted) {
                    cancelled = true;
                    break;
                }
                const progress = frame / (totalFramesForSlide - 1 || 1);
                await drawSlideToCanvas(slide, canvas, {
                    orientation,
                    theme,
                    kenBurnsProgress: progress,
                    headlineReveal: progress
                });
                await waitForFrame(fps, signal);
                renderedFrames += 1;
                emitProgress();
            }
            if (cancelled) break;
            await fadeTransition(canvas, slides[slideIndex + 1], {
                orientation,
                theme,
                fps,
                signal,
                onFrame: () => {
                    renderedFrames += 1;
                    emitProgress();
                }
            });
        }
    } finally {
        if (recorder.state !== 'inactive') {
            try {
                recorder.stop();
            } catch (stopError) {
                console.warn('MediaRecorder stop error', stopError);
            }
        }
        if (signal && typeof signal.removeEventListener === 'function') {
            signal.removeEventListener('abort', abortHandler);
        }
    }

    const blob = await recordingComplete;

    if (cancelled || signal?.aborted) {
        throw createAbortError();
    }

    if (typeof onProgress === 'function') {
        onProgress(100);
    }
    return blob;
}

export async function exportStoryboard(slides, canvas, { orientation, layout, theme }) {
    const assets = [];
    for (let index = 0; index < slides.length; index += 1) {
        const slide = slides[index];
        await drawSlideToCanvas(slide, canvas, { orientation, theme, kenBurnsProgress: 0.5 });
        const dataUrl = canvas.toDataURL('image/png');
        assets.push({
            id: slide.id,
            headline: slide.headline,
            summary: slide.summary,
            bullets: slide.bullets,
            duration: slide.duration,
            dataUrl
        });
    }

    const payload = {
        generatedAt: new Date().toISOString(),
        orientation,
        layout,
        theme,
        slides: assets
    };

    return new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
}

function mergeStreams(videoStream, audioStream) {
    const combined = new MediaStream();
    videoStream.getTracks().forEach(track => combined.addTrack(track));
    audioStream.getTracks().forEach(track => combined.addTrack(track));
    return combined;
}

function selectMimeType() {
    if (MediaRecorder.isTypeSupported('video/webm;codecs=vp9')) return 'video/webm;codecs=vp9';
    if (MediaRecorder.isTypeSupported('video/webm;codecs=vp8')) return 'video/webm;codecs=vp8';
    return 'video/webm';
}

async function fadeTransition(canvas, nextSlide, options = {}) {
    if (!nextSlide) return;
    const {
        orientation,
        theme,
        fps = 30,
        onFrame,
        signal
    } = options;
    const temp = document.createElement('canvas');
    temp.width = canvas.width;
    temp.height = canvas.height;
    await drawSlideToCanvas(nextSlide, temp, { orientation, theme, kenBurnsProgress: 0 });
    const ctx = canvas.getContext('2d');
    const frames = 12;
    for (let frame = 0; frame < frames; frame += 1) {
        const alpha = frame / (frames - 1 || 1);
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.drawImage(temp, 0, 0, canvas.width, canvas.height);
        ctx.restore();
        await waitForFrame(fps, signal);
        onFrame?.();
    }
}

function waitForFrame(fps, signal) {
    if (signal?.aborted) {
        return Promise.reject(createAbortError());
    }
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            cleanup();
            resolve();
        }, 1000 / fps);

        const cleanup = () => {
            clearTimeout(timeout);
            if (signal && typeof signal.removeEventListener === 'function' && abortListener) {
                signal.removeEventListener('abort', abortListener);
            }
        };

        const abortListener = () => {
            cleanup();
            reject(createAbortError());
        };

        if (signal && typeof signal.addEventListener === 'function') {
            signal.addEventListener('abort', abortListener, { once: true });
        }
    });
}

function createAbortError() {
    try {
        return new DOMException('Rendering aborted', 'AbortError');
    } catch (domError) {
        const error = new Error('Rendering aborted');
        error.name = 'AbortError';
        return error;
    }
}
