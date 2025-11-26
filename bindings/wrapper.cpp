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
#include "plot/PlotDataModule.h"

#include <emscripten/bind.h>
#include <map>
#include <string>
#include <vector>

using namespace emscripten;

namespace {

bool has_property(const val& object, const char* key) {
    return !object.isUndefined() && !object.isNull() && object.hasOwnProperty(key);
}

bool has_property(const val& object, const std::string& key) {
    return has_property(object, key.c_str());
}

val to_js_range(const CoolProp::Plot::Range& range) {
    val obj = val::object();
    obj.set("min", range.min);
    obj.set("max", range.max);
    return obj;
}

val to_js_axis_metadata(const CoolProp::Plot::AxisMetadata& axis) {
    val obj = val::object();
    obj.set("parameter", axis.parameter);
    obj.set("scale", static_cast<int>(axis.scale));
    obj.set("range", to_js_range(axis.range));
    return obj;
}

val to_js_parameter_range(const CoolProp::Plot::ParameterRange& range) {
    val obj = val::object();
    obj.set("parameter", range.parameter);
    obj.set("range", to_js_range(range.range));
    return obj;
}

val to_js_plot_descriptor(const CoolProp::Plot::PlotTypeDescriptor& descriptor) {
    val obj = val::object();
    obj.set("id", descriptor.id);
    obj.set("label", descriptor.label);
    obj.set("xAxis", to_js_axis_metadata(descriptor.xAxis));
    obj.set("yAxis", to_js_axis_metadata(descriptor.yAxis));

    val isolines = val::array();
    for (std::size_t i = 0; i < descriptor.isolineOptions.size(); ++i) {
        isolines.set(i, to_js_parameter_range(descriptor.isolineOptions[i]));
    }
    obj.set("isolineOptions", isolines);
    return obj;
}

val to_js_plot_catalogue(const CoolProp::Plot::PlotCatalogue& catalogue) {
    val obj = val::object();
    obj.set("fluid", catalogue.fluid);

    val plots = val::array();
    for (std::size_t i = 0; i < catalogue.plots.size(); ++i) {
        plots.set(i, to_js_plot_descriptor(catalogue.plots[i]));
    }
    obj.set("plots", plots);
    return obj;
}

val to_js_isoline_curve(const CoolProp::Plot::IsolineCurve& curve) {
    val obj = val::object();
    obj.set("parameter", curve.parameter);
    obj.set("value", curve.value);

    val xs = val::array();
    for (std::size_t i = 0; i < curve.x.size(); ++i) {
        xs.set(i, curve.x[i]);
    }

    val ys = val::array();
    for (std::size_t i = 0; i < curve.y.size(); ++i) {
        ys.set(i, curve.y[i]);
    }

    obj.set("x", xs);
    obj.set("y", ys);
    return obj;
}

val to_js_parameter_range_list(const std::vector<CoolProp::Plot::ParameterRange>& ranges) {
    val arr = val::array();
    for (std::size_t i = 0; i < ranges.size(); ++i) {
        arr.set(i, to_js_parameter_range(ranges[i]));
    }
    return arr;
}

val to_js_isoline_curves(const std::vector<CoolProp::Plot::IsolineCurve>& curves) {
    val arr = val::array();
    for (std::size_t i = 0; i < curves.size(); ++i) {
        arr.set(i, to_js_isoline_curve(curves[i]));
    }
    return arr;
}

val to_js_plot_data(const CoolProp::Plot::PlotData& data) {
    val obj = val::object();
    obj.set("fluid", data.fluid);
    obj.set("plotId", data.plotId);
    obj.set("xAxis", to_js_axis_metadata(data.xAxis));
    obj.set("yAxis", to_js_axis_metadata(data.yAxis));
    obj.set("isolines", to_js_isoline_curves(data.isolines));
    obj.set("availableIsolines", to_js_parameter_range_list(data.availableIsolines));
    obj.set("generatedIsolines", to_js_parameter_range_list(data.generatedIsolines));
    return obj;
}

CoolProp::Plot::IsolineSpec parse_isoline_spec(const val& specVal) {
    CoolProp::Plot::IsolineSpec spec;
    if (!has_property(specVal, std::string("parameter"))) {
        throw CoolProp::ValueError("Isoline specification is missing 'parameter'");
    }
    spec.parameter = specVal["parameter"].as<int>();

    if (has_property(specVal, std::string("values"))) {
        val values = specVal["values"];
        if (!values.isNull() && !values.isUndefined()) {
            if (!has_property(values, "length")) {
                throw CoolProp::ValueError("'values' must be an array");
            }
            const unsigned length = values["length"].as<unsigned>();
            spec.values.reserve(length);
            for (unsigned i = 0; i < length; ++i) {
                spec.values.push_back(values[i].as<double>());
            }
        }
    }

    if (has_property(specVal, std::string("valueCount"))) {
        spec.valueCount = specVal["valueCount"].as<int>();
    }
    if (has_property(specVal, std::string("useCustomRange"))) {
        spec.useCustomRange = specVal["useCustomRange"].as<bool>();
    }
    if (has_property(specVal, std::string("customRange"))) {
        val range = specVal["customRange"];
        if (!range.isNull() && !range.isUndefined()) {
            spec.customRange.min = range["min"].as<double>();
            spec.customRange.max = range["max"].as<double>();
        }
    }
    if (has_property(specVal, std::string("points"))) {
        spec.points = specVal["points"].as<int>();
    }

    return spec;
}

std::vector<CoolProp::Plot::IsolineSpec> parse_isoline_specs(const val& specsVal) {
    std::vector<CoolProp::Plot::IsolineSpec> specs;
    if (specsVal.isUndefined() || specsVal.isNull()) {
        return specs;
    }
    if (!has_property(specsVal, "length")) {
        throw CoolProp::ValueError("Isoline specification list must be an array");
    }
    const unsigned length = specsVal["length"].as<unsigned>();
    specs.reserve(length);
    for (unsigned i = 0; i < length; ++i) {
        specs.push_back(parse_isoline_spec(specsVal[i]));
    }
    return specs;
}

val describe_fluid_plots_js(const std::string& fluid) {
    return to_js_plot_catalogue(CoolProp::Plot::describe_fluid_plots(fluid));
}

val build_property_plot_js(const val& requestVal) {
    if (!has_property(requestVal, std::string("fluid"))) {
        throw CoolProp::ValueError("Plot request is missing 'fluid'");
    }
    if (!has_property(requestVal, std::string("plotId"))) {
        throw CoolProp::ValueError("Plot request is missing 'plotId'");
    }

    CoolProp::Plot::PlotRequest request;
    request.fluid = requestVal["fluid"].as<std::string>();
    request.plotId = requestVal["plotId"].as<std::string>();
    request.isolines = parse_isoline_specs(requestVal["isolines"]);

    if (has_property(requestVal, std::string("defaultPointsPerIsoline"))) {
        request.defaultPointsPerIsoline = requestVal["defaultPointsPerIsoline"].as<int>();
    }
    if (has_property(requestVal, std::string("includeSaturationCurves"))) {
        request.includeSaturationCurves = requestVal["includeSaturationCurves"].as<bool>();
    }

    const CoolProp::Plot::PlotData data = CoolProp::Plot::build_plot(request);
    return to_js_plot_data(data);
}

} // namespace

