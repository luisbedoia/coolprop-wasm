let esmFactory;

async function load() {
  if (!esmFactory) {
    const mod = await import('./wasm/coolprop.js');
    esmFactory = mod && mod.default ? mod.default : mod;
  }
  return esmFactory;
}

function coolpropFactory(moduleArg) {
  return load().then((factory) => factory(moduleArg));
}

module.exports = coolpropFactory;
module.exports.default = coolpropFactory;
