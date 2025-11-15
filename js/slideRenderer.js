// Slide renderer handles both editor markup and export canvas drawing.
// Swap-in tip: override loadHeroImage to integrate paid imagery APIs while keeping caching semantics.
import { renderChart, disposeCharts } from './charting.js';

const heroCache = new Map();
const TEMPLATE_LABELS = {
    'text-image': 'Text & Image',
    'text-image-chart': 'Text, Image & Chart',
    'quad-grid': 'Four Highlights'
};

function sanitizeCopy(value) {
    if (value == null) {
        return '';
    }
    const raw = String(value);
    if (/^\s*(?:hero\s+(?:image|prompt)|image\s+(?:url|link|source|prompt)|photo\s+(?:url|link|source|prompt)|illustration\s+(?:url|link|source|prompt))[:\-\s]/i.test(raw)) {
        return '';
    }
    let text = raw;
    text = text.replace(/\[[^\]]*https?:\/\/[^\]]*\]/gi, ' ');
    text = text.replace(/\([^)]*https?:\/\/[^)]*\)/gi, ' ');
    text = text.replace(/https?:\/\/\S+/gi, ' ');
    text = text.replace(/\b(?:hero\s+(?:image|prompt)|image\s+(?:url|link|source|prompt)|photo\s+(?:url|link|source|prompt)|illustration\s+(?:url|link|source|prompt))[:\-]?\s*/gi, ' ');
    text = text.replace(/\s{2,}/g, ' ').trim();
    text = text.replace(/^[\s:;,.\-–]+/, '').replace(/[\s:;,.\-–]+$/, '');
    return text.trim();
}

function sanitizeSlideContent(slide = {}) {
    const headline = sanitizeCopy(slide.headline);
    const summary = sanitizeCopy(slide.summary);
    const bullets = Array.isArray(slide.bullets) ? slide.bullets.map(item => sanitizeCopy(item)) : [];
    const chartRationale = sanitizeCopy(slide.chartSpec?.rationale ?? slide.chartRationale ?? '');
    return { headline, summary, bullets, chartRationale };
}

function ensureBulletCapacity(bullets, template) {
    const capacity = template === 'quad-grid' ? 4 : 3;
    const normalized = Array.isArray(bullets) ? bullets.slice(0, capacity) : [];
    while (normalized.length < capacity) {
        normalized.push('');
    }
    return normalized;
}

export function sanitizeSlideForExport(slide) {
    if (!slide) {
        return slide;
    }
    const sanitized = sanitizeSlideContent(slide);
    const bullets = ensureBulletCapacity(sanitized.bullets, slide.template);
    const chartSpec = slide.chartSpec
        ? { ...slide.chartSpec, rationale: sanitized.chartRationale }
        : null;
    return {
        ...slide,
        headline: sanitized.headline,
        summary: sanitized.summary,
        bullets,
        chartSpec,
        chartRationale: sanitized.chartRationale
    };
}

function getHeroCacheKey(slide) {
    const explicitImage = typeof slide.heroImage === 'string' && slide.heroImage.trim().length
        ? slide.heroImage.trim()
        : null;
    if (explicitImage) {
        return `image:${slide.id}:${explicitImage}`;
    }
    const prompt = typeof slide.heroPrompt === 'string' ? slide.heroPrompt.trim() : '';
    const headline = typeof slide.headline === 'string' ? slide.headline.trim() : '';
    return `prompt:${slide.id}:${prompt}|${headline}`;
}

