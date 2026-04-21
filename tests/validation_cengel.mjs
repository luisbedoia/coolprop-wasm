/**
 * Validation of @luisbedoia/coolprop-wasm against reference thermodynamic
 * tables from:
 *
 *   Cengel, Y. A., Boles, M. A., & Kanoglu, M. (2019).
 *   Thermodynamics: An Engineering Approach (9th ed., SI units).
 *   McGraw-Hill Education.
 *
 * Design notes
 * ------------
 *  - Pressure, temperature, specific volume and density are compared in
 *    absolute terms: they do not depend on the reference state chosen by
 *    each implementation.
 *  - Enthalpy, internal energy and entropy are compared USING DIFFERENCES
 *    between two states of the same fluid (e.g. h_fg = h_g - h_f, or
 *    Δh = h(T2) - h(T1) along an isobar). Differences are invariant to the
 *    reference state, so we can safely compare CoolProp (which uses the
 *    fluid-specific default reference, e.g. IAPWS-95 for water) against
 *    Cengel (which typically uses IIR for refrigerants and IAPWS for water)
 *    without dealing with constant offsets.
 *  - For water the IAPWS-IF97 / IAPWS-95 reference state matches Cengel,
 *    so absolute h and s comparisons are also reported for completeness.
 *
 * The script also runs a micro-benchmark of propsSI under Node.js and
 * reports the real CPU model, so the resulting numbers can be quoted
 * truthfully in the final report.
 *
 * Usage:  node --experimental-vm-modules tests/validation_cengel.mjs
 */

