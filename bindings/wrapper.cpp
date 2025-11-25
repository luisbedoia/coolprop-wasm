#ifdef EMSCRIPTEN

#include "CoolProp.h"
#include "AbstractState.h"
#include "Configuration.h"
#include "HumidAirProp.h"
#include "DataStructures.h"
#include "Backends/Helmholtz/MixtureParameters.h"
#include "Backends/Helmholtz/Fluids/FluidLibrary.h"
#include "CoolPropLib.h"
#include "CoolPropPlot.h"
#include "CPstrings.h"
#include "property_plot_utils.h"

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

EMSCRIPTEN_BINDINGS(coolprop_bindings)
{
    function("PropsSI", &CoolProp::PropsSI);
    function("get_global_param_string", &CoolProp::get_global_param_string);
    function("get_fluid_param_string", &CoolProp::get_fluid_param_string);
    function("get_fluid_as_JSONstring", &CoolProp::get_fluid_as_JSONstring);
    function("compute_property_plot", &CoolPropWasm::compute_property_plot);
    function("get_parameter_index", &get_parameter_index_js);
    function("get_phase_index", &get_phase_index_js);
    function("list_supported_property_plots", &CoolPropWasm::list_supported_property_plots);
}

#endif
