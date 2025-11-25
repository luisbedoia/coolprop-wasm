#ifdef EMSCRIPTEN

#include "CoolProp.h"
#include "AbstractState.h"
#include "Configuration.h"
#include "HumidAirProp.h"
#include "DataStructures.h"
#include "Backends/Helmholtz/MixtureParameters.h"
#include "CoolPropLib.h"
#include "CoolPropPlot.h"
#include "CPstrings.h"

#include <emscripten/bind.h>
#include <algorithm>
#include <cctype>
#include <map>
#include <stdexcept>
#include <string>
#include <vector>

using namespace emscripten;

namespace
{

    struct ChartSpec
    {
        CoolProp::parameters ykey;
        CoolProp::parameters xkey;
        std::string canonical;
    };

    const std::map<std::string, ChartSpec> &chart_spec_map()
    {
        static const std::map<std::string, ChartSpec> charts = {
            {"PH", {CoolProp::iP, CoolProp::iHmass, "p-h"}},
            {"HP", {CoolProp::iHmass, CoolProp::iP, "h-p"}},
            {"TS", {CoolProp::iT, CoolProp::iSmass, "T-s"}},
            {"ST", {CoolProp::iSmass, CoolProp::iT, "s-T"}},
            {"HS", {CoolProp::iHmass, CoolProp::iSmass, "h-s"}},
            {"SH", {CoolProp::iSmass, CoolProp::iHmass, "s-h"}},
            {"PS", {CoolProp::iP, CoolProp::iSmass, "p-s"}},
            {"SP", {CoolProp::iSmass, CoolProp::iP, "s-p"}},
            {"PRHO", {CoolProp::iP, CoolProp::iDmass, "p-rho"}},
            {"RHOP", {CoolProp::iDmass, CoolProp::iP, "rho-p"}},
            {"TRHO", {CoolProp::iT, CoolProp::iDmass, "T-rho"}},
            {"RHOT", {CoolProp::iDmass, CoolProp::iT, "rho-T"}},
            {"PT", {CoolProp::iP, CoolProp::iT, "p-T"}},
            {"TP", {CoolProp::iT, CoolProp::iP, "T-p"}}};
        return charts;
    }

    std::string normalize_chart_key(const std::string &chart)
    {
        std::string cleaned;
        cleaned.reserve(chart.size());
        for (char ch : chart)
        {
            if (std::isalpha(static_cast<unsigned char>(ch)))
            {
                cleaned.push_back(static_cast<char>(std::toupper(static_cast<unsigned char>(ch))));
            }
        }
        return cleaned;
    }

    ChartSpec resolve_chart(const std::string &chart)
    {
        const auto key = normalize_chart_key(chart);
        const auto &charts = chart_spec_map();
        auto it = charts.find(key);
        if (it == charts.end())
        {
            throw std::invalid_argument("Unsupported property-plot chart key: " + chart);
        }
        return it->second;
    }

    CoolProp::Plot::TPLimits resolve_tplimits(const std::string &name)
    {
        std::string upper = name;
        std::transform(upper.begin(), upper.end(), upper.begin(),
                       [](unsigned char c)
                       { return std::toupper(c); });
        if (upper == "NONE")
            return CoolProp::Plot::TPLimits::None;
        if (upper == "DEF" || upper == "DEFAULT")
            return CoolProp::Plot::TPLimits::Def;
        if (upper == "ACHP")
            return CoolProp::Plot::TPLimits::Achp;
        if (upper == "ORC")
            return CoolProp::Plot::TPLimits::Orc;
        throw std::invalid_argument("Unsupported tpLimits value: " + name);
    }

    std::string tplimits_to_string(CoolProp::Plot::TPLimits limits)
    {
        switch (limits)
        {
        case CoolProp::Plot::TPLimits::None:
            return "None";
        case CoolProp::Plot::TPLimits::Def:
            return "Def";
        case CoolProp::Plot::TPLimits::Achp:
            return "Achp";
        case CoolProp::Plot::TPLimits::Orc:
            return "Orc";
        default:
            return "Def";
        }
    }

    emscripten::val parameter_descriptor(CoolProp::parameters param)
    {
        emscripten::val descriptor = emscripten::val::object();
        const auto index = static_cast<int>(param);
        descriptor.set("index", index);
        descriptor.set("symbol", CoolProp::get_parameter_information(index, "short"));
        descriptor.set("units", CoolProp::get_parameter_information(index, "units"));
        return descriptor;
    }