int get_parameter_index_js(const std::string& key) {
    return static_cast<int>(CoolProp::get_parameter_index(key));
}

int get_phase_index_js(const std::string& phase) {
    return static_cast<int>(CoolProp::get_phase_index(phase));
}

std::string get_parameter_information_js(const int& key, const std::string& field) {
    return CoolProp::get_parameter_information(key, field);
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
                const auto phase = CoolProp::get_phase_index(name);
                phase_lookup.emplace(static_cast<int>(phase), name);
            } catch (...) {
                // Skip names that are not recognized in this build
            }
        }
    }

    const auto it = phase_lookup.find(idx);
    if (it != phase_lookup.end()) {
        return it->second;
    }
    return "phase_unknown";
}

EMSCRIPTEN_BINDINGS(coolprop_bindings) {
    function("PropsSI", &CoolProp::PropsSI);
    function("get_global_param_string", &CoolProp::get_global_param_string);
    function("get_fluid_param_string", &CoolProp::get_fluid_param_string);
    function("get_parameter_information", &get_parameter_information_js);
    function("get_parameter_index", &get_parameter_index_js);
    function("get_phase_index", &get_phase_index_js);
    function("get_phase_short_desc", &get_phase_short_desc_js);
    function("describeFluidPlots", &describe_fluid_plots_js);
    function("buildPropertyPlot", &build_property_plot_js);
}

#endif