export function renderSlideEditor(slides, container, { activeIndex }) {
    container.innerHTML = '';
    slides.forEach((slide, index) => {
        const card = document.createElement('article');
        card.className = 'slide-card';
        card.setAttribute('role', 'listitem');
        card.dataset.slideId = slide.id;
        if (index === activeIndex) {
            card.classList.add('active');
        }

        card.innerHTML = `
            <header>
                <div>
                    <strong>Slide ${index + 1}</strong>
                    <span class="slide-meta">Pages: ${formatPageRange(slide.sourcePages)}</span>
                </div>
                <div class="slide-controls">
                    <button type="button" class="pill pill-secondary" data-move="up" aria-label="Move slide up">▲</button>
                    <button type="button" class="pill pill-secondary" data-move="down" aria-label="Move slide down">▼</button>
                    ${renderChartToggle(slide)}
                </div>
            </header>
            <label>
                Layout style
                <select data-field="template">
                    ${renderTemplateOptions(slide.template)}
                </select>
            </label>
            <label>
                Headline
                <input type="text" data-field="headline" value="${escapeHtml(slide.headline)}" maxlength="65">
            </label>
            <label>
                Summary (2 sentences)
                <textarea data-field="summary" rows="3">${escapeHtml(slide.summary)}</textarea>
            </label>
            <div class="bullet-fields">
                ${renderBulletInputs(slide.bullets, slide.template)}
            </div>
            <label>
                Hero prompt
                <input type="text" data-field="heroPrompt" value="${escapeHtml(slide.heroPrompt || '')}" placeholder="Describe the illustration or concept">
            </label>
            <label>
                Hero image override (optional URL)
                <input type="url" data-field="heroImage" value="${escapeHtml(slide.heroImage || '')}" placeholder="https://example.com/image.png">
            </label>
            <textarea data-field="rationale" rows="2" aria-label="Slide rationale" disabled>${escapeHtml(slide.rationale || '')}</textarea>
        `;

        container.appendChild(card);
    });
}

export function renderPreview(slides, container, { activeIndex, orientation, layout, theme }) {
    container.innerHTML = '';
    disposeCharts();
    slides.forEach((slide, index) => {
        const preview = document.createElement('div');
        preview.className = 'preview-slide';
        preview.dataset.slideId = slide.id;
        preview.tabIndex = 0;
        preview.setAttribute('role', 'button');
        preview.setAttribute('aria-pressed', index === activeIndex ? 'true' : 'false');
        preview.dataset.template = slide.template;
        if (index === activeIndex) {
            preview.classList.add('active');
        }
        preview.appendChild(buildPreviewContent(slide));
        container.appendChild(preview);
    });
}

export async function drawSlideToCanvas(slide, canvas, { orientation, theme, kenBurnsProgress = 0, headlineReveal = 1 }) {
    const workingSlide = sanitizeSlideForExport(slide);
    const ctx = canvas.getContext('2d');
    const width = orientation === 'portrait' ? 1080 : 1920;
    const height = orientation === 'portrait' ? 1920 : 1080;
    canvas.width = width;
    canvas.height = height;

    const colors = getCanvasPalette(theme);
    ctx.fillStyle = colors.background;
    ctx.fillRect(0, 0, width, height);

    if (workingSlide.template === 'quad-grid') {
        await drawQuadGridSlide(ctx, workingSlide, { width, height, colors, kenBurnsProgress, headlineReveal });
    } else {
        await drawTextImageSlide(ctx, workingSlide, { width, height, colors, kenBurnsProgress, headlineReveal });
    }
}

async function loadHeroImage(slide) {
    const cacheKey = getHeroCacheKey(slide);
    if (heroCache.has(cacheKey)) {
        return heroCache.get(cacheKey);
    }

    if (slide.heroImage) {
        try {
            const image = await loadImage(slide.heroImage);
            heroCache.set(cacheKey, image);
            return image;
        } catch (explicitError) {
            console.warn('Hero image override failed', explicitError);
        }
    }

    const seed = encodeURIComponent(slide.heroPrompt || slide.headline || slide.id);
    const url = `https://picsum.photos/seed/${seed}/1920/1080`;
    try {
        const image = await loadImage(url);
        heroCache.set(cacheKey, image);
        return image;
    } catch (error) {
        console.warn('Hero image unavailable', error);
        return null;
    }
}

function loadImage(url) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = url;
    });
}

function splitIntoLines(ctx, text, maxWidth) {
    const words = text.split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    const lines = [];
    let line = words.shift();

    while (words.length) {
        const word = words.shift();
        const testLine = `${line} ${word}`;
        if (ctx.measureText(testLine).width <= maxWidth || !line) {
            line = testLine;
        } else {
            lines.push(line);
            line = word;
        }
    }

    if (line) {
        lines.push(line);
    }
    return lines;
}

