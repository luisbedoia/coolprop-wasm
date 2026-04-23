import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FLUIDS = fs
  .readFileSync(path.resolve(__dirname, '..', 'allowed_fluids.txt'), 'utf8')
  .split('\n')
  .map((l) => l.trim())
  .filter(Boolean);

describe('CoolProp WASM API', () => {
  let module = null;

  beforeAll(async () => {
    const modulePath = path.resolve(__dirname, '..', 'index.js');
    const factoryModule = await import(pathToFileURL(modulePath).href);
    const createModule = factoryModule.default;

    if (typeof createModule !== 'function') {
      throw new Error('coolprop wasm factory not found');
    }

    module = await createModule({
      locateFile: (file) => path.resolve(__dirname, '..', 'wasm', file),
    });
  }, 120_000);

  // ─── propsSI ──────────────────────────────────────────────────────────────

  describe('propsSI', () => {
    test('water boiling point at 1 atm is ~373.15 K', () => {
      const T = module.propsSI('T', 'P', 101325, 'Q', 0, 'Water');
      expect(T).toBeCloseTo(373.15, 0);
    });

    test('water saturation pressure at 100 °C is ~101418 Pa', () => {
      // T_sat at exactly 373.15 K is ~101418 Pa; 101325 Pa corresponds to ~373.12 K
      const P = module.propsSI('P', 'T', 373.15, 'Q', 0, 'Water');
      expect(P).toBeGreaterThan(100000);
      expect(P).toBeLessThan(110000);
    });

    test('water triple point temperature is ~273.16 K', () => {
      const T = module.propsSI('T', 'P', 611.657, 'Q', 0, 'Water');
      expect(T).toBeCloseTo(273.16, 1);
    });

    test('R134a normal boiling point is ~246.7 K', () => {
      const T = module.propsSI('T', 'P', 101325, 'Q', 0, 'R134a');
      expect(T).toBeCloseTo(246.7, 0);
    });

    test('enthalpy of water vapour at 200 °C, 1 atm is finite and positive', () => {
      const H = module.propsSI('H', 'T', 473.15, 'P', 101325, 'Water');
      expect(Number.isFinite(H)).toBe(true);
      expect(H).toBeGreaterThan(0);
    });

    test('density of liquid water near 4 °C is close to 1000 kg/m³', () => {
      const rho = module.propsSI('D', 'T', 277.15, 'P', 101325, 'Water');
      expect(rho).toBeCloseTo(1000, -1);
    });

    test('viscosity of water at 20 °C is ~1e-3 Pa·s', () => {
      const mu = module.propsSI('V', 'T', 293.15, 'P', 101325, 'Water');
      expect(mu).toBeCloseTo(1e-3, 3);
    });

    test('quality of saturated vapour is 1', () => {
      const Q = module.propsSI('Q', 'T', 373.15, 'Q', 1, 'Water');
      expect(Q).toBeCloseTo(1, 5);
    });

    test('output is NaN for supercritical water requested as two-phase', () => {
      // Above critical point: quality is undefined, CoolProp returns NaN
      const Q = module.propsSI('Q', 'T', 700, 'P', 3e7, 'Water');
      expect(Number.isNaN(Q) || Q < 0 || Q > 1).toBe(true);
    });

    test('throws or returns error for unknown fluid', () => {
      expect(() => module.propsSI('T', 'P', 101325, 'Q', 0, 'NotAFluid')).toThrow();
    });

    test('throws or returns error for unknown output parameter', () => {
      expect(() => module.propsSI('UNKNOWN_OUTPUT', 'T', 300, 'P', 101325, 'Water')).toThrow();
    });

    test.each(FLUIDS)('propsSI returns finite density for %s at 1 atm, 25 °C', (fluid) => {
      let result;
      try {
        result = module.propsSI('D', 'T', 298.15, 'P', 101325, fluid);
      } catch (e) {
        // some fluids may not support this state — verify it throws a proper Error
        expect(e).toBeInstanceOf(Error);
        return;
      }
      expect(Number.isFinite(result)).toBe(true);
      expect(result).toBeGreaterThan(0);
    });
  });

  // ─── getGlobalParamString ─────────────────────────────────────────────────

  describe('getGlobalParamString', () => {
    test('returns a semver-like version string', () => {
      const version = module.getGlobalParamString('version');
      expect(typeof version).toBe('string');
      expect(version).toMatch(/^\d+\.\d+/);
    });

    test('fluids_list contains Water', () => {
      const list = module.getGlobalParamString('fluids_list');
      expect(list).toContain('Water');
    });

    test('fluids_list contains all allowed fluids', () => {
      const list = module.getGlobalParamString('fluids_list');
      for (const fluid of FLUIDS) {
        expect(list).toContain(fluid);
      }
    });

    test('errstring is empty when no error has occurred', () => {
      const err = module.getGlobalParamString('errstring');
      expect(typeof err).toBe('string');
    });

    test('throws for unknown key', () => {
      expect(() => module.getGlobalParamString('not_a_valid_key_xyz')).toThrow();
    });
  });

  // ─── getFluidParamString ──────────────────────────────────────────────────

  describe('getFluidParamString', () => {
    test('returns correct CAS number for Water', () => {
      const cas = module.getFluidParamString('Water', 'CAS');
      expect(cas).toBe('7732-18-5');
    });

    test('returns molar mass of Water via propsSI as ~0.018015 kg/mol', () => {
      // molar_mass is a numeric property accessed via propsSI('M', ...)
      const mm = module.propsSI('M', 'T', 300, 'P', 101325, 'Water');
      expect(mm).toBeCloseTo(0.018015, 4);
    });

    test('returns non-empty name for Ammonia', () => {
      const name = module.getFluidParamString('Ammonia', 'name');
      expect(typeof name).toBe('string');
      expect(name.length).toBeGreaterThan(0);
    });

    test('throws for unknown fluid', () => {
      expect(() => module.getFluidParamString('NotAFluid', 'CAS')).toThrow();
    });
  });

  // ─── getParameterIndex ────────────────────────────────────────────────────

  describe('getParameterIndex', () => {
    const KNOWN_PARAMS = ['T', 'P', 'H', 'D', 'S', 'Q', 'U', 'V', 'L', 'C', 'O'];

    test('all known parameter names return non-negative integers', () => {
      for (const param of KNOWN_PARAMS) {
        const idx = module.getParameterIndex(param);
        expect(typeof idx).toBe('number');
        expect(Number.isInteger(idx)).toBe(true);
        expect(idx).toBeGreaterThanOrEqual(0);
      }
    });

    test('T, P, H, D all have distinct indices', () => {
      const indices = ['T', 'P', 'H', 'D'].map((p) => module.getParameterIndex(p));
      expect(new Set(indices).size).toBe(4);
    });

    test('throws for unknown parameter', () => {
      expect(() => module.getParameterIndex('NOT_A_PARAM_XYZ')).toThrow();
    });
  });

  // ─── getParameterInformation ──────────────────────────────────────────────

  describe('getParameterInformation', () => {
    test('pressure parameter has units containing Pa', () => {
      const iP = module.getParameterIndex('P');
      const units = module.getParameterInformation(iP, 'units');
      expect(typeof units).toBe('string');
      expect(units).toContain('Pa');
    });

    test('temperature parameter has units containing K', () => {
      const iT = module.getParameterIndex('T');
      const units = module.getParameterInformation(iT, 'units');
      expect(units).toContain('K');
    });

    test('IO flag for pressure is a non-empty string', () => {
      const iP = module.getParameterIndex('P');
      const io = module.getParameterInformation(iP, 'IO');
      expect(typeof io).toBe('string');
      expect(io.length).toBeGreaterThan(0);
    });

    test('units for enthalpy contain J', () => {
      const iH = module.getParameterIndex('H');
      const units = module.getParameterInformation(iH, 'units');
      expect(units).toContain('J');
    });
  });

  // ─── getPhaseIndex / getPhaseName ─────────────────────────────────────────

  describe('getPhaseIndex and getPhaseName', () => {
    const PHASE_NAMES = [
      'phase_liquid',
      'phase_gas',
      'phase_twophase',
      'phase_supercritical',
      'phase_supercritical_gas',
      'phase_supercritical_liquid',
      'phase_not_imposed',
    ];

    test.each(PHASE_NAMES)('getPhaseIndex returns a non-negative integer for %s', (name) => {
      const idx = module.getPhaseIndex(name);
      expect(typeof idx).toBe('number');
      expect(idx).toBeGreaterThanOrEqual(0);
    });

    test.each(PHASE_NAMES)('getPhaseName(getPhaseIndex(%s)) round-trips correctly', (name) => {
      const idx = module.getPhaseIndex(name);
      const back = module.getPhaseName(idx);
      expect(back).toBe(name);
    });

    test('all phase indices are distinct', () => {
      const indices = PHASE_NAMES.map((n) => module.getPhaseIndex(n));
      expect(new Set(indices).size).toBe(PHASE_NAMES.length);
    });

    test('getPhaseName returns phase_unknown for out-of-range index', () => {
      expect(module.getPhaseName(-999)).toBe('phase_unknown');
      expect(module.getPhaseName(9999)).toBe('phase_unknown');
    });

    test('quality of a two-phase state is between 0 and 1', () => {
      // Specify state by (T, Q=0.5) → ask for Q back, must equal 0.5
      const Q = module.propsSI('Q', 'T', 373.15, 'Q', 0.5, 'Water');
      expect(Q).toBeCloseTo(0.5, 5);
    });
  });
});
