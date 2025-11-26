#ifndef COOLPROP_PLOTDATAMODULE_H_
#define COOLPROP_PLOTDATAMODULE_H_

#include "CoolProp.h"
#include "CoolPropPlot.h"

#include <string>
#include <vector>

namespace CoolProp {
namespace Plot {

struct AxisMetadata {
    int parameter;
    Scale scale;
    Range range;
};

struct ParameterRange {
    int parameter;
    Range range;
};

struct PlotTypeDescriptor {
    std::string id;
    std::string label;
    AxisMetadata xAxis;
    AxisMetadata yAxis;
    std::vector<ParameterRange> isolineOptions;
};

struct PlotCatalogue {
    std::string fluid;
    std::vector<PlotTypeDescriptor> plots;
};

struct IsolineSpec {
    int parameter = 0;
    std::vector<double> values;
    int valueCount = 5;
    bool useCustomRange = false;
    Range customRange{0.0, 0.0};
    int points = -1;
};

struct PlotRequest {
    std::string fluid;
    std::string plotId;
    std::vector<IsolineSpec> isolines;
    int defaultPointsPerIsoline = 200;
    bool includeSaturationCurves = true;
};

struct IsolineCurve {
    int parameter = 0;
    double value = 0.0;
    std::vector<double> x;
    std::vector<double> y;
};

struct PlotData {
    std::string fluid;
    std::string plotId;
    AxisMetadata xAxis;
    AxisMetadata yAxis;
    std::vector<IsolineCurve> isolines;
    std::vector<ParameterRange> availableIsolines;
    std::vector<ParameterRange> generatedIsolines;
};

PlotCatalogue describe_fluid_plots(const std::string& fluid);
PlotData build_plot(const PlotRequest& request);

} // namespace Plot
} // namespace CoolProp

#endif // COOLPROP_PLOTDATAMODULE_H_
