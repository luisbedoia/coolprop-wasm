import MainModuleFactory from "./wasm/coolprop";

(async () => {
  const CP = await MainModuleFactory();

  console.log(CP.PropsSI("T", "P", 101325, "Q", 0, "Water"));
})();
