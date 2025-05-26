# coolprop-wasm

TypeScript wrapper for the [CoolProp](http://www.coolprop.org/) library using WebAssembly.

This package allows you to use CoolProp's capabilities (thermodynamic properties of fluids) directly from JavaScript/TypeScript in any WebAssembly-compatible environment, such as Node.js or browsers.

---

## Installation

### From GitHub Packages

1. **Add to your `.npmrc` (at the root of your project):**

```
@luisbedoia:registry=https://npm.pkg.github.com/
//npm.pkg.github.com/:_authToken=YOUR_GITHUB_TOKEN
```

> Replace `YOUR_GITHUB_TOKEN` with a [Personal Access Token](https://github.com/settings/tokens) with the `read:packages` scope.

2. **Install the package:**

```
npm install @luisbedoia/coolprop-wasm
```

---

## Basic usage

```typescript
import MainModuleFactory from '@luisbedoia/coolprop-wasm';

(async () => {
    const CP = await MainModuleFactory();

    // Example: get the density of water at 300 K and 1 atm
    const density = CP.PropsSI('D', 'T', 300, 'P', 101325, 'Water');
    console.log('Density:', density, 'kg/m³');
})();
```

- The main file is `wasm/coolprop.js` and the WebAssembly binary is `wasm/coolprop.wasm`.
- TypeScript types are in `wasm/coolprop.d.ts`.

---

## Resources
- [CoolProp Documentation](http://www.coolprop.org/)
- [Original repository](https://github.com/luisbedoia/coolprop-wasm)

---

## License
ISC