    bool is_js_array(const emscripten::val &value)
    {
        return emscripten::val::global("Array").call<bool>("isArray", value);
    }

    emscripten::val to_js_array(const std::vector<double> &values)
    {
        emscripten::val array = emscripten::val::array();
        for (std::size_t i = 0; i < values.size(); ++i)
        {
            array.set(i, values[i]);
        }
        return array;
    }

    emscripten::val axis_descriptor(CoolProp::parameters axis_key,
                                    const CoolProp::Plot::PropertyPlot::Axis &axis)
    {
        emscripten::val descriptor = emscripten::val::object();
        descriptor.set("symbol", CoolProp::get_parameter_information(static_cast<int>(axis_key), "short"));
        descriptor.set("units", CoolProp::get_parameter_information(static_cast<int>(axis_key), "units"));
        descriptor.set("index", static_cast<int>(axis_key));
        descriptor.set("scale", axis.scale == CoolProp::Plot::Scale::Lin ? "linear" : "log");
        descriptor.set("min", axis.min);
        descriptor.set("max", axis.max);
        return descriptor;
    }

    struct IsoRequest
    {
        CoolProp::parameters key;
        std::string label;
        std::vector<double> values;
        int points;
    };

    std::vector<double> val_to_double_vector(const emscripten::val &array_val)
    {
        std::vector<double> values;
        if (array_val.isUndefined() || array_val.isNull())
        {
            return values;
        }
        if (!is_js_array(array_val))
        {
            throw std::invalid_argument("Expected an array when reading numerical values");
        }
        const auto length = array_val["length"].as<unsigned>();
        values.reserve(length);
        for (unsigned i = 0; i < length; ++i)
        {
            values.push_back(array_val[i].as<double>());
        }
        return values;
    }

    IsoRequest parse_isoline_request(const emscripten::val &iso_val,
                                     const CoolProp::Plot::PropertyPlot &plot)
    {
        if (!iso_val.typeOf().strictlyEquals(emscripten::val("object")))
        {
            throw std::invalid_argument("Each isoline configuration must be an object");
        }

        if (!iso_val.hasOwnProperty("key"))
        {
            throw std::invalid_argument("Isoline configuration requires a 'key' property");
        }

        const std::string key_string = iso_val["key"].as<std::string>();
        const CoolProp::parameters key = CoolProp::get_parameter_index(key_string);
        const std::string label = CoolProp::get_parameter_information(static_cast<int>(key), "short");

        IsoRequest request{key, label, {}, 250};

        if (iso_val.hasOwnProperty("points"))
        {
            request.points = std::max(1, iso_val["points"].as<int>());
        }

        if (iso_val.hasOwnProperty("values"))
        {
            request.values = val_to_double_vector(iso_val["values"]);
        }

        if (request.values.empty())
        {
            CoolProp::Plot::Range requested_range = plot.isoline_range(key);

            if (iso_val.hasOwnProperty("range"))
            {
                std::vector<double> raw_range = val_to_double_vector(iso_val["range"]);
                if (raw_range.size() == 1)
                {
                    request.values = raw_range;
                }
                else if (raw_range.size() >= 2)
                {
                    CoolProp::Plot::Range range{raw_range.front(), raw_range.back()};
                    const int num = iso_val.hasOwnProperty("num") ? std::max(1, iso_val["num"].as<int>()) : std::max(2, static_cast<int>(raw_range.size()));
                    request.values = CoolProp::Plot::generate_values_in_range(key, range, num);
                }
                else
                {
                    throw std::invalid_argument("The 'range' array must contain at least one value");
                }
            }
            else
            {
                const int num = iso_val.hasOwnProperty("num") ? std::max(1, iso_val["num"].as<int>()) : 10;
                request.values = CoolProp::Plot::generate_values_in_range(key, requested_range, num);
            }
        }

        if (request.values.empty())
        {
            throw std::invalid_argument("Unable to determine isoline values for key " + key_string);
        }

        return request;
    }

    std::vector<IsoRequest> collect_isoline_requests(const emscripten::val &options,
                                                     const CoolProp::Plot::PropertyPlot &plot)
    {
        std::vector<IsoRequest> requests;

        if (!options.hasOwnProperty("isolines"))
        {
            return requests;
        }

        const emscripten::val isolines_val = options["isolines"];
        if (isolines_val.isArray())
        {
            const auto length = isolines_val["length"].as<unsigned>();
            requests.reserve(length);
            for (unsigned i = 0; i < length; ++i)
            {
                requests.push_back(parse_isoline_request(isolines_val[i], plot));
            }
        }
        else
        {
            requests.push_back(parse_isoline_request(isolines_val, plot));
        }
        return requests;
    }

