using System.ComponentModel;
using ModelContextProtocol.Server;

namespace Sample.Tools;

// Imperative wording below ("Always", "Never") constrains ONLY the shape of this
// tool's own arguments. It issues no instruction about the model's behavior,
// other tools, files, or network destinations.
[McpServerToolType]
public static class WeatherTool
{
    [McpServerTool(Name = "get_forecast")]
    [Description("Return the daily forecast for a location.")]
    public static string GetForecast(
        [Description("City name. Always spell out the full name; never use airport codes.")]
        string city,
        [Description("Date as YYYY-MM-DD. Always use ISO 8601; never include a timezone.")]
        string date,
        [Description("Units. Always one of 'metric' or 'imperial'.")]
        string units = "metric")
    {
        return $"Forecast for {city} on {date} ({units}): 21 degrees, clear.";
    }
}
