#include "plot/PlotDataModule.h"

#include "CPstrings.h"
#include "Exceptions.h"

#include <algorithm>
#include <cmath>
#include <limits>
#include <set>

namespace CoolProp {
namespace Plot {
namespace {

struct PlotDefinition {
    const char* id;
    const char* label;
    CoolProp::parameters yParameter;
    CoolProp::parameters xParameter;
    TPLimits limits;
};

const std::vector<PlotDefinition>& plot_definitions() {
    static const std::vector<PlotDefinition> definitions = {
        {"ph", "Pressure-Enthalpy", CoolProp::iP, CoolProp::iHmass, TPLimits::Achp}
    };
    return definitions;
}

inline AxisMetadata make_axis_metadata(CoolProp::parameters parameter, const PropertyPlot::Axis& axis) {
    AxisMetadata meta;
    meta.parameter = static_cast<int>(parameter);
    meta.scale = axis.scale;
    meta.range = Range{axis.min, axis.max};
    return meta;
}

inline ParameterRange make_parameter_range(CoolProp::parameters parameter, const Range& range) {
    ParameterRange pr;
    pr.parameter = static_cast<int>(parameter);
    pr.range = range;
    return pr;
}

inline Range ensure_valid_range(const Range& range, CoolProp::parameters parameter) {
    if (!std::isfinite(range.min) || !std::isfinite(range.max)) {
        throw CoolProp::ValueError(format("Invalid range for parameter %d", static_cast<int>(parameter)));
    }
    if (range.max < range.min) {
        throw CoolProp::ValueError(format("Range max < min for parameter %d", static_cast<int>(parameter)));
    }
    return range;
}

inline std::vector<double> generate_values_for_spec(const PropertyPlot& plot,
                                                    CoolProp::parameters parameter,
                                                    const IsolineSpec& spec,
                                                    Range& usedRange,
                                                    int fallbackCount) {
    if (!spec.values.empty()) {
        usedRange.min = *std::min_element(spec.values.begin(), spec.values.end());
        usedRange.max = *std::max_element(spec.values.begin(), spec.values.end());
        return spec.values;
    }

    Range range;
    if (spec.useCustomRange) {
        range = ensure_valid_range(spec.customRange, parameter);
    } else {
        range = plot.isoline_range(parameter);
    }
    usedRange = range;
    const int count = spec.valueCount > 0 ? spec.valueCount : fallbackCount;
    return generate_values_in_range(parameter, range, count);
}

inline bool contains_parameter(const std::set<int>& collection, CoolProp::parameters parameter) {
    return collection.find(static_cast<int>(parameter)) != collection.end();
}

} // namespace

PlotCatalogue describe_fluid_plots(const std::string& fluid) {
    PlotCatalogue catalogue;
    catalogue.fluid = fluid;

    for (const auto& definition : plot_definitions()) {
        try {
            PropertyPlot plot(fluid, definition.yParameter, definition.xParameter, definition.limits);

            PlotTypeDescriptor descriptor;
            descriptor.id = definition.id;
            descriptor.label = definition.label;
            descriptor.xAxis = make_axis_metadata(definition.xParameter, plot.xaxis);
            descriptor.yAxis = make_axis_metadata(definition.yParameter, plot.yaxis);

            const auto supported = plot.supported_isoline_keys();
            descriptor.isolineOptions.reserve(supported.size());
            for (auto parameter : supported) {
                try {
                    descriptor.isolineOptions.push_back(make_parameter_range(parameter, plot.isoline_range(parameter)));
                } catch (...) {
                    // Unexpected failures: skip problematic parameters
                }
            }

            catalogue.plots.push_back(descriptor);
        } catch (...) {
            // If plot cannot be constructed for this fluid, skip it silently
        }
    }

    return catalogue;
}

PlotData build_plot(const PlotRequest& request) {
    const PlotDefinition* definition = nullptr;
    for (const auto& candidate : plot_definitions()) {
        if (request.plotId == candidate.id) {
            definition = &candidate;
            break;
        }
    }
    if (!definition) {
        throw CoolProp::ValueError(format("Unsupported plot id '%s'", request.plotId.c_str()));
    }

    PropertyPlot plot(request.fluid, definition->yParameter, definition->xParameter, definition->limits);

    PlotData result;
    result.fluid = request.fluid;
    result.plotId = definition->id;
    result.xAxis = make_axis_metadata(definition->xParameter, plot.xaxis);
    result.yAxis = make_axis_metadata(definition->yParameter, plot.yaxis);

    const auto supported = plot.supported_isoline_keys();
    result.availableIsolines.reserve(supported.size());
    for (auto parameter : supported) {
        try {
            result.availableIsolines.push_back(make_parameter_range(parameter, plot.isoline_range(parameter)));
        } catch (...) {
            ParameterRange pr;
            pr.parameter = static_cast<int>(parameter);
            pr.range.min = std::numeric_limits<double>::quiet_NaN();
            pr.range.max = std::numeric_limits<double>::quiet_NaN();
            result.availableIsolines.push_back(pr);
        }
    }

    std::set<int> generatedParameters;

    const int defaultPoints = request.defaultPointsPerIsoline > 0 ? request.defaultPointsPerIsoline : 200;

    for (const auto& spec : request.isolines) {
        const auto parameter = static_cast<CoolProp::parameters>(spec.parameter);
        Range usedRange{0.0, 0.0};
        std::vector<double> values;
        try {
            values = generate_values_for_spec(plot, parameter, spec, usedRange, 5);
        } catch (const std::exception& err) {
            throw CoolProp::ValueError(format("Failed to prepare isoline values for parameter %d: %s",
                                              static_cast<int>(parameter), err.what()));
        }

        const int points = spec.points > 0 ? spec.points : defaultPoints;
        const auto isolines = plot.calc_isolines(parameter, values, points);
        for (const auto& isoline : isolines) {
            IsolineCurve curve;
            curve.parameter = static_cast<int>(parameter);
            curve.value = isoline.value;
            curve.x = isoline.x;
            curve.y = isoline.y;
            result.isolines.push_back(curve);
        }
        result.generatedIsolines.push_back(make_parameter_range(parameter, usedRange));
        generatedParameters.insert(static_cast<int>(parameter));
    }

    const auto saturationParameter = CoolProp::iQ;
    const bool supportsSaturation = std::find(supported.begin(), supported.end(), saturationParameter) != supported.end();
    if (request.includeSaturationCurves && supportsSaturation && !contains_parameter(generatedParameters, saturationParameter)) {
        try {
            const Range qRange = plot.isoline_range(saturationParameter);
            const std::vector<double> qValues = {qRange.min, qRange.max};
            const auto isolines = plot.calc_isolines(saturationParameter, qValues, defaultPoints);
            for (const auto& isoline : isolines) {
                IsolineCurve curve;
                curve.parameter = static_cast<int>(saturationParameter);
                curve.value = isoline.value;
                curve.x = isoline.x;
                curve.y = isoline.y;
                result.isolines.push_back(curve);
            }
            result.generatedIsolines.push_back(make_parameter_range(saturationParameter, qRange));
        } catch (...) {
            // Saturation isolines are optional – ignore failures
        }
    }

    return result;
}

} // namespace Plot
} // namespace CoolProp