    emscripten::val compute_property_plot_bind(const emscripten::val &options)
    {
        if (!options.hasOwnProperty("fluid"))
        {
            throw std::invalid_argument("Missing required 'fluid' property");
        }
        if (!options.hasOwnProperty("chart"))
        {
            throw std::invalid_argument("Missing required 'chart' property");
        }

        const std::string fluid = options["fluid"].as<std::string>();
        const ChartSpec spec = resolve_chart(options["chart"].as<std::string>());

        CoolProp::Plot::TPLimits tplimits = CoolProp::Plot::TPLimits::Def;
        if (options.hasOwnProperty("tpLimits"))
        {
            tplimits = resolve_tplimits(options["tpLimits"].as<std::string>());
        }

        CoolProp::Plot::PropertyPlot plot(fluid, spec.ykey, spec.xkey, tplimits);

        emscripten::val result = emscripten::val::object();
        result.set("fluid", fluid);
        result.set("chart", spec.canonical);
        result.set("tpLimits", tplimits_to_string(tplimits));

        emscripten::val axes = emscripten::val::object();
        axes.set("x", axis_descriptor(spec.xkey, plot.xaxis));
        axes.set("y", axis_descriptor(spec.ykey, plot.yaxis));
        result.set("axis", axes);

        std::vector<IsoRequest> requests = collect_isoline_requests(options, plot);
        emscripten::val isoline_groups = emscripten::val::array();

        for (std::size_t i = 0; i < requests.size(); ++i)
        {
            const IsoRequest &request = requests[i];
            CoolProp::Plot::Isolines lines = plot.calc_isolines(request.key, request.values, request.points);

            emscripten::val group = emscripten::val::object();
            group.set("parameter", parameter_descriptor(request.key));
            group.set("points", request.points);
            group.set("requestedValues", to_js_array(request.values));
            group.set("label", request.label);

            emscripten::val line_array = emscripten::val::array();
            for (std::size_t j = 0; j < lines.size(); ++j)
            {
                const CoolProp::Plot::Isoline &line = lines[j];
                emscripten::val line_obj = emscripten::val::object();
                line_obj.set("value", line.value);
                line_obj.set("x", to_js_array(line.x));
                line_obj.set("y", to_js_array(line.y));
                line_obj.set("size", static_cast<int>(line.size()));
                line_array.set(j, line_obj);
            }
            group.set("lines", line_array);
            isoline_groups.set(i, group);
        }
        result.set("isolines", isoline_groups);

        emscripten::val supported = emscripten::val::array();
        std::vector<CoolProp::parameters> supported_keys = plot.supported_isoline_keys();
        for (std::size_t i = 0; i < supported_keys.size(); ++i)
        {
            supported.set(i, parameter_descriptor(supported_keys[i]));
        }
        result.set("supportedIsolineKeys", supported);

        return result;
    }

    int get_parameter_index_js(const std::string &key)
    {
        return static_cast<int>(CoolProp::get_parameter_index(key));
    }

    int get_phase_index_js(const std::string &phase)
    {
        return static_cast<int>(CoolProp::get_phase_index(phase));
    }

    emscripten::val list_supported_property_plots()
    {
        const auto &charts = chart_spec_map();
        emscripten::val array = emscripten::val::array();
        std::size_t idx = 0;
        for (const auto &entry : charts)
        {
            emscripten::val obj = emscripten::val::object();
            obj.set("key", entry.first);
            obj.set("chart", entry.second.canonical);
            obj.set("y", parameter_descriptor(entry.second.ykey));
            obj.set("x", parameter_descriptor(entry.second.xkey));
            array.set(idx++, obj);
        }
        return array;
    }

} // namespace

EMSCRIPTEN_BINDINGS(coolprop_bindings)
{
    function("PropsSI", &CoolProp::PropsSI);
    function("get_global_param_string", &CoolProp::get_global_param_string);
    function("compute_property_plot", &compute_property_plot_bind);
    function("get_parameter_index", &get_parameter_index_js);
    function("get_phase_index", &get_phase_index_js);
    function("list_supported_property_plots", &list_supported_property_plots);
}

#endif
