/**
 * Micro-benchmark de propsSI para @luisbedoia/coolprop-wasm.
 *
 * Objetivo
 * --------
 * Medir el tiempo medio por llamada a propsSI desde Node.js sobre el módulo
 * WebAssembly compilado de CoolProp, con varias cargas representativas del
 * uso típico en la PWA Thermoprops. Los números que arroja este script son
 * los que aparecen reportados en la Tabla 5 del Informe Final de la práctica.
 *
 * Uso
 * ---
 *   node --experimental-vm-modules tests/benchmark_propssi.mjs
 *
 * Opciones por variables de entorno
 * ---------------------------------
 *   N       Número de llamadas por carga (default 10000).
 *   WARMUP  Número de llamadas de calentamiento (default 200).
 *   JSON=1  Emite también un bloque JSON al final, útil para pegar en el
 *           informe sin transcribir a mano.
 *
 * Requisitos
 * ----------
 *   - Haber ejecutado previamente `docker-compose up --build` o `bash build.sh`
 *     para generar los artefactos en ./wasm/
 *
 * Autor: Luis Fernando Arias Bedoya
 * Licencia: MIT
 */

import path from 'path';
import os from 'os';
import process from 'process';
import { performance } from 'perf_hooks';
import { fileURLToPath, pathToFileURL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------------------------------------------------------------------------
// Configuración
// ---------------------------------------------------------------------------

const N = Number(process.env.N || 10000);
const WARMUP = Number(process.env.WARMUP || 200);
const EMIT_JSON = process.env.JSON === '1' || process.env.JSON === 'true';

// Cargas de trabajo. Cada una se ejecuta N veces tras WARMUP iteraciones
// de calentamiento. Los rangos están elegidos para que el punto quede
// dentro del dominio válido del fluido en todas las iteraciones.
const WORKLOADS = [
    {
        name: 'Water · H de (T, P)',
        fluid: 'Water',
        call: (cp, i) => cp.propsSI('H', 'T', 500 + (i % 200), 'P', 1e6, 'Water'),
    },
    {
        name: 'Water · S de (T, P)',
        fluid: 'Water',
        call: (cp, i) => cp.propsSI('S', 'T', 500 + (i % 200), 'P', 1e6, 'Water'),
    },
    {
        name: 'Water · P de T sat (Q=0)',
        fluid: 'Water',
        call: (cp, i) => cp.propsSI('P', 'T', 320 + (i % 50), 'Q', 0, 'Water'),
    },
    {
        name: 'Air · D de (T, P)',
        fluid: 'Air',
        call: (cp, i) => cp.propsSI('D', 'T', 300 + (i % 500), 'P', 1.01325e5, 'Air'),
    },
    {
        name: 'Ammonia · H_fg de T sat',
        fluid: 'Ammonia',
        call: (cp, i) => {
            const T = 260 + (i % 40);
            const hg = cp.propsSI('H', 'T', T, 'Q', 1, 'Ammonia');
            const hf = cp.propsSI('H', 'T', T, 'Q', 0, 'Ammonia');
            return hg - hf;
        },
        // Esta carga hace 2 llamadas por iteración — se normaliza abajo.
        callsPerIter: 2,
    },
];

// ---------------------------------------------------------------------------
// Carga del módulo WebAssembly
// ---------------------------------------------------------------------------

async function loadCoolProp() {
    const modulePath = path.resolve(__dirname, '..', 'wasm', 'coolprop.js');
    const moduleUrl = pathToFileURL(modulePath).href;
    const factoryModule = await import(moduleUrl);
    const createModule = factoryModule.default;
    if (typeof createModule !== 'function') {
        throw new Error('coolprop wasm factory no encontrada en ' + modulePath);
    }
    const locateFile = (file) => path.resolve(__dirname, '..', 'wasm', file);
    return createModule({ locateFile });
}

// ---------------------------------------------------------------------------
// Benchmark individual
// ---------------------------------------------------------------------------

function runWorkload(cp, workload) {
    // Warmup: se descarta para evitar incluir el costo de JIT warmup y de
    // primera inicialización de las EOS dentro del timing.
    for (let i = 0; i < WARMUP; i++) {
        workload.call(cp, i);
    }

    const times = new Array(N);
    for (let i = 0; i < N; i++) {
        const t0 = performance.now();
        workload.call(cp, i);
        const t1 = performance.now();
        times[i] = t1 - t0;
    }

    // Estadísticas robustas: media, mediana, p95, desviación estándar.
    const callsPerIter = workload.callsPerIter || 1;
    const perCall = times.map((t) => t / callsPerIter).sort((a, b) => a - b);
    const sum = perCall.reduce((a, b) => a + b, 0);
    const mean = sum / N;
    const median = perCall[Math.floor(N * 0.5)];
    const p95 = perCall[Math.floor(N * 0.95)];
    const p99 = perCall[Math.floor(N * 0.99)];
    const variance =
        perCall.reduce((acc, t) => acc + (t - mean) ** 2, 0) / N;
    const stdDev = Math.sqrt(variance);

    return {
        name: workload.name,
        fluid: workload.fluid,
        N,
        callsPerIter,
        totalCalls: N * callsPerIter,
        meanMs: mean,
        medianMs: median,
        p95Ms: p95,
        p99Ms: p99,
        stdDevMs: stdDev,
        throughputHz: 1000 / mean,
    };
}

// ---------------------------------------------------------------------------
// Salida
// ---------------------------------------------------------------------------

function pad(s, width) {
    s = String(s);
    if (s.length >= width) return s;
    return s + ' '.repeat(width - s.length);
}

function padLeft(s, width) {
    s = String(s);
    if (s.length >= width) return s;
    return ' '.repeat(width - s.length) + s;
}

function fmt(n, dec = 4) {
    return Number(n).toFixed(dec);
}

function printTable(results) {
    const headers = [
        'Carga',
        'N',
        'media [ms]',
        'mediana [ms]',
        'p95 [ms]',
        'σ [ms]',
        'thr. [llam/s]',
    ];
    const rows = results.map((r) => [
        r.name,
        String(r.totalCalls),
        fmt(r.meanMs),
        fmt(r.medianMs),
        fmt(r.p95Ms),
        fmt(r.stdDevMs),
        r.throughputHz.toFixed(0),
    ]);
    const widths = headers.map((h, i) =>
        Math.max(h.length, ...rows.map((r) => r[i].length))
    );

    const line = (cells) =>
        cells
            .map((c, i) => (i === 0 ? pad(c, widths[i]) : padLeft(c, widths[i])))
            .join('  ');

    console.log('');
    console.log(line(headers));
    console.log(widths.map((w) => '-'.repeat(w)).join('  '));
    for (const r of rows) console.log(line(r));
    console.log('');
}

function detectCPU() {
    const cpus = os.cpus();
    const model =
        cpus[0] && cpus[0].model && cpus[0].model !== 'unknown'
            ? cpus[0].model.trim()
            : null;
    return {
        model,
        cores: cpus.length,
        speedMHz: cpus[0] ? cpus[0].speed : null,
        arch: process.arch,
        platform: process.platform,
        osRelease: os.release(),
        totalMemGB: Number((os.totalmem() / 1e9).toFixed(1)),
    };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

(async () => {
    const cp = await loadCoolProp();

    const cpVersion = cp.getGlobalParamString('version');
    const cpGitRev = cp.getGlobalParamString('gitrevision');
    const cpuInfo = detectCPU();

    console.log('# Micro-benchmark propsSI — @luisbedoia/coolprop-wasm');
    console.log('');
    console.log(`CoolProp        : ${cpVersion} (gitrev ${cpGitRev})`);
    console.log(`Node.js         : ${process.version}`);
    console.log(`Platform / Arch : ${cpuInfo.platform} / ${cpuInfo.arch} (${cpuInfo.osRelease})`);
    console.log(
        `CPU             : ${cpuInfo.model || '(modelo no expuesto por el kernel)'}` +
            ` · ${cpuInfo.cores} núcleos lógicos` +
            (cpuInfo.speedMHz ? ` · ${cpuInfo.speedMHz} MHz nominal` : '')
    );
    console.log(`Memoria total   : ${cpuInfo.totalMemGB} GB`);
    console.log(`N por carga     : ${N}  (warmup ${WARMUP})`);

    const results = [];
    for (const workload of WORKLOADS) {
        process.stdout.write(`\nCorriendo '${workload.name}' ... `);
        const r = runWorkload(cp, workload);
        results.push(r);
        process.stdout.write('ok\n');
    }

    printTable(results);

    // Agregado global (media aritmética de las cargas individuales).
    const meanOfMeans =
        results.reduce((acc, r) => acc + r.meanMs, 0) / results.length;
    console.log(
        `Tiempo medio por llamada (promedio de las ${results.length} cargas): ${fmt(
            meanOfMeans
        )} ms  (${(1000 / meanOfMeans).toFixed(0)} llam/s)`
    );

    if (EMIT_JSON) {
        const payload = {
            generatedAt: new Date().toISOString(),
            coolProp: { version: cpVersion, gitrevision: cpGitRev },
            runtime: {
                node: process.version,
                ...cpuInfo,
            },
            config: { N, warmup: WARMUP },
            workloads: results,
            summary: {
                meanOfMeansMs: meanOfMeans,
                throughputHz: 1000 / meanOfMeans,
            },
        };
        console.log('\n--- JSON ---');
        console.log(JSON.stringify(payload, null, 2));
    }
})().catch((err) => {
    console.error('\nBenchmark falló:', err);
    process.exit(1);
});
