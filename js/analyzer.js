import { generateSlidesWithLongcat } from './longcatService.js';
import { detectChartSpec } from './charting.js';

// High-level analysis pipeline that delegates summarization to Longcat, with local fallbacks.
// Swap-in tip: replace generateSlidesWithLongcat with another provider or offline model without
// touching downstream rendering logic so long as slide objects maintain the same shape.
export async function synthesizeSlides({
    pdfMeta,
    pages,
    orientation,
    layout,
    longcatConfig,
    dataSources
}) {
    const { apiKey, endpoint } = longcatConfig;
    const sections = clampSections(inferSectionCount(pages.length));
    const documentPrompt = buildDocumentPrompt(pages);

    const slides = await generateSlidesWithLongcat({
        documentText: documentPrompt,
        sections,
        orientation,
        layout,
        apiKey,
        endpoint
    });

    const paragraphChunks = chunkPages(pages, slides.length);
    const enriched = slides.map((slide, index) => {
        const sourceChunk = paragraphChunks[index] || { text: '', pages: [] };
        const normalizedHeadline = sanitizeHeadline(slide.headline);
        const normalizedSummary = normalizeSummary(slide.summary);
        const normalizedBullets = normalizeBullets(slide.bullets);
        const template = resolveTemplate(slide.template, normalizedBullets, slide.chartHint);
        const combinedText = [normalizedSummary, ...normalizedBullets].join(' ');
        const chartSpec = template === 'text-image-chart'
            ? detectChartSpec(slide.chartHint || combinedText || sourceChunk.text, dataSources)
            : null;
        const heroPrompt = slide.heroPrompt || buildDefaultHeroPrompt(pdfMeta.title, normalizedHeadline, slide.tone);

        return {
            id: slide.id || `slide-${index + 1}`,
            headline: normalizedHeadline,
            summary: normalizedSummary,
            bullets: normalizedBullets,
            heroPrompt,
            chartSpec,
            chartEnabled: template === 'text-image-chart' && Boolean(chartSpec),
            chartRationale: chartSpec?.rationale || slide.chartHint || '',
            rationale: slide.rationale || '',
            tone: slide.tone || 'neutral',
            duration: 0,
            template,
            sourcePages: sourceChunk.pages,
            sourceText: sourceChunk.text
        };
    });

    return enriched.map(slide => ({
        ...slide,
        duration: 14000
    }));
}

function inferSectionCount(totalPages) {
    if (totalPages <= 2) return 2;
    if (totalPages <= 5) return 3;
    if (totalPages <= 10) return 4;
    if (totalPages <= 18) return 5;
    return 6;
}

function clampSections(value) {
    return Math.min(Math.max(value, 2), 6);
}

function chunkPages(pages, chunkCount) {
    if (!pages.length) return [];
    const totals = pages.length;
    const chunkSize = Math.ceil(totals / chunkCount);
    const chunks = [];
    for (let index = 0; index < chunkCount; index += 1) {
        const slice = pages.slice(index * chunkSize, (index + 1) * chunkSize);
        chunks.push({
            text: slice.map(item => item.text).join(' '),
            pages: slice.map(item => item.index)
        });
    }
    return chunks;
}

function sanitizeHeadline(value) {
    if (!value) return 'Untitled slide';
    let cleaned = value.replace(/\s+/g, ' ').trim();
    cleaned = cleaned.replace(/^[0-9]+[)\].:-\s]+/, '');
    cleaned = cleaned.replace(/^(chapter|section|slide)\s+[0-9]+[:\s-]+/i, '');
    return cleaned;
}

function normalizeSummary(value) {
    if (!value) return '';
    return value.replace(/\s+/g, ' ').trim();
}

function normalizeBullets(bullets = []) {
    return bullets
        .filter(Boolean)
        .map(bullet => {
            const trimmed = bullet.replace(/\s+/g, ' ').replace(/^[•*-]\s*/, '').trim();
            if (!trimmed) return '';
            return trimmed;
        })
        .filter(Boolean);
}

function buildDefaultHeroPrompt(title, headline, tone) {
    const toneDescriptor = tone === 'optimistic' ? 'hopeful' : tone === 'cautious' ? 'measured' : 'balanced';
    return `Illustration inspired by "${headline || title}" rendered in a ${toneDescriptor} editorial style.`;
}

function buildDocumentPrompt(pages, { maxChars = 18000, perPageLimit = 900 } = {}) {
    if (!pages?.length) return 'Document contained no readable text.';

    const segments = pages.map(page => {
        const cleaned = page.text.replace(/\s+/g, ' ').trim();
        if (!cleaned) return null;
        const truncated = cleaned.length > perPageLimit ? `${cleaned.slice(0, perPageLimit - 1).trim()}…` : cleaned;
        return `Page ${page.index + 1}: ${truncated}`;
    }).filter(Boolean);

    if (!segments.length) {
        return 'Document contained no readable text.';
    }

    let assembled = '';
    for (const segment of segments) {
        if (!assembled.length) {
            assembled = segment;
        } else if (assembled.length + segment.length + 2 <= maxChars) {
            assembled = `${assembled}\n\n${segment}`;
        } else {
            const remaining = maxChars - assembled.length - 5;
            if (remaining > 0) {
                assembled = `${assembled}\n\n${segment.slice(0, remaining).trim()}…`;
            }
            break;
        }
    }

    return assembled;
}

function resolveTemplate(preferred, bullets, chartHint) {
    const normalized = typeof preferred === 'string' ? preferred.trim().toLowerCase() : '';
    if (normalized === 'text-image-chart' || normalized === 'quad-grid' || normalized === 'text-image') {
        return normalized;
    }
    if (chartHint) {
        return 'text-image-chart';
    }
    if (bullets.length >= 4) {
        return 'quad-grid';
    }
    return 'text-image';
}
