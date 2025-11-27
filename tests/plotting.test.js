import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('CoolProp plotting bindings', () => {
  /** @type {import('../wasm/coolprop').MainModule | null} */
  let module = null;
  let describeFluidPlots;
  let buildPropertyPlot;

  beforeAll(async () => {
    const modulePath = path.resolve(__dirname, '..', 'wasm', 'coolprop.js');
    const moduleUrl = pathToFileURL(modulePath).href;
    const factoryModule = await import(moduleUrl);
    const createModule = factoryModule.default;

    if (typeof createModule !== 'function') {
      throw new Error('coolprop wasm factory not found');
    }

    const wasmPathResolver = (file) => path.resolve(__dirname, '..', 'wasm', file);

    module = await createModule({
      locateFile: wasmPathResolver,
    });

    describeFluidPlots = module.describeFluidPlots;
    buildPropertyPlot = module.buildPropertyPlot;
  }, 120_000);

  test('describeFluidPlots returns catalogue for requested fluid', () => {
    if (!describeFluidPlots) {
      throw new Error('describeFluidPlots not initialised');
    }

    const result = describeFluidPlots('Water');
    console.log(JSON.stringify(result, null, 2));

    expect(result).toBeTruthy();
    expect(result.fluid).toBe('Water');
    expect(Array.isArray(result.plots)).toBe(true);
    expect(result.plots.length).toBeGreaterThan(0);

    const phPlot = result.plots.find((plot) => plot.id === 'ph');
    expect(phPlot).toBeTruthy();
    expect(phPlot.label).toMatch(/Pressure-Enthalpy/i);
    expect(phPlot.xAxis).toEqual(
      expect.objectContaining({
        parameter: expect.any(Number),
        scale: expect.any(Number),
        range: expect.objectContaining({ min: expect.any(Number), max: expect.any(Number) }),
      }),
    );
    expect(phPlot.yAxis).toEqual(
      expect.objectContaining({
        parameter: expect.any(Number),
        scale: expect.any(Number),
        range: expect.objectContaining({ min: expect.any(Number), max: expect.any(Number) }),
      }),
    );
    expect(Array.isArray(phPlot.isolineOptions)).toBe(true);
    expect(phPlot.isolineOptions.length).toBeGreaterThan(0);
  });

  test('buildPropertyPlot generates isoline data using discoverable parameters', () => {
    if (!describeFluidPlots || !buildPropertyPlot) {
      throw new Error('plotting API not initialised');
    }

    const catalogue = describeFluidPlots('Water');
    const phPlot = catalogue.plots.find((plot) => plot.id === 'ph');
    expect(phPlot).toBeTruthy();

    const targetIsoline = phPlot.isolineOptions[2];
    expect(targetIsoline).toBeTruthy();

    const request = {
      fluid: 'Water',
      plotId: 'ph',
      isolines: [
        {
          parameter: targetIsoline.parameter,
          valueCount: 3,
          points: 15,
        },
      ],
      includeSaturationCurves: true,
    };

    const plotData = buildPropertyPlot(request);

    console.log(JSON.stringify(plotData, null, 2));

    expect(plotData).toBeTruthy();
    expect(plotData.fluid).toBe('Water');
    expect(plotData.plotId).toBe('ph');
    expect(Array.isArray(plotData.isolines)).toBe(true);
    expect(plotData.isolines.length).toBeGreaterThan(0);
    for (const curve of plotData.isolines) {
      expect(curve).toEqual(
        expect.objectContaining({
          parameter: expect.any(Number),
          value: expect.any(Number),
          x: expect.any(Array),
          y: expect.any(Array),
        }),
      );
      expect(curve.x.length).toBeGreaterThan(0);
      expect(curve.x.length).toBe(curve.y.length);
    }

    expect(Array.isArray(plotData.generatedIsolines)).toBe(true);
    expect(plotData.generatedIsolines.length).toBeGreaterThan(0);
  });

  test('buildPropertyPlot rejects unsupported plot identifiers', () => {
    if (!buildPropertyPlot) {
      throw new Error('buildPropertyPlot not initialised');
    }

    expect(() =>
      buildPropertyPlot({
        fluid: 'Water',
        plotId: 'non-existent',
        isolines: [],
      }),
    ).toThrow();
  });
});
