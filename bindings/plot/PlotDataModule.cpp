#include "plot/PlotDataModule.h"

#include "CPstrings.h"
#include "Exceptions.h"

#include <algorithm>
#include <cmath>
#include <iostream>
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
        {"ph", "Pressure-Enthalpy", CoolProp::iP, CoolProp::iHmass, TPLimits::Def}
    };
    return definitions;
}

inline bool has_finite_sample(const Isoline& isoline) {
    for (std::size_t i = 0; i < isoline.x.size(); ++i) {
        if (std::isfinite(isoline.x[i]) && std::isfinite(isoline.y[i])) {
            return true;
        }
    }
    return false;
}

inline bool is_axis_parameter(const PlotDefinition& definition, CoolProp::parameters parameter) {
    return parameter == definition.xParameter || parameter == definition.yParameter;
}

inline void ensure_axis_parameters(const PlotDefinition& definition,
                                   std::vector<CoolProp::parameters>& collection) {
    if (std::find(collection.begin(), collection.end(), definition.xParameter) == collection.end()) {
        collection.push_back(definition.xParameter);
    }
    if (std::find(collection.begin(), collection.end(), definition.yParameter) == collection.end()) {
        collection.push_back(definition.yParameter);
    }
}

inline Range range_for_parameter(const PlotDefinition& definition,
                                 const PropertyPlot& plot,
                                 CoolProp::parameters parameter) {
    if (parameter == definition.xParameter) {
        return plot.xaxis.range;
    }
    if (parameter == definition.yParameter) {
        return plot.yaxis.range;
    }
    return plot.isoline_range(parameter);
}

inline IsolineCurve make_vertical_isoline(double value, int points, const PropertyPlot& plot, const PlotDefinition& definition) {
    IsolineCurve curve;
    curve.parameter = static_cast<int>(definition.xParameter);
    curve.value = value;
    std::vector<double> yValues = generate_values_in_range(plot.yaxis.scale, plot.yaxis.range, points);
    curve.y = std::move(yValues);
    curve.x.assign(curve.y.size(), value);
    return curve;
}

inline IsolineCurve make_horizontal_isoline(double value, int points, const PropertyPlot& plot, const PlotDefinition& definition) {
    IsolineCurve curve;
    curve.parameter = static_cast<int>(definition.yParameter);
    curve.value = value;
    std::vector<double> xValues = generate_values_in_range(plot.xaxis.scale, plot.xaxis.range, points);
    curve.x = std::move(xValues);
    curve.y.assign(curve.x.size(), value);
    return curve;
}

