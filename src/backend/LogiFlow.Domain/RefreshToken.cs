namespace LogiFlow.Domain;

/// <summary>
/// An opaque, rotating refresh token (ADR-007).
///
/// Only the SHA-256 <see cref="TokenHash"/> is persisted, so a database disclosure does not yield
/// usable credentials; the raw token value exists only in the HTTP response that issued it.
/// Rotation semantics: a token is revoked in the same transaction that issues its replacement, and
/// <see cref="IsActive"/> gates both exchange and reuse detection.
/// </summary>
public class RefreshToken
{
    public long Id { get; private set; }

    /// <summary>Owner. FK → <c>users.id</c> (cascade delete).</summary>
    public long UserId { get; private set; }

    /// <summary>SHA-256 hash of the raw token, hex-encoded. Unique — lookups are by hash.</summary>
    public string TokenHash { get; private set; } = null!;

    /// <summary>ISO8601 UTC instant after which the token can no longer be exchanged (7 days, ADR-007).</summary>
    public DateTime ExpiresAt { get; private set; }

    /// <summary>ISO8601 UTC instant the token was issued.</summary>
    public DateTime CreatedAt { get; private set; }

    /// <summary>Set on rotation or logout; NULL means "never revoked".</summary>
    public DateTime? RevokedAt { get; private set; }

    /// <summary>A token can be exchanged only while it is neither revoked nor expired.</summary>
    public bool IsActive(DateTime nowUtc) => RevokedAt is null && ExpiresAt > nowUtc;

    /// <summary>Issues a new refresh token record for a user.</summary>
    public static RefreshToken Issue(long userId, string tokenHash, DateTime createdAtUtc, DateTime expiresAtUtc) =>
        new()
        {
            UserId = userId,
            TokenHash = tokenHash,
            CreatedAt = createdAtUtc,
            ExpiresAt = expiresAtUtc,
        };

    /// <summary>
    /// Revokes the token. Idempotent: the first revocation timestamp is preserved so a later
    /// reuse attempt cannot rewrite the audit-relevant moment it was invalidated.
    /// </summary>
    public void Revoke(DateTime nowUtc) => RevokedAt ??= nowUtc;
}