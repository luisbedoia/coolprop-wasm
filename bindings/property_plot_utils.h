#pragma once

#ifdef EMSCRIPTEN

#include <emscripten/val.h>

namespace CoolPropWasm
{
    emscripten::val compute_property_plot(const emscripten::val &options);
    emscripten::val list_supported_property_plots();
}

#endif
