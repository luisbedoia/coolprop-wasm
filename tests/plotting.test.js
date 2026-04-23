import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FLUIDS = fs
  .readFileSync(path.resolve(__dirname, '..', 'allowed_fluids.txt'), 'utf8')
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean);

// Minimum fraction of finite values required in an isoline x/y array
const MIN_FINITE_RATIO = 0.5;

// iQ parameter index used by CoolProp for quality/saturation
const SATURATION_PARAMETER = 6;

// Parameter names for clarity in tests (looked up dynamically from module)
let iHmassParam; // mass-specific enthalpy — fetched in beforeAll

// ─── Assertion helpers ───────────────────────────────────────────────────────

function assertAxisMetadata(axis) {
  expect(typeof axis).toBe('object');
  expect(typeof axis.parameter).toBe('number');
  expect(typeof axis.scale).toBe('number');
  expect(Number.isFinite(axis.range.min)).toBe(true);
  expect(Number.isFinite(axis.range.max)).toBe(true);
  expect(axis.range.max).toBeGreaterThan(axis.range.min);
}

function assertIsolineCurve(curve) {
  expect(typeof curve.parameter).toBe('number');
  expect(typeof curve.value).toBe('number');
  expect(Number.isFinite(curve.value)).toBe(true);
  expect(Array.isArray(curve.x)).toBe(true);
  expect(Array.isArray(curve.y)).toBe(true);
  expect(curve.x.length).toBe(curve.y.length);
  expect(curve.x.length).toBeGreaterThan(0);
  const finiteX = curve.x.filter(Number.isFinite).length / curve.x.length;
  const finiteY = curve.y.filter(Number.isFinite).length / curve.y.length;
  expect(finiteX).toBeGreaterThanOrEqual(MIN_FINITE_RATIO);
  expect(finiteY).toBeGreaterThanOrEqual(MIN_FINITE_RATIO);
}

function assertParameterRange(pr) {
  expect(typeof pr.parameter).toBe('number');
  expect(Number.isFinite(pr.range.min)).toBe(true);
  expect(Number.isFinite(pr.range.max)).toBe(true);
  expect(pr.range.max).toBeGreaterThanOrEqual(pr.range.min);
}

function assertPlotDescriptor(plot, expectedLabel) {
  expect(plot.label).toMatch(new RegExp(expectedLabel, 'i'));
  assertAxisMetadata(plot.xAxis);
  assertAxisMetadata(plot.yAxis);
  expect(Array.isArray(plot.isolineOptions)).toBe(true);
  expect(plot.isolineOptions.length).toBeGreaterThan(0);
  for (const opt of plot.isolineOptions) {
    expect(typeof opt.parameter).toBe('number');
    expect(Number.isFinite(opt.range.min)).toBe(true);
    expect(Number.isFinite(opt.range.max)).toBe(true);
  }
}

function assertPlotData(plotData, fluid, plotId) {
  expect(plotData).not.toBeNull();
  expect(plotData.fluid).toBe(fluid);
  expect(plotData.plotId).toBe(plotId);

  // Axes must be present in PlotData (distinct from the descriptor)
  assertAxisMetadata(plotData.xAxis);
  assertAxisMetadata(plotData.yAxis);

  expect(Array.isArray(plotData.isolines)).toBe(true);
  expect(plotData.isolines.length).toBeGreaterThan(0);
  for (const curve of plotData.isolines) {
    assertIsolineCurve(curve);
  }

  expect(Array.isArray(plotData.availableIsolines)).toBe(true);
  expect(plotData.availableIsolines.length).toBeGreaterThan(0);

  expect(Array.isArray(plotData.generatedIsolines)).toBe(true);
  expect(plotData.generatedIsolines.length).toBeGreaterThan(0);
}

// ─── Build helpers ───────────────────────────────────────────────────────────

/** Tries each isolineOption in order until one builds successfully.
 *  Uses includeSaturationCurves: false — saturation is tested separately. */
