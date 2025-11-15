// Chart detection and rendering helpers built around Chart.js.
const chartCache = new Map();

export function detectChartSpec(sectionText, importedData = {}) {
    if (!sectionText) return null;

    const lines = sectionText.split(/\n|\.\s+/).map(line => line.trim()).filter(Boolean);
    const numericPairs = lines
        .map(line => {
            const match = line.match(/^([^:;\-]+)[\s:;\-]+(-?\d+(?:\.\d+)?)/i);
            if (!match) return null;
            return { label: match[1].trim(), value: Number(match[2]) };
        })
        .filter(Boolean);

    if (numericPairs.length >= 3) {
        const labels = numericPairs.map(item => item.label);
        const data = numericPairs.map(item => item.value);
        const datasetLabel = 'Document insight';
        const type = inferChartType(data);

        return {
            type,
            labels,
            datasets: [
                {
                    label: datasetLabel,
                    data,
                    borderWidth: 2,
                    backgroundColor: data.map(() => '#6366f1'),
                    borderColor: '#4338ca',
                    tension: 0.35
                }
            ],
            rationale: `Detected ${numericPairs.length} numeric statements suggesting a ${type} chart.`
        };
    }

    if (importedData.csv?.length) {
        return buildChartFromCsv(importedData.csv);
    }

    if (importedData.json?.length) {
        return buildChartFromJson(importedData.json);
    }

    return null;
}

function inferChartType(values) {
    const monotonic = values.every((val, idx, arr) => idx === 0 || val >= arr[idx - 1]);
    const monotonicDescending = values.every((val, idx, arr) => idx === 0 || val <= arr[idx - 1]);
    if (monotonic || monotonicDescending) {
        return 'line';
    }
    return 'bar';
}

function buildChartFromCsv(rows) {
    const [, ...dataRows] = rows;
    const labels = [];
    const values = [];
    dataRows.forEach(row => {
        if (row.length >= 2 && !Number.isNaN(Number(row[1]))) {
            labels.push(row[0]);
            values.push(Number(row[1]));
        }
    });
    if (!labels.length) return null;
    return {
        type: inferChartType(values),
        labels,
        datasets: [
            {
                label: rows[0][1] || 'Series',
                data: values,
                borderWidth: 2,
                backgroundColor: values.map(() => '#22d3ee'),
                borderColor: '#0891b2',
                tension: 0.35
            }
        ],
        rationale: 'Chart suggested from imported CSV values.'
    };
}

function buildChartFromJson(jsonData) {
    const flattened = Array.isArray(jsonData) ? jsonData : Object.entries(jsonData).map(([key, value]) => ({ label: key, value }));
    const labels = [];
    const values = [];
    flattened.forEach(entry => {
        if (typeof entry === 'object' && entry !== null) {
            const label = entry.label || entry.name || entry.category;
            const value = entry.value ?? entry.amount ?? entry.total;
            if (label && typeof value === 'number') {
                labels.push(String(label));
                values.push(value);
            }
        }
    });
    if (!labels.length) return null;
    return {
        type: inferChartType(values),
        labels,
        datasets: [
            {
                label: 'Imported data',
                data: values,
                backgroundColor: values.map(() => '#f97316'),
                borderColor: '#ea580c',
                borderWidth: 2,
                tension: 0.35
            }
        ],
        rationale: 'Chart generated from imported JSON data.'
    };
}

export function renderChart(canvas, spec) {
    if (!window.Chart || !canvas) {
        throw new Error('Chart.js unavailable');
    }

    const key = canvas.dataset.chartKey || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2));
    canvas.dataset.chartKey = key;

    if (chartCache.has(key)) {
        chartCache.get(key).destroy();
    }

    const chart = new Chart(canvas.getContext('2d'), {
        type: spec.type,
        data: {
            labels: spec.labels,
            datasets: spec.datasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false
                }
            },
            scales: {
                y: {
                    grid: {
                        color: 'rgba(148, 163, 184, 0.2)'
                    },
                    ticks: {
                        color: 'inherit'
                    }
                },
                x: {
                    ticks: {
                        color: 'inherit'
                    }
                }
            }
        }
    });

    chartCache.set(key, chart);
    return chart;
}

export function disposeCharts() {
    chartCache.forEach(chart => chart.destroy());
    chartCache.clear();
}
