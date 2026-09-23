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

        // LOGI-0004 vehicle use cases (same per-type convention).
        services.AddScoped<IValidator<Features.Vehicles.CreateVehicleCommand>, Features.Vehicles.CreateVehicleValidator>();
        services.AddScoped<IValidator<Features.Vehicles.UpdateVehicleCommand>, Features.Vehicles.UpdateVehicleValidator>();
        services.AddScoped<IValidator<Features.Vehicles.ListVehiclesQuery>, Features.Vehicles.ListVehiclesValidator>();

        // LOGI-0005 driver use cases (same per-type convention).
        services.AddScoped<IValidator<Features.Drivers.CreateDriverCommand>, Features.Drivers.CreateDriverValidator>();
        services.AddScoped<IValidator<Features.Drivers.UpdateDriverCommand>, Features.Drivers.UpdateDriverValidator>();
        services.AddScoped<IValidator<Features.Drivers.ListDriversQuery>, Features.Drivers.ListDriversValidator>();

        // LOGI-0006 shipment status lifecycle use cases (same per-type convention).
        services.AddScoped<IValidator<Features.Shipments.TransitionShipmentStatusCommand>, Features.Shipments.TransitionShipmentStatusValidator>();
        services.AddScoped<IValidator<Features.Shipments.ListShipmentStatusHistoryQuery>, Features.Shipments.ListShipmentStatusHistoryValidator>();

        // LOGI-0007 create shipment + list/search use cases (same per-type convention).
        services.AddScoped<IValidator<Features.Shipments.CreateShipmentCommand>, Features.Shipments.CreateShipmentValidator>();
        services.AddScoped<IValidator<Features.Shipments.ListShipmentsQuery>, Features.Shipments.ListShipmentsValidator>();

        // LOGI-0003 auth use cases. Registered per-type (not assembly-scanned) to match the existing
        // convention and keep the pipeline's validator set explicit.
        services.AddScoped<IValidator<Features.Auth.LoginCommand>, Features.Auth.LoginCommandValidator>();
        services.AddScoped<IValidator<Features.Auth.RefreshCommand>, Features.Auth.RefreshCommandValidator>();
        services.AddScoped<IValidator<Features.Auth.LogoutCommand>, Features.Auth.LogoutCommandValidator>();

        services.AddScoped(typeof(IPipelineBehavior<,>), typeof(ValidationBehavior<,>));

        return services;
    }
}
