namespace LogiFlow.Application.Common;

/// <summary>Standard pagination envelope per 05-api-contract-standards.md.</summary>
public record PagedResult<T>(IReadOnlyList<T> Items, int Page, int PageSize, int TotalCount, int TotalPages)
{
    public static PagedResult<T> Create(IReadOnlyList<T> items, int page, int pageSize, int totalCount)
    {
        var totalPages = pageSize > 0 ? (int)Math.Ceiling(totalCount / (double)pageSize) : 0;
        return new PagedResult<T>(items, page, pageSize, totalCount, totalPages);
    }
}

/// <summary>Thrown by handlers when a requested resource does not exist; mapped to 404 by the API layer.</summary>
public class NotFoundException(string resource, object key)
    : Exception($"{resource} with id '{key}' was not found.");