bool can_generate_isoline(const PlotDefinition& definition, const PropertyPlot& plot, CoolProp::parameters parameter) {
    if (is_axis_parameter(definition, parameter)) {
        return true;
    }
    // if (parameter == CoolProp::iDmass || parameter == CoolProp::iSmass) {
    //     std::cerr << "Skipping unsupported isoline parameter " << static_cast<int>(parameter) << std::endl;
    //     return false;
    // }
    std::cerr << "can_generate_isoline begin " << static_cast<int>(parameter) << std::endl;
    try {
        Range range = plot.isoline_range(parameter);
        if (!std::isfinite(range.min) || !std::isfinite(range.max)) {
            return false;
        }
        if (range.max <= range.min) {
            return false;
        }

        const double span = range.max - range.min;
        if (!std::isfinite(span) || span <= 0.0) {
            return false;
        }

        std::vector<double> values = generate_values_in_range(parameter, range, 3);
        std::vector<double> sanitized;
        sanitized.reserve(values.size());
        double guard = span * 5e-3;
        if (!std::isfinite(guard) || guard <= 0.0) {
            guard = span * 0.5;
        }
        double innerMin = range.min + guard;
        double innerMax = range.max - guard;
        if (innerMax <= innerMin || !std::isfinite(innerMin) || !std::isfinite(innerMax)) {
            const double mid = range.min + span * 0.5;
            innerMin = mid;
            innerMax = mid;
        }
        for (double value : values) {
            if (!std::isfinite(value)) {
                continue;
            }
            value = std::min(std::max(value, innerMin), innerMax);
            if (parameter == CoolProp::iQ) {
                const double epsilon = std::max(1e-6, span * 1e-3);
                value = std::min(std::max(value, range.min + epsilon), range.max - epsilon);
            }
            sanitized.push_back(value);
        }

        if (sanitized.empty()) {
            return false;
        }

        const int points = 50;
        std::cerr << "range min=" << range.min << " max=" << range.max << std::endl;
        for (double value : sanitized) {
            std::cerr << " value candidate=" << value << std::endl;
        }

        const Isolines curves = plot.calc_isolines(parameter, sanitized, points);
        if (curves.empty()) {
            return false;
        }
        const bool finite = has_finite_sample(curves.front());
        std::cerr << "can_generate_isoline success " << static_cast<int>(parameter) << " finite=" << finite << std::endl;
        return finite;
    } catch (...) {
        std::cerr << "can_generate_isoline exception for parameter " << static_cast<int>(parameter) << std::endl;
        return false;
    }
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
            std::cerr << "Built plot for fluid " << fluid << std::endl;

            PlotTypeDescriptor descriptor;
            descriptor.id = definition.id;
            descriptor.label = definition.label;
            descriptor.xAxis = make_axis_metadata(definition.xParameter, plot.xaxis);
            descriptor.yAxis = make_axis_metadata(definition.yParameter, plot.yaxis);

            std::vector<CoolProp::parameters> supported = plot.supported_isoline_keys();
            std::cerr << "Supported count: " << supported.size() << std::endl;
            std::vector<CoolProp::parameters> filtered;
            filtered.reserve(supported.size());
            for (auto parameter : supported) {
                std::cerr << "Checking parameter " << static_cast<int>(parameter) << std::endl;
                if (can_generate_isoline(definition, plot, parameter)) {
                    filtered.push_back(parameter);
                }
            }

            ensure_axis_parameters(definition, filtered);

            std::cerr << "Filtered count: " << filtered.size() << std::endl;
            descriptor.isolineOptions.reserve(filtered.size());
            for (auto parameter : filtered) {
                try {
                    std::cerr << "Range for parameter " << static_cast<int>(parameter) << std::endl;
                    descriptor.isolineOptions.push_back(make_parameter_range(parameter, range_for_parameter(definition, plot, parameter)));
                } catch (...) {
                    // Unexpected failures: skip problematic parameters
                    std::cerr << "Failed to get range for parameter " << static_cast<int>(parameter) << std::endl;
                }
            }

            catalogue.plots.push_back(descriptor);
            std::cerr << "Added plot descriptor with " << descriptor.isolineOptions.size() << " isolines" << std::endl;
        } catch (...) {
            // If plot cannot be constructed for this fluid, skip it silently
            std::cerr << "Failed to build plot for fluid " << fluid << std::endl;
        }
    }

    std::cerr << "Returning catalogue with " << catalogue.plots.size() << " plots" << std::endl;

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

    std::vector<CoolProp::parameters> supported = plot.supported_isoline_keys();
    std::vector<CoolProp::parameters> filtered;
    filtered.reserve(supported.size());
    for (auto parameter : supported) {
        if (can_generate_isoline(*definition, plot, parameter)) {
            filtered.push_back(parameter);
        }
    }

    ensure_axis_parameters(*definition, filtered);

    result.availableIsolines.reserve(filtered.size());
    for (auto parameter : filtered) {
        try {
            result.availableIsolines.push_back(make_parameter_range(parameter, range_for_parameter(*definition, plot, parameter)));
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
        if (is_axis_parameter(*definition, parameter)) {
            const int axisPoints = std::max(points, 2);
            for (double value : values) {
                IsolineCurve curve = (parameter == definition->xParameter)
                                         ? make_vertical_isoline(value, axisPoints, plot, *definition)
                                         : make_horizontal_isoline(value, axisPoints, plot, *definition);
                result.isolines.push_back(std::move(curve));
            }
        } else {
            const auto isolines = plot.calc_isolines(parameter, values, points);
            for (const auto& isoline : isolines) {
                IsolineCurve curve;
                curve.parameter = static_cast<int>(parameter);
                curve.value = isoline.value;
                curve.x = isoline.x;
                curve.y = isoline.y;
                result.isolines.push_back(curve);
            }
        }
        result.generatedIsolines.push_back(make_parameter_range(parameter, usedRange));
        generatedParameters.insert(static_cast<int>(parameter));
    }

    const auto saturationParameter = CoolProp::iQ;
    const bool supportsSaturation = std::find(filtered.begin(), filtered.end(), saturationParameter) != filtered.end();
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