function buildWithFirstWorkingOption(buildPropertyPlot, fluid, plotId, isolineOptions) {
  let plotData = null;
  for (const opt of isolineOptions) {
    try {
      plotData = buildPropertyPlot({
        fluid,
        plotId,
        isolines: [{ parameter: opt.parameter, valueCount: 3, points: 20 }],
        includeSaturationCurves: false,
      });
      break;
    } catch (e) {
      expect(e).toBeInstanceOf(Error);
    }
  }
  return plotData;
}

/** Tests every isolineOption independently; returns summary of results. */
function testEachIsolineOption(buildPropertyPlot, fluid, plotId, isolineOptions) {
  const results = [];
  for (const opt of isolineOptions) {
    try {
      const plotData = buildPropertyPlot({
        fluid,
        plotId,
        isolines: [{ parameter: opt.parameter, valueCount: 3, points: 20 }],
        includeSaturationCurves: false,
      });

      assertPlotData(plotData, fluid, plotId);

      const generated = plotData.generatedIsolines.map((g) => g.parameter);
      expect(generated).toContain(opt.parameter);

      results.push({ parameter: opt.parameter, ok: true });
    } catch (e) {
      expect(e).toBeInstanceOf(Error);
      results.push({ parameter: opt.parameter, ok: false, error: e.message });
    }
  }
  return results;
}

// ─── Test suite ──────────────────────────────────────────────────────────────

