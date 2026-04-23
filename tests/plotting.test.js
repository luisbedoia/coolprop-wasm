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

/** Validates a PlotTypeDescriptor has valid axes and at least one isoline option. */
function assertPlotDescriptor(plot, expectedLabel) {
  expect(plot.label).toMatch(new RegExp(expectedLabel, 'i'));
  for (const axis of [plot.xAxis, plot.yAxis]) {
    expect(typeof axis.parameter).toBe('number');
    expect(typeof axis.scale).toBe('number');
    expect(Number.isFinite(axis.range.min)).toBe(true);
    expect(Number.isFinite(axis.range.max)).toBe(true);
    expect(axis.range.max).toBeGreaterThan(axis.range.min);
  }
  expect(Array.isArray(plot.isolineOptions)).toBe(true);
  expect(plot.isolineOptions.length).toBeGreaterThan(0);
  for (const opt of plot.isolineOptions) {
    expect(typeof opt.parameter).toBe('number');
    expect(Number.isFinite(opt.range.min)).toBe(true);
    expect(Number.isFinite(opt.range.max)).toBe(true);
  }
}

/** Tries each isolineOption in order until one builds successfully.
 *  Failed options must throw a proper Error, never a numeric WASM trap. */
function buildWithFirstWorkingOption(buildPropertyPlot, fluid, plotId, isolineOptions) {
  let plotData = null;
  for (const opt of isolineOptions) {
    try {
      plotData = buildPropertyPlot({
        fluid,
        plotId,
        isolines: [{ parameter: opt.parameter, valueCount: 3, points: 20 }],
        includeSaturationCurves: true,
      });
      break;
    } catch (e) {
      expect(e).toBeInstanceOf(Error);
    }
  }
  return plotData;
}

/** Validates a PlotData object returned by buildPropertyPlot. */
function assertPlotData(plotData, fluid, plotId) {
  expect(plotData).not.toBeNull();
  expect(plotData.fluid).toBe(fluid);
  expect(plotData.plotId).toBe(plotId);

  expect(Array.isArray(plotData.isolines)).toBe(true);
  expect(plotData.isolines.length).toBeGreaterThan(0);

  for (const curve of plotData.isolines) {
    expect(typeof curve.parameter).toBe('number');
    expect(typeof curve.value).toBe('number');
    expect(Array.isArray(curve.x)).toBe(true);
    expect(Array.isArray(curve.y)).toBe(true);
    expect(curve.x.length).toBe(curve.y.length);
    expect(curve.x.length).toBeGreaterThan(0);
    expect(curve.x.some(Number.isFinite)).toBe(true);
    expect(curve.y.some(Number.isFinite)).toBe(true);
  }

  expect(Array.isArray(plotData.availableIsolines)).toBe(true);
  expect(plotData.availableIsolines.length).toBeGreaterThan(0);
  expect(Array.isArray(plotData.generatedIsolines)).toBe(true);
  expect(plotData.generatedIsolines.length).toBeGreaterThan(0);
}

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
  }, 120_000);

  test('buildPropertyPlot rejects unsupported plot identifiers', () => {
    expect(() =>
      buildPropertyPlot({ fluid: 'Water', plotId: 'non-existent', isolines: [] }),
    ).toThrow();
  });

  // ─── ph (Pressure-Enthalpy) ──────────────────────────────────────────────

  test.each(FLUIDS)('ph plot describe and build for %s', (fluid) => {
    const catalogue = describeFluidPlots(fluid);

    expect(catalogue).toBeTruthy();
    expect(catalogue.fluid).toBe(fluid);
    expect(Array.isArray(catalogue.plots)).toBe(true);

    const plot = catalogue.plots.find((p) => p.id === 'ph');

    if (!plot) {
      console.log(`  ${fluid.padEnd(16)} ph: not available`);
      return;
    }

    console.log(`  ${fluid.padEnd(16)} ph: available`);
    assertPlotDescriptor(plot, 'Pressure-Enthalpy');
    assertPlotData(buildWithFirstWorkingOption(buildPropertyPlot, fluid, 'ph', plot.isolineOptions), fluid, 'ph');
  });

  // ─── Ts (Temperature-Entropy) ────────────────────────────────────────────

  test.each(FLUIDS)('Ts plot describe and build for %s', (fluid) => {
    const catalogue = describeFluidPlots(fluid);

    expect(catalogue).toBeTruthy();
    expect(catalogue.fluid).toBe(fluid);
    expect(Array.isArray(catalogue.plots)).toBe(true);

    const plot = catalogue.plots.find((p) => p.id === 'Ts');

    if (!plot) {
      console.log(`  ${fluid.padEnd(16)} Ts: not available`);
      return;
    }

    console.log(`  ${fluid.padEnd(16)} Ts: available`);
    assertPlotDescriptor(plot, 'Temperature-Entropy');
    assertPlotData(buildWithFirstWorkingOption(buildPropertyPlot, fluid, 'Ts', plot.isolineOptions), fluid, 'Ts');
  });
});
