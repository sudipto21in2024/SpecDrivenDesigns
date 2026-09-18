using FluentValidation;
using LogiFlow.Application.Behaviors;
using LogiFlow.Application.Messaging;
using MediatR;
using Microsoft.Extensions.DependencyInjection;

namespace LogiFlow.Application;

public static class DependencyInjection
{
    /// <summary>Registers MediatR (assembly scan), per-use-case validators and pipeline behaviors
    /// per 07-coding-standards.md §Backend.</summary>
    public static IServiceCollection AddApplication(this IServiceCollection services)
    {
        services.AddMediatR(cfg => cfg.RegisterServicesFromAssembly(typeof(DependencyInjection).Assembly));

        services.AddScoped<IValidator<Features.Warehouses.CreateWarehouseCommand>, Features.Warehouses.CreateWarehouseValidator>();
        services.AddScoped<IValidator<Features.Warehouses.UpdateWarehouseCommand>, Features.Warehouses.UpdateWarehouseValidator>();
        services.AddScoped<IValidator<Features.Warehouses.ListWarehousesQuery>, Features.Warehouses.ListWarehousesValidator>();
        services.AddScoped(typeof(IPipelineBehavior<,>), typeof(ValidationBehavior<,>));

        return services;
    }
}