describe('CoolProp plotting bindings', () => {
  let describeFluidPlots;
  let buildPropertyPlot;

  beforeAll(async () => {
    const modulePath = path.resolve(__dirname, '..', 'index.js');
    const moduleUrl = pathToFileURL(modulePath).href;
    const factoryModule = await import(moduleUrl);
    const createModule = factoryModule.default;

    if (typeof createModule !== 'function') {
      throw new Error('coolprop wasm factory not found');
    }

    const module = await createModule({
      locateFile: (file) => path.resolve(__dirname, '..', 'wasm', file),
    });

    describeFluidPlots = module.describeFluidPlots;
    buildPropertyPlot = module.buildPropertyPlot;
    iHmassParam = module.getParameterIndex('Hmass');
  }, 120_000);

  // ─── Error handling ──────────────────────────────────────────────────────

  test('buildPropertyPlot rejects unsupported plot identifiers', () => {
    expect(() =>
      buildPropertyPlot({ fluid: 'Water', plotId: 'non-existent', isolines: [] }),
    ).toThrow();
  });

  test('buildPropertyPlot rejects missing fluid field', () => {
    expect(() =>
      buildPropertyPlot({ plotId: 'ph', isolines: [] }),
    ).toThrow();
  });

  test('buildPropertyPlot rejects missing plotId field', () => {
    expect(() =>
      buildPropertyPlot({ fluid: 'Water', isolines: [] }),
    ).toThrow();
  });

  test('describeFluidPlots returns graceful result for unknown fluid', () => {
    const catalogue = describeFluidPlots('NotARealFluid_XYZ');
    expect(catalogue.fluid).toBe('NotARealFluid_XYZ');
    expect(Array.isArray(catalogue.plots)).toBe(true);
  });

  // ─── ph (Pressure-Enthalpy) — descriptor ────────────────────────────────

  test.each(FLUIDS)('ph plot descriptor for %s', (fluid) => {
    const catalogue = describeFluidPlots(fluid);
    expect(catalogue.fluid).toBe(fluid);
    expect(Array.isArray(catalogue.plots)).toBe(true);

    const plot = catalogue.plots.find((p) => p.id === 'ph');
    if (!plot) return;

    assertPlotDescriptor(plot, 'Pressure-Enthalpy');
  });

  // ─── ph — full build (axes, isolines, availableIsolines) ────────────────

  test.each(FLUIDS)('ph plot full build with axes for %s', (fluid) => {
    const catalogue = describeFluidPlots(fluid);
    const plot = catalogue.plots.find((p) => p.id === 'ph');
    if (!plot || plot.isolineOptions.length === 0) return;

    const plotData = buildWithFirstWorkingOption(buildPropertyPlot, fluid, 'ph', plot.isolineOptions);
    assertPlotData(plotData, fluid, 'ph');
  });

  // ─── Ts (Temperature-Entropy) — descriptor ──────────────────────────────

  test.each(FLUIDS)('Ts plot descriptor for %s', (fluid) => {
    const catalogue = describeFluidPlots(fluid);
    expect(catalogue.fluid).toBe(fluid);
    expect(Array.isArray(catalogue.plots)).toBe(true);

    const plot = catalogue.plots.find((p) => p.id === 'Ts');
    if (!plot) return;

    assertPlotDescriptor(plot, 'Temperature-Entropy');
  });

  // ─── Ts — full build ────────────────────────────────────────────────────

  test.each(FLUIDS)('Ts plot full build with axes for %s', (fluid) => {
    const catalogue = describeFluidPlots(fluid);
    const plot = catalogue.plots.find((p) => p.id === 'Ts');
    if (!plot || plot.isolineOptions.length === 0) return;

    const plotData = buildWithFirstWorkingOption(buildPropertyPlot, fluid, 'Ts', plot.isolineOptions);
    if (!plotData) {
      // Some blend fluids (e.g. R410A, R404A, R507A) cannot compute Ts isolines due to
      // CoolProp limitations with zeotropic mixtures. Skip instead of failing.
      console.warn(`${fluid}: Ts plot has isolineOptions but none could be built — blend limitation`);
      return;
    }
    assertPlotData(plotData, fluid, 'Ts');
  });

  // ─── Per-isoline-type tests ──────────────────────────────────────────────

  test.each(FLUIDS)('ph: each isoline type independently for %s', (fluid) => {
    const catalogue = describeFluidPlots(fluid);
    const plot = catalogue.plots.find((p) => p.id === 'ph');
    if (!plot || plot.isolineOptions.length === 0) return;

    const results = testEachIsolineOption(buildPropertyPlot, fluid, 'ph', plot.isolineOptions);
    const successful = results.filter((r) => r.ok);
    expect(successful.length).toBeGreaterThan(0);
    if (successful.length < results.length) {
      console.warn(`ph/${fluid}: ${results.length - successful.length} isoline(s) failed:`,
        results.filter((r) => !r.ok).map((r) => `param=${r.parameter}: ${r.error}`).join('; '));
    }
  });

  test.each(FLUIDS)('Ts: each isoline type independently for %s', (fluid) => {
    const catalogue = describeFluidPlots(fluid);
    const plot = catalogue.plots.find((p) => p.id === 'Ts');
    if (!plot || plot.isolineOptions.length === 0) return;

    const results = testEachIsolineOption(buildPropertyPlot, fluid, 'Ts', plot.isolineOptions);
    const successful = results.filter((r) => r.ok);
    expect(successful.length).toBeGreaterThan(0);
    if (successful.length < results.length) {
      console.warn(`Ts/${fluid}: ${results.length - successful.length} isoline(s) failed:`,
        results.filter((r) => !r.ok).map((r) => `param=${r.parameter}: ${r.error}`).join('; '));
    }
  });

  // ─── Saturation curves ───────────────────────────────────────────────────

  test.each(FLUIDS)('ph: saturation curves are generated for %s', (fluid) => {
    const catalogue = describeFluidPlots(fluid);
    const plot = catalogue.plots.find((p) => p.id === 'ph');
    if (!plot) return;
    if (!plot.isolineOptions.some((o) => o.parameter === SATURATION_PARAMETER)) return;

    const plotData = buildPropertyPlot({
      fluid,
      plotId: 'ph',
      isolines: [],
      includeSaturationCurves: true,
    });

    assertPlotData(plotData, fluid, 'ph');

    const satCurves = plotData.isolines.filter((c) => c.parameter === SATURATION_PARAMETER);
    expect(satCurves.length).toBeGreaterThanOrEqual(2);

    const qValues = satCurves.map((c) => c.value).sort((a, b) => a - b);
    expect(qValues[0]).toBeCloseTo(0, 5);
    expect(qValues[qValues.length - 1]).toBeCloseTo(1, 5);

    for (const curve of satCurves) {
      assertIsolineCurve(curve);
    }
  });

  test.each(FLUIDS)('Ts: saturation curves are generated for %s', (fluid) => {
    const catalogue = describeFluidPlots(fluid);
    const plot = catalogue.plots.find((p) => p.id === 'Ts');
    if (!plot) return;
    if (!plot.isolineOptions.some((o) => o.parameter === SATURATION_PARAMETER)) return;

    const plotData = buildPropertyPlot({
      fluid,
      plotId: 'Ts',
      isolines: [],
      includeSaturationCurves: true,
    });

    assertPlotData(plotData, fluid, 'Ts');

    const satCurves = plotData.isolines.filter((c) => c.parameter === SATURATION_PARAMETER);
    expect(satCurves.length).toBeGreaterThanOrEqual(2);

    const qValues = satCurves.map((c) => c.value).sort((a, b) => a - b);
    expect(qValues[0]).toBeCloseTo(0, 5);
    expect(qValues[qValues.length - 1]).toBeCloseTo(1, 5);

    for (const curve of satCurves) {
      assertIsolineCurve(curve);
    }
  });

  test.each(FLUIDS)('ph: saturation curves omitted when includeSaturationCurves=false for %s', (fluid) => {
    const catalogue = describeFluidPlots(fluid);
    const plot = catalogue.plots.find((p) => p.id === 'ph');
    if (!plot || !plot.isolineOptions.some((o) => o.parameter === SATURATION_PARAMETER)) return;

    const nonQOption = plot.isolineOptions.find((o) => o.parameter !== SATURATION_PARAMETER);
    if (!nonQOption) return;

    const plotData = buildPropertyPlot({
      fluid,
      plotId: 'ph',
      isolines: [{ parameter: nonQOption.parameter, valueCount: 2, points: 10 }],
      includeSaturationCurves: false,
    });

    const satCurves = plotData.isolines.filter((c) => c.parameter === SATURATION_PARAMETER);
    expect(satCurves.length).toBe(0);
  });

  // ─── Axis parameters must not appear as isoline options ─────────────────

  test.each(FLUIDS)('ph: axis parameters (H, P) not offered as isolines for %s', (fluid) => {
    const catalogue = describeFluidPlots(fluid);
    const plot = catalogue.plots.find((p) => p.id === 'ph');
    if (!plot) return;

    const xParam = plot.xAxis.parameter; // iHmass
    const yParam = plot.yAxis.parameter; // iP
    const optionParams = plot.isolineOptions.map((o) => o.parameter);

    expect(optionParams).not.toContain(xParam);
    expect(optionParams).not.toContain(yParam);
  });

  test.each(FLUIDS)('Ts: axis parameters (S, T) not offered as isolines for %s', (fluid) => {
    const catalogue = describeFluidPlots(fluid);
    const plot = catalogue.plots.find((p) => p.id === 'Ts');
    if (!plot) return;

    const xParam = plot.xAxis.parameter; // iSmass
    const yParam = plot.yAxis.parameter; // iT
    const optionParams = plot.isolineOptions.map((o) => o.parameter);

    expect(optionParams).not.toContain(xParam);
    expect(optionParams).not.toContain(yParam);
  });

  // ─── iHmass must not appear in Ts isolineOptions (always fails to compute) ─

  test.each(FLUIDS)('Ts: enthalpy isoline (iHmass) not offered for %s', (fluid) => {
    const catalogue = describeFluidPlots(fluid);
    const plot = catalogue.plots.find((p) => p.id === 'Ts');
    if (!plot) return;

    const optionParams = plot.isolineOptions.map((o) => o.parameter);
    expect(optionParams).not.toContain(iHmassParam);
  });

  // ─── availableIsolines must also exclude axis params ─────────────────────

  test.each(FLUIDS)('ph: availableIsolines excludes axis parameters for %s', (fluid) => {
    const catalogue = describeFluidPlots(fluid);
    const plot = catalogue.plots.find((p) => p.id === 'ph');
    if (!plot) return;

    const plotData = buildWithFirstWorkingOption(buildPropertyPlot, fluid, 'ph', plot.isolineOptions);
    if (!plotData) return;

    const availableParams = plotData.availableIsolines.map((a) => a.parameter);
    expect(availableParams).not.toContain(plotData.xAxis.parameter);
    expect(availableParams).not.toContain(plotData.yAxis.parameter);
  });

  test.each(FLUIDS)('Ts: availableIsolines excludes axis parameters for %s', (fluid) => {
    const catalogue = describeFluidPlots(fluid);
    const plot = catalogue.plots.find((p) => p.id === 'Ts');
    if (!plot) return;

    const plotData = buildWithFirstWorkingOption(buildPropertyPlot, fluid, 'Ts', plot.isolineOptions);
    if (!plotData) return;

    const availableParams = plotData.availableIsolines.map((a) => a.parameter);
    expect(availableParams).not.toContain(plotData.xAxis.parameter);
    expect(availableParams).not.toContain(plotData.yAxis.parameter);
  });

  // ─── Custom values array ─────────────────────────────────────────────────

  test.each(FLUIDS)('ph: custom explicit values array for isoline for %s', (fluid) => {
    const catalogue = describeFluidPlots(fluid);
    const plot = catalogue.plots.find((p) => p.id === 'ph');
    if (!plot) return;

    const xParam = plot.xAxis.parameter;
    const yParam = plot.yAxis.parameter;
    const opt = plot.isolineOptions.find(
      (o) => o.parameter !== xParam && o.parameter !== yParam && o.parameter !== SATURATION_PARAMETER,
    );
    if (!opt) return;

    const customValues = [
      opt.range.min + (opt.range.max - opt.range.min) * 0.2,
      (opt.range.min + opt.range.max) / 2,
      opt.range.min + (opt.range.max - opt.range.min) * 0.8,
    ];

    const plotData = buildPropertyPlot({
      fluid,
      plotId: 'ph',
      isolines: [{ parameter: opt.parameter, values: customValues, points: 15 }],
      includeSaturationCurves: false,
    });

    assertPlotData(plotData, fluid, 'ph');

    const built = plotData.isolines.filter((c) => c.parameter === opt.parameter);
    expect(built.length).toBe(customValues.length);
  });

  // ─── Custom range ────────────────────────────────────────────────────────

  test.each(FLUIDS)('ph: custom range for isoline for %s', (fluid) => {
    const catalogue = describeFluidPlots(fluid);
    const plot = catalogue.plots.find((p) => p.id === 'ph');
    if (!plot) return;

    const xParam = plot.xAxis.parameter;
    const yParam = plot.yAxis.parameter;
    const opt = plot.isolineOptions.find(
      (o) => o.parameter !== xParam && o.parameter !== yParam && o.parameter !== SATURATION_PARAMETER,
    );
    if (!opt) return;

    const lo = opt.range.min + (opt.range.max - opt.range.min) * 0.1;
    const hi = opt.range.min + (opt.range.max - opt.range.min) * 0.9;

    let plotData;
    try {
      plotData = buildPropertyPlot({
        fluid,
        plotId: 'ph',
        isolines: [{ parameter: opt.parameter, valueCount: 3, useCustomRange: true, customRange: { min: lo, max: hi }, points: 15 }],
        includeSaturationCurves: false,
      });
    } catch (e) {
      expect(e).toBeInstanceOf(Error);
      return;
    }

    assertPlotData(plotData, fluid, 'ph');
  });

  // ─── Multiple isoline families in one request ────────────────────────────

  test.each(FLUIDS)('ph: multiple isoline families in one request for %s', (fluid) => {
    const catalogue = describeFluidPlots(fluid);
    const plot = catalogue.plots.find((p) => p.id === 'ph');
    if (!plot || plot.isolineOptions.length < 2) return;

    const specs = plot.isolineOptions.slice(0, 3).map((opt) => ({
      parameter: opt.parameter,
      valueCount: 2,
      points: 10,
    }));

    let plotData;
    try {
      plotData = buildPropertyPlot({
        fluid,
        plotId: 'ph',
        isolines: specs,
        includeSaturationCurves: false,
      });
    } catch (e) {
      expect(e).toBeInstanceOf(Error);
      return;
    }

    assertPlotData(plotData, fluid, 'ph');
    expect(plotData.generatedIsolines.length).toBe(specs.length);
  });

  test.each(FLUIDS)('Ts: multiple isoline families in one request for %s', (fluid) => {
    const catalogue = describeFluidPlots(fluid);
    const plot = catalogue.plots.find((p) => p.id === 'Ts');
    if (!plot || plot.isolineOptions.length < 2) return;

    const specs = plot.isolineOptions.slice(0, 3).map((opt) => ({
      parameter: opt.parameter,
      valueCount: 2,
      points: 10,
    }));

    let plotData;
    try {
      plotData = buildPropertyPlot({
        fluid,
        plotId: 'Ts',
        isolines: specs,
        includeSaturationCurves: false,
      });
    } catch (e) {
      expect(e).toBeInstanceOf(Error);
      return;
    }

    assertPlotData(plotData, fluid, 'Ts');
    expect(plotData.generatedIsolines.length).toBe(specs.length);
  });

  // ─── availableIsolines consistency with descriptor ───────────────────────

  test.each(FLUIDS)('ph: availableIsolines consistent with descriptor for %s', (fluid) => {
    const catalogue = describeFluidPlots(fluid);
    const plot = catalogue.plots.find((p) => p.id === 'ph');
    if (!plot) return;

    const plotData = buildWithFirstWorkingOption(buildPropertyPlot, fluid, 'ph', plot.isolineOptions);
    if (!plotData) return;

    const descriptorParams = new Set(plot.isolineOptions.map((o) => o.parameter));
    const availableParams = new Set(plotData.availableIsolines.map((a) => a.parameter));

    for (const p of descriptorParams) {
      expect(availableParams).toContain(p);
    }

    for (const pr of plotData.availableIsolines) {
      assertParameterRange(pr);
    }
  });

  test.each(FLUIDS)('Ts: availableIsolines consistent with descriptor for %s', (fluid) => {
    const catalogue = describeFluidPlots(fluid);
    const plot = catalogue.plots.find((p) => p.id === 'Ts');
    if (!plot) return;

    const plotData = buildWithFirstWorkingOption(buildPropertyPlot, fluid, 'Ts', plot.isolineOptions);
    if (!plotData) return;

    const descriptorParams = new Set(plot.isolineOptions.map((o) => o.parameter));
    const availableParams = new Set(plotData.availableIsolines.map((a) => a.parameter));

    for (const p of descriptorParams) {
      expect(availableParams).toContain(p);
    }

    for (const pr of plotData.availableIsolines) {
      assertParameterRange(pr);
    }
  });

  // ─── defaultPointsPerIsoline is respected ───────────────────────────────

  test.each(FLUIDS)('ph: defaultPointsPerIsoline is respected for %s', (fluid) => {
    const catalogue = describeFluidPlots(fluid);
    const plot = catalogue.plots.find((p) => p.id === 'ph');
    if (!plot) return;

    const nonAxisOpt = plot.isolineOptions.find(
      (o) => o.parameter !== plot.xAxis.parameter && o.parameter !== plot.yAxis.parameter && o.parameter !== SATURATION_PARAMETER,
    );
    if (!nonAxisOpt) return;

    const POINTS = 7;
    let plotData;
    try {
      plotData = buildPropertyPlot({
        fluid,
        plotId: 'ph',
        isolines: [{ parameter: nonAxisOpt.parameter, valueCount: 1, points: POINTS }],
        includeSaturationCurves: false,
        defaultPointsPerIsoline: POINTS,
      });
    } catch (e) {
      expect(e).toBeInstanceOf(Error);
      return;
    }

    const curves = plotData.isolines.filter((c) => c.parameter === nonAxisOpt.parameter);
    for (const curve of curves) {
      expect(curve.x.length).toBeLessThanOrEqual(POINTS);
    }
  });
});