function drawTextBlock(ctx, text, {
    x,
    y,
    width,
    maxHeight,
    fontWeight = 400,
    baseSize,
    minSize,
    lineHeightFactor = 1.4,
    textAlign = 'left',
    reveal = 1
}) {
    const content = typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : '';
    if (!content) {
        return { nextY: y, fontSize: baseSize || minSize || 0, lines: [] };
    }

    const fallbackMin = Math.max(10, Math.floor((baseSize || 16) * 0.6));
    let size = baseSize || 16;
    let min = Math.max(fallbackMin, minSize || fallbackMin);
    const step = Math.max(1, Math.round(size * 0.06));
    let lines = [];
    let totalHeight = Infinity;

    ctx.textAlign = textAlign;

    while (size >= min) {
    ctx.font = `${fontWeight} ${size}px "Nunito"`;
        lines = splitIntoLines(ctx, content, width);
        const lineHeight = size * lineHeightFactor;
        totalHeight = lines.length * lineHeight;
        if (totalHeight <= maxHeight + 0.5) {
            break;
        }
        size -= step;
        if (size < min) {
            size = min;
            ctx.font = `${fontWeight} ${size}px "Nunito"`;
            lines = splitIntoLines(ctx, content, width);
            totalHeight = lines.length * size * lineHeightFactor;
            break;
        }
    }

    const lineHeight = size * lineHeightFactor;
    let cursorY = y;
    ctx.font = `${fontWeight} ${size}px "Nunito"`;
    ctx.textBaseline = 'top';

    const clampedReveal = Math.max(0, Math.min(1, reveal ?? 1));
    const totalCharacters = lines.reduce((sum, line) => sum + line.length, 0);
    const visibleChars = Math.floor(totalCharacters * clampedReveal + 0.0001);

    let paintedChars = 0;
    for (const line of lines) {
        if ((cursorY - y) + lineHeight > maxHeight + 0.5) {
            break;
        }
        let lineToDraw = line;
        if (clampedReveal < 1) {
            const remaining = visibleChars - paintedChars;
            if (remaining <= 0) {
                break;
            }
            if (remaining < line.length) {
                lineToDraw = line.slice(0, Math.max(0, remaining));
            }
        }
        ctx.fillText(lineToDraw, x, cursorY);
        paintedChars += Math.max(0, lineToDraw.length);
        cursorY += lineHeight;
    }

    return { nextY: cursorY, fontSize: size, lines };
}

async function drawChartToCanvas(ctx, chartSpec, colors, region) {
    const chartCanvas = document.createElement('canvas');
    chartCanvas.width = region.width;
    chartCanvas.height = region.height;

    try {
        renderChart(chartCanvas, chartSpec);
    } catch (error) {
        console.warn('Chart export skipped (Chart.js unavailable)', error);
        return;
    }
    await new Promise(resolve => setTimeout(resolve, 120));
    ctx.drawImage(chartCanvas, region.x, region.y, region.width, region.height);
    const rationale = sanitizeCopy(chartSpec.rationale);
    if (rationale) {
        ctx.save();
        ctx.fillStyle = colors.subtle;
        drawTextBlock(ctx, rationale, {
            x: region.x,
            y: region.y + region.height + 24,
            width: region.width,
            maxHeight: region.height * 0.6,
            baseSize: Math.round(region.width * 0.05),
            minSize: Math.max(12, Math.round(region.width * 0.03)),
            lineHeightFactor: 1.35
        });
        ctx.restore();
    }
}

function formatPageRange(pages = []) {
    if (!pages.length) return '-';
    const first = pages[0] + 1;
    const last = pages[pages.length - 1] + 1;
    return first === last ? `${first}` : `${first}-${last}`;
}

function renderBulletInputs(bullets, template) {
    const templateValue = template || 'text-image';
    const normalized = [...bullets];
    const targetLength = bulletCapacity(templateValue);
    while (normalized.length < targetLength) {
        normalized.push('');
    }
    return normalized.slice(0, targetLength).map((text, idx) => `
        <label>
            Bullet ${idx + 1}
            <textarea data-field="bullet-${idx}" rows="2">${escapeHtml(text)}</textarea>
        </label>
    `).join('');
}

function renderChartToggle(slide) {
    if (slide.template !== 'text-image-chart') {
        return '';
    }
    return `
        <label class="tts-option">
            <input type="checkbox" data-chart-toggle ${slide.chartEnabled ? 'checked' : ''}>
            Chart
        </label>
    `;
}

function renderTemplateOptions(current) {
    return Object.entries(TEMPLATE_LABELS)
        .map(([value, label]) => `<option value="${value}" ${current === value ? 'selected' : ''}>${label}</option>`)
        .join('');
}

function bulletCapacity(template) {
    if (template === 'quad-grid') {
        return 4;
    }
    return 3;
}

