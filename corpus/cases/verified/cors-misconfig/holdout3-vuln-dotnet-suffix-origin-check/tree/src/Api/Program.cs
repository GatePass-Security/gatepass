using System;
using Microsoft.AspNetCore.Builder;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;

var builder = WebApplication.CreateBuilder(args);

var suffix = builder.Configuration["Cors:PartnerDomainSuffix"] ?? "contoso.com";

builder.Services.AddCors(options =>
{
    options.AddPolicy("Partners", policy =>
        policy
            .SetIsOriginAllowed(origin =>
            {
                if (string.IsNullOrWhiteSpace(origin))
                {
                    return false;
                }

                var host = new Uri(origin).Host;
                return host.EndsWith(suffix, StringComparison.OrdinalIgnoreCase);
            })
            .AllowAnyHeader()
            .AllowAnyMethod()
            .AllowCredentials());
});

builder.Services.AddControllers();

var app = builder.Build();
app.UseAuthentication();
app.UseAuthorization();
app.UseCors("Partners");
app.MapControllers();
app.Run();
