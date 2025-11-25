#ifdef EMSCRIPTEN

#include "CoolProp.h"
#include "AbstractState.h"
#include "Configuration.h"
#include "HumidAirProp.h"
#include "DataStructures.h"
#include "Backends/Helmholtz/MixtureParameters.h"
#include "CoolPropLib.h"

#include <emscripten/bind.h>
using namespace emscripten;

EMSCRIPTEN_BINDINGS(coolprop_bindings)
{
    function("PropsSI", &CoolProp::PropsSI);
    function("get_global_param_string", &CoolProp::get_global_param_string);
}

#endif
