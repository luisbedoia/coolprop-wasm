#ifdef EMSCRIPTEN

#include "CoolProp.h"
#include "AbstractState.h"
#include "Configuration.h"
#include "HumidAirProp.h"
#include "DataStructures.h"
#include "Backends/Helmholtz/MixtureParameters.h"
#include "Backends/Helmholtz/Fluids/FluidLibrary.h"
#include "CoolPropLib.h"
#include "CPstrings.h"

#include <emscripten/bind.h>
#include <string>

using namespace emscripten;

int get_parameter_index_js(const std::string &key)
{
    return static_cast<int>(CoolProp::get_parameter_index(key));
}

int get_phase_index_js(const std::string &phase)
{
    return static_cast<int>(CoolProp::get_phase_index(phase));
}

std::string get_parameter_information_js(const std::string& key, const std::string& field) {
    const auto idx = static_cast<int>(CoolProp::get_parameter_index(key));
    return CoolProp::get_parameter_information(idx, field);
}

std::string get_phase_short_desc_js(int idx) {
    static std::map<int, std::string> phase_lookup;
    if (phase_lookup.empty()) {
        const char* phase_names[] = {
            "phase_liquid",
            "phase_gas",
            "phase_twophase",
            "phase_supercritical",
            "phase_supercritical_gas",
            "phase_supercritical_liquid",
            "phase_critical_point",
            "phase_unknown",
            "phase_not_imposed"
        };
        for (const auto* name : phase_names) {
            try {
                auto phase = CoolProp::get_phase_index(name);
                phase_lookup.emplace(static_cast<int>(phase), name);
            } catch (...) {
                // Skip names that are not recognized in this build
            }
        }
    }
    auto it = phase_lookup.find(idx);
    if (it != phase_lookup.end()) {
        return it->second;
    }
    return "phase_unknown";
}

EMSCRIPTEN_BINDINGS(coolprop_bindings)
{
    function("PropsSI", &CoolProp::PropsSI);
    function("get_global_param_string", &CoolProp::get_global_param_string);
    function("get_fluid_param_string", &CoolProp::get_fluid_param_string);
    function("get_parameter_information", &get_parameter_information_js);
    function("get_parameter_index", &get_parameter_index_js);
    function("get_phase_index", &get_phase_index_js);
    function("get_phase_short_desc", &get_phase_short_desc_js);
}

#endif
