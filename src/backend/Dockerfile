# syntax=docker/dockerfile:1
#
# LogiFlow API — multi-stage build.
# Stage 1 restores and publishes the ASP.NET Core project; stage 2 carries only
# the published output on the ASP.NET base image (no SDK, no source).

FROM mcr.microsoft.com/dotnet/sdk:9.0 AS build
WORKDIR /src

# Solution-wide restore first (layer cache friendly): copy only the project
# manifests, restore, then copy the sources.
COPY Directory.Packages.props ./
COPY LogiFlow.sln ./
COPY LogiFlow.Domain/LogiFlow.Domain.csproj LogiFlow.Domain/
COPY LogiFlow.Application/LogiFlow.Application.csproj LogiFlow.Application/
COPY LogiFlow.Infrastructure/LogiFlow.Infrastructure.csproj LogiFlow.Infrastructure/
COPY LogiFlow.Api/LogiFlow.Api.csproj LogiFlow.Api/
COPY LogiFlow.Api.Tests/LogiFlow.Api.Tests.csproj LogiFlow.Api.Tests/
RUN dotnet restore LogiFlow.Api/LogiFlow.Api.csproj

COPY . .
RUN dotnet publish LogiFlow.Api/LogiFlow.Api.csproj \
    -c Release \
    -o /app/publish \
    --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:9.0 AS runtime
WORKDIR /app

# SQLite (ADR-005) writes logiflow.db plus its -wal/-shm siblings into the working
# directory, so it has to be a writable volume mount point owned by the runtime user.
RUN mkdir -p /app/data /app/Logs \
 && apt-get update \
 && apt-get install -y --no-install-recommends curl \
 && rm -rf /var/lib/apt/lists/* \
 && chown -R app:app /app

COPY --from=build --chown=app:app /app/publish .

USER app

ENV ASPNETCORE_ENVIRONMENT=Production \
    ASPNETCORE_URLS=http://+:8080
# Absolute path so the SQLite file does not depend on the container's working directory.
ENV Database__ConnectionString="Data Source=/app/data/logiflow.db"

EXPOSE 8080

# The health endpoint is anonymous (Program.cs), so no token is needed.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://localhost:8080/api/v1/health || exit 1

ENTRYPOINT ["dotnet", "LogiFlow.Api.dll"]