import path from 'path';
import os from 'os';
import { performance } from 'perf_hooks';
import { fileURLToPath, pathToFileURL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------------------------------------------------------------------------
// Reference data from Cengel et al. (2019), 9th ed. SI.
// Units: T in °C (or K where noted), P in kPa, v in m^3/kg,
//        h and u in kJ/kg, s in kJ/(kg·K).
// ---------------------------------------------------------------------------

// Table A-4: Saturated water by temperature.
const CENGEL_WATER_SAT_T = [
    // T_C, P_kPa,  v_f,         v_g,      h_f,     h_fg,    h_g,     s_f,     s_fg,    s_g
    [  25,   3.1698, 0.001003,  43.340,   104.83,  2442.3,  2547.2,  0.36722, 8.1895,  8.5567],
    [  50,  12.352,  0.001012,  12.026,   209.34,  2382.0,  2591.3,  0.70379, 7.3710,  8.0748],
    [  75,  38.595,  0.001026,   4.1291,  313.99,  2321.4,  2635.4,  1.01580, 6.6681,  7.6839],
    [ 100, 101.42,   0.001043,   1.6720,  419.17,  2256.4,  2675.6,  1.30720, 6.0470,  7.3542],
    [ 150, 476.16,   0.001091,   0.39248, 632.18,  2113.8,  2745.9,  1.84180, 4.9953,  6.8371],
    [ 200,1554.9,    0.001157,   0.12721, 852.26,  1939.8,  2792.0,  2.33050, 4.1014,  6.4302],
    [ 250,3976.2,    0.001252,   0.05013, 1085.8,  1715.2,  2800.9,  2.79350, 3.2802,  6.0737],
    [ 300,8587.9,    0.001404,   0.021659,1345.0,  1404.6,  2749.6,  3.25520, 2.4506,  5.7058],
];

// Table A-6: Superheated water. Rows: P_MPa, T_C, v, u, h, s.
// Values taken from Cengel et al. (2019) Table A-6, SI.
const CENGEL_WATER_SH = [
    [0.1, 150, 1.9367,  2582.9, 2776.5, 7.6148],
    [0.1, 200, 2.1723,  2658.2, 2875.4, 7.8356],
    [0.1, 400, 3.1027,  2968.3, 3278.6, 8.5452],
    [0.1, 600, 4.0279,  3302.2, 3705.6, 9.0988],
    [1.0, 200, 0.20602, 2622.3, 2828.3, 6.6956],
    [1.0, 300, 0.25799, 2793.7, 3051.6, 7.1246],
    [1.0, 400, 0.30661, 2957.3, 3263.9, 7.4670],
    [1.0, 500, 0.35411, 3121.8, 3478.5, 7.7642],
];

// Table A-17: Ideal-gas properties of air.
// Rows: T_K, h_kJkg, s0_kJkgK
const CENGEL_AIR_IG = [
    [ 250,  250.05, 1.51917],
    [ 300,  300.19, 1.70203],
    [ 400,  400.98, 1.99194],
    [ 500,  503.02, 2.21952],
    [ 600,  607.02, 2.40902],
    [ 800,  821.95, 2.71787],
    [1000, 1046.04, 2.96770],
];

// Table A-14: Saturated ammonia by temperature (IIR reference).
// Because the reference state differs from CoolProp's default, we compare
// only P_sat, v_f, v_g and the reference-invariant differences h_fg, s_fg.
// Rows: T_C, P_kPa, v_f, v_g, h_fg, s_fg
const CENGEL_NH3_SAT_T = [
    [-40,   71.77, 0.0014633, 1.5526,  1389.0, 5.9554],
    [-20,  190.22, 0.0015037, 0.62334, 1329.1, 5.2466],
    [  0,  429.45, 0.0015606, 0.28986, 1262.0, 4.6210],
    [ 20,  857.50, 0.0016363, 0.14923, 1186.0, 4.0465],
    [ 40, 1554.90, 0.0017408, 0.083101,1099.0, 3.5108],
];

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/**
 * Relative deviation in percent, handling the special case ref ≈ 0 by
 * falling back to absolute deviation (avoids infinities when comparing
 * reference-dependent zero points).
 */
function relDev(coolprop, reference) {
    if (Math.abs(reference) < 1e-12) {
        return (coolprop - reference) * 100;
    }
    return ((coolprop - reference) / reference) * 100;
}

function summary(deviations) {
    const abs = deviations.map((d) => Math.abs(d));
    const max = abs.reduce((a, b) => Math.max(a, b), 0);
    const mean = abs.reduce((a, b) => a + b, 0) / abs.length;
    return { max, mean, n: abs.length };
}

function fmt(n, d = 4) {
    return Number.isFinite(n) ? n.toFixed(d) : String(n);
}

function printTable(title, header, rows) {
    console.log(`\n### ${title}`);
    console.log(header.join(' | '));
    console.log(header.map(() => '---').join(' | '));
    for (const r of rows) {
        console.log(r.join(' | '));
    }
}

// ---------------------------------------------------------------------------
// Module loading
// ---------------------------------------------------------------------------

async function loadCoolProp() {
    const modulePath = path.resolve(__dirname, '..', 'wasm', 'coolprop.js');
    const moduleUrl = pathToFileURL(modulePath).href;
    const factoryModule = await import(moduleUrl);
    const createModule = factoryModule.default;
    if (typeof createModule !== 'function') {
        throw new Error('coolprop wasm factory not found');
    }
    const locateFile = (file) => path.resolve(__dirname, '..', 'wasm', file);
    return createModule({ locateFile });
}

// ---------------------------------------------------------------------------
// Validation cases
// ---------------------------------------------------------------------------

function validateWaterSaturation(cp) {
    const devP = [];
    const devVf = [];
    const devVg = [];
    const devHfg = [];   // difference-based
    const devSfg = [];   // difference-based
    const devHf = [];    // absolute (IAPWS ref matches Cengel)
    const devSf = [];    // absolute
    const detailRows = [];

    for (const row of CENGEL_WATER_SAT_T) {
        const [T_C, P_kPa, v_f, v_g, h_f, h_fg, h_g, s_f, s_fg, s_g] = row;
        const T = T_C + 273.15;

        const cpP   = cp.propsSI('P', 'T', T, 'Q', 0, 'Water') / 1000;          // kPa
        const cpVf  = cp.propsSI('D', 'T', T, 'Q', 0, 'Water');                  // kg/m3 -> v=1/D
        const cpVg  = cp.propsSI('D', 'T', T, 'Q', 1, 'Water');
        const cpHf  = cp.propsSI('H', 'T', T, 'Q', 0, 'Water') / 1000;           // kJ/kg
        const cpHg  = cp.propsSI('H', 'T', T, 'Q', 1, 'Water') / 1000;
        const cpSf  = cp.propsSI('S', 'T', T, 'Q', 0, 'Water') / 1000;           // kJ/kg.K
        const cpSg  = cp.propsSI('S', 'T', T, 'Q', 1, 'Water') / 1000;

        const cpVfVal = 1 / cpVf;
        const cpVgVal = 1 / cpVg;
        const cpHfgVal = cpHg - cpHf;
        const cpSfgVal = cpSg - cpSf;

        const dP   = relDev(cpP,   P_kPa);
        const dVf  = relDev(cpVfVal, v_f);
        const dVg  = relDev(cpVgVal, v_g);
        const dHfg = relDev(cpHfgVal, h_fg);
        const dSfg = relDev(cpSfgVal, s_fg);
        const dHf  = relDev(cpHf, h_f);
        const dSf  = relDev(cpSf, s_f);

        devP.push(dP); devVf.push(dVf); devVg.push(dVg);
        devHfg.push(dHfg); devSfg.push(dSfg);
        devHf.push(dHf); devSf.push(dSf);

        detailRows.push([
            `${T_C}°C`,
            fmt(cpP,  3), fmt(P_kPa,  3), fmt(dP,   3),
            fmt(cpHfgVal, 2), fmt(h_fg, 2), fmt(dHfg, 3),
            fmt(cpSfgVal, 4), fmt(s_fg, 4), fmt(dSfg, 3),
        ]);
    }

    printTable(
        'Water saturation — Cengel Tabla A-4 vs CoolProp',
        ['T', 'P_cp (kPa)', 'P_ref (kPa)', 'Δ% P',
         'h_fg_cp', 'h_fg_ref', 'Δ% h_fg',
         's_fg_cp', 's_fg_ref', 'Δ% s_fg'],
        detailRows,
    );

    return {
        'Water P_sat':    summary(devP),
        'Water v_f':      summary(devVf),
        'Water v_g':      summary(devVg),
        'Water h_fg (Δ)': summary(devHfg),
        'Water s_fg (Δ)': summary(devSfg),
        'Water h_f':      summary(devHf),
        'Water s_f':      summary(devSf),
    };
}

function validateWaterSuperheated(cp) {
    // For each isobar we pick the lowest-T row as the reference and compare
    // Δh and Δs between consecutive rows. v is compared absolutely.
    const devV = [];
    const devDH = [];
    const devDS = [];
    const detailRows = [];

    // Group rows by pressure
    const byP = new Map();
    for (const row of CENGEL_WATER_SH) {
        const key = row[0];
        if (!byP.has(key)) byP.set(key, []);
        byP.get(key).push(row);
    }

    for (const [P_MPa, rows] of byP.entries()) {
        const P = P_MPa * 1e6;
        const ref = rows[0];
        const T_ref = ref[1] + 273.15;
        const cpHRef = cp.propsSI('H', 'P', P, 'T', T_ref, 'Water') / 1000;
        const cpSRef = cp.propsSI('S', 'P', P, 'T', T_ref, 'Water') / 1000;

        for (const row of rows) {
            const [_, T_C, v_ref, u_ref, h_ref, s_ref] = row;
            const T = T_C + 273.15;
            const cpD = cp.propsSI('D', 'P', P, 'T', T, 'Water');
            const cpV = 1 / cpD;
            const cpH = cp.propsSI('H', 'P', P, 'T', T, 'Water') / 1000;
            const cpS = cp.propsSI('S', 'P', P, 'T', T, 'Water') / 1000;

            const dhCp = cpH - cpHRef;
            const dsCp = cpS - cpSRef;
            const dhRef = h_ref - ref[4];
            const dsRef = s_ref - ref[5];

            const dV = relDev(cpV, v_ref);
            const dDH = dhRef === 0 ? 0 : relDev(dhCp, dhRef);
            const dDS = dsRef === 0 ? 0 : relDev(dsCp, dsRef);

            devV.push(dV);
            if (dhRef !== 0) devDH.push(dDH);
            if (dsRef !== 0) devDS.push(dDS);

            detailRows.push([
                `${P_MPa} MPa, ${T_C}°C`,
                fmt(cpV, 5), fmt(v_ref, 5), fmt(dV, 3),
                fmt(dhCp, 2), fmt(dhRef, 2), fmt(dDH, 3),
                fmt(dsCp, 4), fmt(dsRef, 4), fmt(dDS, 3),
            ]);
        }
    }

    printTable(
        'Water superheated — Cengel Tabla A-6 vs CoolProp (h, s comparadas por diferencias)',
        ['Estado', 'v_cp', 'v_ref', 'Δ% v',
         'Δh_cp', 'Δh_ref', 'Δ% Δh',
         'Δs_cp', 'Δs_ref', 'Δ% Δs'],
        detailRows,
    );

    return {
        'Water v (sh)':  summary(devV),
        'Water Δh (sh)': summary(devDH),
        'Water Δs (sh)': summary(devDS),
    };
}

function validateAirIdealGas(cp) {
    // CoolProp's Air backend uses Lemmon's mixture EOS (real gas). At low
    // pressure the behaviour approaches ideal gas; we compare differences
    // at P = 101.325 kPa against Cengel's ideal-gas Table A-17.
    const P = 101325;
    const ref = CENGEL_AIR_IG[0];
    const T_ref = ref[0];
    const cpHRef = cp.propsSI('H', 'T', T_ref, 'P', P, 'Air') / 1000;
    // For s°(T) Cengel uses the "T-only" part at 1 atm basis; CoolProp
    // entropy at a given (T, P) includes the -R ln(P/Pref) term. Since we
    // compare at the SAME pressure for every row, the pressure term cancels
    // when we take Δs.
    const cpSRef = cp.propsSI('S', 'T', T_ref, 'P', P, 'Air') / 1000;

    const devDH = [];
    const devDS = [];
    const detailRows = [];

    for (const [T_K, h_ref, s0_ref] of CENGEL_AIR_IG) {
        const cpH = cp.propsSI('H', 'T', T_K, 'P', P, 'Air') / 1000;
        const cpS = cp.propsSI('S', 'T', T_K, 'P', P, 'Air') / 1000;
        const dhCp = cpH - cpHRef;
        const dsCp = cpS - cpSRef;
        const dhRef = h_ref - ref[1];
        const dsRef = s0_ref - ref[2];

        const dDH = dhRef === 0 ? 0 : relDev(dhCp, dhRef);
        const dDS = dsRef === 0 ? 0 : relDev(dsCp, dsRef);

        if (dhRef !== 0) devDH.push(dDH);
        if (dsRef !== 0) devDS.push(dDS);

        detailRows.push([
            `${T_K} K`,
            fmt(dhCp, 3), fmt(dhRef, 3), fmt(dDH, 3),
            fmt(dsCp, 5), fmt(dsRef, 5), fmt(dDS, 3),
        ]);
    }

    printTable(
        'Air ideal gas — Cengel Tabla A-17 vs CoolProp a 101,325 kPa (diferencias)',
        ['T', 'Δh_cp', 'Δh_ref', 'Δ% Δh', 'Δs_cp', 'Δs_ref', 'Δ% Δs°'],
        detailRows,
    );

    return {
        'Air Δh (IG)':  summary(devDH),
        'Air Δs (IG)':  summary(devDS),
    };
}

function validateAmmoniaSaturation(cp) {
    const devP = [];
    const devVf = [];
    const devVg = [];
    const devHfg = [];
    const devSfg = [];
    const detailRows = [];

    for (const [T_C, P_kPa, v_f, v_g, h_fg, s_fg] of CENGEL_NH3_SAT_T) {
        const T = T_C + 273.15;
        const cpP = cp.propsSI('P', 'T', T, 'Q', 0, 'Ammonia') / 1000;
        const cpDf = cp.propsSI('D', 'T', T, 'Q', 0, 'Ammonia');
        const cpDg = cp.propsSI('D', 'T', T, 'Q', 1, 'Ammonia');
        const cpHf = cp.propsSI('H', 'T', T, 'Q', 0, 'Ammonia') / 1000;
        const cpHg = cp.propsSI('H', 'T', T, 'Q', 1, 'Ammonia') / 1000;
        const cpSf = cp.propsSI('S', 'T', T, 'Q', 0, 'Ammonia') / 1000;
        const cpSg = cp.propsSI('S', 'T', T, 'Q', 1, 'Ammonia') / 1000;

        const cpVf = 1 / cpDf;
        const cpVg = 1 / cpDg;
        const cpHfg = cpHg - cpHf;
        const cpSfg = cpSg - cpSf;

        const dP = relDev(cpP, P_kPa);
        const dVf = relDev(cpVf, v_f);
        const dVg = relDev(cpVg, v_g);
        const dHfg = relDev(cpHfg, h_fg);
        const dSfg = relDev(cpSfg, s_fg);

        devP.push(dP); devVf.push(dVf); devVg.push(dVg);
        devHfg.push(dHfg); devSfg.push(dSfg);

        detailRows.push([
            `${T_C}°C`,
            fmt(cpP, 3), fmt(P_kPa, 3), fmt(dP, 3),
            fmt(cpHfg, 2), fmt(h_fg, 2), fmt(dHfg, 3),
            fmt(cpSfg, 4), fmt(s_fg, 4), fmt(dSfg, 3),
        ]);
    }

    printTable(
        'Ammonia saturation — Cengel Tabla A-14 vs CoolProp (h, s por diferencias)',
        ['T', 'P_cp (kPa)', 'P_ref (kPa)', 'Δ% P',
         'h_fg_cp', 'h_fg_ref', 'Δ% h_fg',
         's_fg_cp', 's_fg_ref', 'Δ% s_fg'],
        detailRows,
    );

    return {
        'NH3 P_sat':    summary(devP),
        'NH3 v_f':      summary(devVf),
        'NH3 v_g':      summary(devVg),
        'NH3 h_fg (Δ)': summary(devHfg),
        'NH3 s_fg (Δ)': summary(devSfg),
    };
}

// ---------------------------------------------------------------------------
// Benchmark
// ---------------------------------------------------------------------------

function benchmarkPropsSI(cp) {
    // Warm up
    for (let i = 0; i < 100; i++) cp.propsSI('H', 'T', 500, 'P', 1e6, 'Water');

    const N = 10000;
    const P = 1e6;

    const t0 = performance.now();
    for (let i = 0; i < N; i++) {
        const T = 500 + (i % 200);
        cp.propsSI('H', 'T', T, 'P', P, 'Water');
    }
    const t1 = performance.now();

    const totalMs = t1 - t0;
    const perCallMs = totalMs / N;
    const callsPerSec = 1000 / perCallMs;

    return { N, totalMs, perCallMs, callsPerSec };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

(async () => {
    const cp = await loadCoolProp();
    const version = cp.getGlobalParamString('version');
    const gitrev  = cp.getGlobalParamString('gitrevision');

    console.log('# Validation of @luisbedoia/coolprop-wasm against Cengel (2019)');
    console.log(`CoolProp version: ${version}`);
    console.log(`CoolProp gitrevision: ${gitrev}`);
    console.log(`Node: ${process.version}  Arch: ${process.arch}  Platform: ${process.platform}`);
    const cpus = os.cpus();
    const cpuModel = cpus[0] && cpus[0].model && cpus[0].model !== 'unknown'
        ? cpus[0].model
        : '(model not exposed by kernel; running in a sandboxed container)';
    console.log(`CPU: ${cpuModel}  (${cpus.length} logical cores)`);
    console.log(`Total RAM: ${(os.totalmem() / 1e9).toFixed(1)} GB`);

    const all = {};
    Object.assign(all, validateWaterSaturation(cp));
    Object.assign(all, validateWaterSuperheated(cp));
    Object.assign(all, validateAirIdealGas(cp));
    Object.assign(all, validateAmmoniaSaturation(cp));

    console.log('\n## Resumen de desviaciones relativas (|Δ|%)');
    console.log('Métrica | máx % | media % | n');
    console.log('--- | --- | --- | ---');
    for (const [key, s] of Object.entries(all)) {
        console.log(`${key} | ${s.max.toFixed(3)} | ${s.mean.toFixed(3)} | ${s.n}`);
    }

    console.log('\n## Benchmark propsSI');
    const b = benchmarkPropsSI(cp);
    console.log(`N = ${b.N} llamadas (Water, H de (T, P))`);
    console.log(`tiempo total: ${b.totalMs.toFixed(1)} ms`);
    console.log(`tiempo medio por llamada: ${b.perCallMs.toFixed(4)} ms`);
    console.log(`throughput: ${b.callsPerSec.toFixed(0)} llamadas/s`);
})().catch((err) => {
    console.error(err);
    process.exit(1);
});
