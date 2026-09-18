namespace LogiFlow.Infrastructure;

public static class SeedData
{
    /// <summary>
    /// Seeds master/reference data for development and test environments only.
    /// Called from Program when env is Development or Testing.
    /// </summary>
    public static async Task EnsureSeededAsync(CancellationToken ct = default)
    {
        // NOOP until LOGI-0001 (warehouses) and LOGI-0003 (auth/roles) land.
        await Task.CompletedTask;
    }
}