function buildPreviewContent(slide) {
    const container = document.createElement('div');
    container.className = 'preview-structure';
    container.dataset.template = slide.template;

    if (slide.template === 'quad-grid') {
        container.innerHTML = buildQuadGrid(slide);
        return container;
    }

    const sanitized = sanitizeSlideContent(slide);
    const headline = sanitized.headline;
    const summary = sanitized.summary;
    const bulletsMarkup = formatBullets(sanitized.bullets);
    const chartNote = slide.template === 'text-image-chart' && slide.chartEnabled && sanitized.chartRationale
        ? `<div class="preview-chart-note">${escapeHtml(sanitized.chartRationale)}</div>`
        : '';

    container.innerHTML = `
        <div class="preview-text-only">
            ${headline ? `<h3 class="preview-headline">${escapeHtml(headline)}</h3>` : ''}
            ${summary ? `<p class="preview-body">${escapeHtml(summary)}</p>` : ''}
            ${bulletsMarkup}
            ${chartNote}
        </div>
    `;

    return container;
}

function buildQuadGrid(slide) {
    const sanitized = sanitizeSlideContent(slide);
    const bullets = normalizeGridBullets(sanitized.bullets);
    const lead = sanitized.headline;
    const cells = [
        renderGridCell(bullets[0], 'northwest'),
        renderGridCell(bullets[1], 'northeast'),
        renderGridCell(bullets[2], 'southwest'),
        renderGridCell(bullets[3], 'southeast')
    ].filter(Boolean).join('');
    return `
        <div class="preview-text-only">
            ${lead ? `<h3 class="preview-grid-headline">${escapeHtml(lead)}</h3>` : ''}
            ${cells ? `<div class="preview-grid-list">${cells}</div>` : ''}
        </div>
    `;
}

function renderGridCell(text, position) {
    const cleaned = sanitizeCopy(text);
    if (!cleaned) {
        return '';
    }
    const { title, body } = splitBullet(cleaned);
    if (!title && !body) {
        return '';
    }
    const titleMarkup = title ? `<h4>${escapeHtml(title)}</h4>` : '';
    const bodyMarkup = body ? `<p>${escapeHtml(body)}</p>` : '';
    return `
        <div class="preview-grid-cell" data-position="${position}">
            ${titleMarkup}${bodyMarkup}
        </div>
    `;
}

function normalizeGridBullets(bullets = []) {
    const normalized = [...bullets];
    while (normalized.length < 4) {
        normalized.push('');
    }
    return normalized.slice(0, 4);
}

function formatBullets(bullets = []) {
    const items = bullets.slice(0, 3).map(bullet => {
        const cleaned = sanitizeCopy(bullet);
        if (!cleaned) {
            return '';
        }
        const { title, body } = splitBullet(cleaned);
        const titleMarkup = title ? `<h4>${escapeHtml(title)}</h4>` : '';
        const bodyMarkup = body ? `<p>${escapeHtml(body)}</p>` : '';
        if (!titleMarkup && !bodyMarkup) {
            return '';
        }
        return `<div class="preview-bullet">${titleMarkup}${bodyMarkup}</div>`;
    }).filter(Boolean);

    if (!items.length) {
        return '';
    }

    return `<div class="preview-bullets">${items.join('')}</div>`;
}

function splitBullet(text = '') {
    const cleaned = sanitizeCopy(text);
    if (!cleaned) {
        return { title: '', body: '' };
    }
    const segments = cleaned.split(/[:\-–]/);
    if (segments.length > 1) {
        const [first, ...rest] = segments;
        return {
            title: first.trim() || 'Highlight',
            body: rest.join(':').trim() || first.trim()
        };
    }
    const words = cleaned.split(' ');
    const title = words.slice(0, 3).join(' ');
    const body = words.slice(3).join(' ');
    return {
        title: title || 'Highlight',
        body: body || cleaned
    };
}

function getCanvasPalette(theme) {
    if (theme === 'dark') {
        return {
            background: '#1f2933',
            text: '#f1f3f5',
            accent: '#5f7db0',
            panel: '#2d3744',
            subtle: 'rgba(163, 177, 198, 0.7)'
        };
    }
    return {
        background: '#ccced6',
        text: '#1c1c1c',
        accent: '#2b4c7e',
        panel: '#f4f5f7',
        subtle: 'rgba(85, 91, 101, 0.65)'
    };
}

