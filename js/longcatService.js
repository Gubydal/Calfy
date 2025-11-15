// Longcat API integration. Responsible for requesting narrative structure from the model.
// The API schema is assumed and can be adapted via the buildRequestPayload / parseResponse helpers.
const DEFAULT_MODEL = 'LongCat-Flash-Chat';
const DEFAULT_ENDPOINT = 'https://api.longcat.chat';

function buildRequestPayload({ documentText, sections, orientation, layout }) {
    const systemPrompt = [
        'You are StoryWeaver, an expert presentation strategist.',
        `Craft ${sections} narrative slides for a ${orientation} video storyboard (overall layout preset: ${layout}).`,
        'Return polished copy only—no numbering prefixes, no labels like "Headline:".',
        'Choose the best slide template per story beat and include it as "template" with one of: "text-image", "text-image-chart", "quad-grid".',
        'Use "text-image-chart" when a chart strengthens the point and include a vivid one-sentence chartHint; otherwise set chartHint to null.',
        'Use "quad-grid" when highlighting four complementary takeaways; provide exactly four bullet entries in that case. For other templates, supply up to three bullets as needed.',
        'Write the full summary paragraph(s) without truncation. If a section is data heavy, mention the insight succinctly in the summary before referencing chartHint.',
        'Enhance emotional engagement with at least one contextually relevant emoji in each headline or first bullet (use modern Unicode emoji).',
        'Ensure heroPrompt describes the visual scene or metaphor that best supports the slide focus.',
        'Respond as strict JSON: {"slides": [{"id","template","headline","summary","bullets","heroPrompt","chartHint","rationale","tone"}]}.',
        'Keep language professional, audience-focused, and free of Markdown formatting.'
    ].join(' ');

    const userPrompt = [
        'Document to summarize:',
        documentText
    ].join('\n\n');

    return {
        model: DEFAULT_MODEL,
        messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
        ],
        temperature: 0.4,
        max_tokens: 2800
    };
}

function parseResponse(json) {
    const content = json?.choices?.[0]?.message?.content;
    if (!content) {
        throw new Error('Longcat response missing message content');
    }

    const cleaned = content
        .trim()
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/```$/i, '')
        .trim();

    try {
        const parsed = JSON.parse(cleaned);
        if (Array.isArray(parsed?.slides)) {
            return parsed.slides;
        }
    } catch (error) {
        console.warn('Failed to parse Longcat content as JSON', error, cleaned);
    }
    throw new Error('Longcat response missing slide data');
}

function resolveEndpoint(endpoint) {
    const base = (endpoint || DEFAULT_ENDPOINT).replace(/\/$/, '');
    if (/\/openai\/v1\/chat\/completions$/i.test(base)) {
        return base;
    }
    if (/\/openai\/v1$/i.test(base)) {
        return `${base}/chat/completions`;
    }
    if (/\/openai$/i.test(base)) {
        return `${base}/v1/chat/completions`;
    }
    return `${base}/openai/v1/chat/completions`;
}

export async function generateSlidesWithLongcat({ documentText, sections, orientation, layout, apiKey, endpoint }) {
    if (!apiKey) {
        throw new Error('Missing Longcat API key');
    }

    const payload = buildRequestPayload({ documentText, sections, orientation, layout });
    let response;
    try {
        response = await fetch(resolveEndpoint(endpoint), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify(payload)
        });
    } catch (networkError) {
        const friendly = new Error('Unable to reach the Longcat service. Check your connection or endpoint settings and try again.');
        friendly.name = 'LongcatNetworkError';
        friendly.cause = networkError;
        throw friendly;
    }

    if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new Error(`Longcat request failed: ${response.status} ${errorText}`);
    }

    const result = await response.json();
    return parseResponse(result).map((slide, index) => ({
        id: slide.id || `longcat-${index + 1}`,
        template: slide.template || null,
        headline: slide.headline?.trim?.() || `Slide ${index + 1}`,
        summary: slide.summary?.trim?.() || '',
        bullets: Array.isArray(slide.bullets) ? slide.bullets.map(b => (typeof b === 'string' ? b.trim() : '')).filter(Boolean) : [],
        heroPrompt: slide.heroPrompt || '',
        chartHint: slide.chartHint || null,
        rationale: slide.rationale || '',
        tone: slide.tone || 'neutral'
    }));
}
