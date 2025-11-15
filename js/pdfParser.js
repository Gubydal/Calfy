// PDF parsing utilities built on pdf.js with fallbacks for text extraction.
// Extension point: replace pdf.js with another parser by swapping extractPdfText implementation
// while keeping the return shape (title, pages, etc.).
const PDF_WORKER_SOURCE = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js';
let pdfWorkerReadyPromise = null;

async function ensurePdfWorker() {
    if (!window.pdfjsLib) {
        throw new Error('PDF.js library not loaded');
    }
    const currentWorker = window.pdfjsLib.GlobalWorkerOptions?.workerSrc;
    if (currentWorker) {
        return;
    }
    if (!pdfWorkerReadyPromise) {
        pdfWorkerReadyPromise = (async () => {
            const canInlineWorker = typeof fetch === 'function'
                && typeof Blob === 'function'
                && typeof URL !== 'undefined'
                && typeof URL.createObjectURL === 'function';

            if (canInlineWorker) {
                try {
                    const response = await fetch(PDF_WORKER_SOURCE, { mode: 'cors' });
                    if (!response.ok) {
                        throw new Error(`HTTP ${response.status}`);
                    }
                    const script = await response.text();
                    const blob = new Blob([script], { type: 'application/javascript' });
                    const blobUrl = URL.createObjectURL(blob);
                    window.__pdfWorkerBlobUrl = blobUrl;
                    window.pdfjsLib.GlobalWorkerOptions.workerSrc = blobUrl;
                    return;
                } catch (error) {
                    console.warn('Unable to inline PDF.js worker, falling back to remote worker', error);
                }
            }

            window.pdfjsLib.GlobalWorkerOptions.workerSrc = window.__pdfWorkerBlobUrl || PDF_WORKER_SOURCE;
        })();
    }

    await pdfWorkerReadyPromise;
}

export async function extractPdfText(file, { onProgress } = {}) {
    if (!window.pdfjsLib) {
        throw new Error('PDF.js library not loaded');
    }

    await ensurePdfWorker();

    const arrayBuffer = await file.arrayBuffer();
    let pdf;
    try {
        pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const workerFailed = /Setting up fake worker failed/i.test(message) || /Cannot load script/i.test(message);
        if (!workerFailed) {
            throw error;
        }

        console.warn('PDF.js worker failed to initialize, retrying without worker thread', error);
        if (typeof window.pdfjsLib.disableWorker === 'boolean') {
            window.pdfjsLib.disableWorker = true;
        }
        pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    }
    const totalPages = pdf.numPages;
    const pages = [];

    for (let pageIndex = 1; pageIndex <= totalPages; pageIndex += 1) {
        try {
            const page = await pdf.getPage(pageIndex);
            const content = await page.getTextContent();
            const pageText = content.items.map(item => item.str || '').join(' ').replace(/\s+/g, ' ').trim();
            pages.push({
                index: pageIndex - 1,
                text: pageText,
                hasTextContent: Boolean(pageText)
            });
        } catch (error) {
            console.warn('Failed to parse page', pageIndex, error);
            pages.push({
                index: pageIndex - 1,
                text: '',
                hasTextContent: false,
                error: error instanceof Error ? error.message : 'Unknown parsing error'
            });
        }

        if (typeof onProgress === 'function') {
            onProgress(Math.round((pageIndex / totalPages) * 100));
        }
    }

    const titleMeta = (await pdf.getMetadata().catch(() => ({ info: {}, metadata: {} }))) || {};
    const title = titleMeta.info?.Title || file.name.replace(/\.pdf$/i, '');

    pdf.cleanup();

    return {
        title,
        author: titleMeta.info?.Author || 'Unknown author',
        totalPages,
        pages,
        rawSize: file.size,
        lastModified: file.lastModified
    };
}

// Simple heuristic for extracting structured tables when PDF text fails.
export function harvestTables(pages) {
    return pages
        .filter(page => page.hasTextContent && page.text)
        .flatMap(page => {
            const lines = page.text.split(/(?<=\.)\s+|\n+/);
            const tableCandidates = lines.filter(line => /\d/.test(line) && /[:,]/.test(line));
            return tableCandidates.map(line => ({
                page: page.index,
                content: line
            }));
        });
}