async function drawTextImageSlide(ctx, slide, { width, height, colors, kenBurnsProgress, headlineReveal }) {
    const sanitized = sanitizeSlideContent(slide);
    const padding = width * 0.08;
    const columnWidth = width * 0.54;
    const textX = padding;
    const textTop = padding;
    const chartReserve = slide.template === 'text-image-chart' && slide.chartEnabled && slide.chartSpec ? height * 0.28 : 0;
    const textBottomLimit = height - padding - chartReserve;

    ctx.save();
    ctx.fillStyle = colors.text;
    ctx.textAlign = 'left';

    const headlineBase = Math.round(width * 0.055);
    const headlineResult = drawTextBlock(ctx, sanitized.headline, {
        x: textX,
        y: textTop,
        width: columnWidth,
        maxHeight: textBottomLimit - textTop,
        baseSize: headlineBase,
        minSize: Math.max(20, Math.round(width * 0.035)),
        lineHeightFactor: 1.15,
        fontWeight: 700,
        reveal: headlineReveal
    });

    let cursorY = headlineResult.nextY + headlineBase * 0.4;

    const summaryBase = Math.round(width * 0.026);
    const summaryAvailable = Math.max(0, textBottomLimit - cursorY);
    if (summaryAvailable > 0) {
        const summaryResult = drawTextBlock(ctx, sanitized.summary, {
            x: textX,
            y: cursorY,
            width: columnWidth,
            maxHeight: summaryAvailable,
            baseSize: summaryBase,
            minSize: Math.max(14, Math.round(width * 0.018)),
            lineHeightFactor: 1.5,
            fontWeight: 400
        });
        cursorY = summaryResult.nextY + summaryBase * 0.6;
    }

    const bulletLimit = slide.template === 'quad-grid' ? 4 : 3;
    const bullets = ensureBulletCapacity(sanitized.bullets, slide.template).slice(0, bulletLimit);
    bullets.forEach((bullet, index) => {
        if (!bullet) return;
        const remainingBullets = bullets.length - index;
        const available = Math.max(0, textBottomLimit - cursorY);
        if (available <= 0) {
            return;
        }
        const { title, body } = splitBullet(bullet);

        const titleResult = drawTextBlock(ctx, title, {
            x: textX,
            y: cursorY,
            width: columnWidth,
            maxHeight: available,
            baseSize: Math.round(width * 0.028),
            minSize: Math.max(16, Math.round(width * 0.02)),
            lineHeightFactor: 1.2,
            fontWeight: 600
        });

        cursorY = titleResult.nextY + width * 0.01;

        const bodyAvailable = Math.max(0, textBottomLimit - cursorY);
        if (bodyAvailable > 0) {
            const bodyResult = drawTextBlock(ctx, body, {
                x: textX,
                y: cursorY,
                width: columnWidth,
                maxHeight: bodyAvailable,
                baseSize: Math.round(width * 0.022),
                minSize: Math.max(13, Math.round(width * 0.016)),
                lineHeightFactor: 1.45,
                fontWeight: 400
            });
            cursorY = bodyResult.nextY + width * 0.018;
        }

        if (remainingBullets > 1) {
            cursorY += width * 0.012;
        }
    });

    ctx.restore();

    const mediaWidth = width - columnWidth - padding * 2.2;
    const mediaHeight = height - padding * 2;
    const mediaX = width - mediaWidth - padding;
    const mediaY = padding;

    ctx.save();
    ctx.fillStyle = colors.panel;
    roundRect(ctx, mediaX, mediaY, mediaWidth, mediaHeight, 28, true, false);
    ctx.restore();

    const hero = await loadHeroImage(slide);
    if (hero) {
        const scaleStart = 1.08;
        const scaleEnd = 1.0;
        const scale = scaleStart - (scaleStart - scaleEnd) * kenBurnsProgress;
        const drawWidth = mediaWidth * scale;
        const drawHeight = mediaHeight * scale;
        const offsetX = mediaX + (mediaWidth - drawWidth) / 2;
        const offsetY = mediaY + (mediaHeight - drawHeight) / 2;
        ctx.save();
        clipRoundedRect(ctx, mediaX, mediaY, mediaWidth, mediaHeight, 28);
        ctx.drawImage(hero, offsetX, offsetY, drawWidth, drawHeight);
        ctx.restore();
    }

    if (chartReserve) {
        const chartWidth = columnWidth * 0.82;
        const chartHeight = chartReserve * 0.68;
        const chartX = textX;
        const chartY = height - padding - chartHeight;
        ctx.save();
        ctx.fillStyle = colors.panel;
        roundRect(ctx, chartX - 18, chartY - 18, chartWidth + 36, chartHeight + 36, 24, true, false);
        ctx.restore();
        await drawChartToCanvas(ctx, slide.chartSpec, colors, {
            x: chartX,
            y: chartY,
            width: chartWidth,
            height: chartHeight
        });
    }
}

