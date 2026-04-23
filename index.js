import coolpropFactory from './wasm/coolprop.js';

export default async function(moduleArg) {
  const module = await coolpropFactory(moduleArg);

  const _describeFluidPlots = module.describeFluidPlots;
  module.describeFluidPlots = function(fluid) {
    try {
      return _describeFluidPlots(fluid);
    } catch (_) {
      return { fluid, plots: [] };
    }
  };

  const _buildPropertyPlot = module.buildPropertyPlot;
  module.buildPropertyPlot = function(request) {
    try {
      return _buildPropertyPlot(request);
    } catch (e) {
      const msg = typeof e === 'number'
        ? `Plot calculation failed for fluid "${request?.fluid ?? 'unknown'}"`
        : String(e);
      throw new Error(msg);
    }
  };

  return module;
}