async function drawQuadGridSlide(ctx, slide, { width, height, colors, kenBurnsProgress, headlineReveal }) {
    const sanitized = sanitizeSlideContent(slide);
    const margin = width * 0.08;
    ctx.fillStyle = colors.text;
    ctx.textAlign = 'center';
    drawTextBlock(ctx, sanitized.headline, {
        x: width / 2,
        y: margin,
        width: width - margin * 2,
        maxHeight: width * 0.14,
        baseSize: Math.round(width * 0.058),
        minSize: Math.max(20, Math.round(width * 0.034)),
        lineHeightFactor: 1.2,
        fontWeight: 700,
        textAlign: 'center',
        reveal: headlineReveal
    });
    ctx.textAlign = 'left';

    const gridWidth = width - margin * 2;
    const gridHeight = height - margin * 2 - width * 0.12;
    const cellWidth = gridWidth * 0.32;
    const cellHeight = gridHeight * 0.32;
    const topY = margin + width * 0.1;
    const leftX = margin;
    const rightX = width - margin - cellWidth;
    const bottomY = height - margin - cellHeight;

    const hero = await loadHeroImage(slide);
    const centerWidth = gridWidth * 0.26;
    const centerHeight = gridHeight * 0.36;
    const centerX = width / 2 - centerWidth / 2;
    const centerY = height / 2 - centerHeight / 2;

    ctx.save();
    ctx.fillStyle = colors.panel;
    roundRect(ctx, centerX, centerY, centerWidth, centerHeight, 30, true, false);
    if (hero) {
        const scale = 1.08 - 0.08 * kenBurnsProgress;
        const drawWidth = centerWidth * scale;
        const drawHeight = centerHeight * scale;
        const offsetX = centerX + (centerWidth - drawWidth) / 2;
        const offsetY = centerY + (centerHeight - drawHeight) / 2;
        clipRoundedRect(ctx, centerX, centerY, centerWidth, centerHeight, 30);
        ctx.drawImage(hero, offsetX, offsetY, drawWidth, drawHeight);
    }
    ctx.restore();

    const positions = [
        { x: leftX, y: topY },
        { x: rightX, y: topY },
        { x: leftX, y: bottomY },
        { x: rightX, y: bottomY }
    ];

    normalizeGridBullets(sanitized.bullets).forEach((text, idx) => {
        const { title, body } = splitBullet(text);
        const pos = positions[idx];
        ctx.save();
        ctx.fillStyle = colors.panel;
        roundRect(ctx, pos.x, pos.y, cellWidth, cellHeight, 24, true, false);
        ctx.fillStyle = colors.text;
        const innerX = pos.x + 24;
        const innerY = pos.y + 24;
        const innerWidth = cellWidth - 48;
        const innerHeight = cellHeight - 48;

        const titleResult = drawTextBlock(ctx, title, {
            x: innerX,
            y: innerY,
            width: innerWidth,
            maxHeight: innerHeight * 0.45,
            baseSize: Math.round(width * 0.028),
            minSize: Math.max(14, Math.round(width * 0.018)),
            lineHeightFactor: 1.2,
            fontWeight: 600
        });

        const bodyAvailable = Math.max(0, innerY + innerHeight - titleResult.nextY - width * 0.01);
        if (bodyAvailable > 0) {
            drawTextBlock(ctx, body, {
                x: innerX,
                y: titleResult.nextY + width * 0.01,
                width: innerWidth,
                maxHeight: bodyAvailable,
                baseSize: Math.round(width * 0.022),
                minSize: Math.max(12, Math.round(width * 0.015)),
                lineHeightFactor: 1.45,
                fontWeight: 400
            });
        }
        ctx.restore();
    });
}

function roundRect(ctx, x, y, width, height, radius, fill, stroke) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
    if (fill) ctx.fill();
    if (stroke) ctx.stroke();
}

function clipRoundedRect(ctx, x, y, width, height, radius) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
    ctx.clip();
}

function escapeHtml(value = '') {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
