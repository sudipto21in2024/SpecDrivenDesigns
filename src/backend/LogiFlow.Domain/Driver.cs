namespace LogiFlow.Domain;

/// <summary>
/// A driver that routes can later be assigned to (LOGI-0005, PRD F3). Master data.
/// Status is stored as TEXT (SQLite); the closed value set (Active/OffDuty/Suspended) is
/// enforced by Application validators, mirroring how the vehicle enums are handled.
/// The optional UserId links the driver to a login account (User 1---1 Driver, approved
/// schema entity overview); the at-most-one-driver-per-user rule is enforced by the
/// Application handlers — the approved schema deliberately has no unique index on user_id.
/// No CreatedAt: the approved schema §drivers defines no created_at column.
/// </summary>
public class Driver
{
    public long Id { get; set; }
    public string FullName { get; private set; } = null!;
    public string LicenseNumber { get; private set; } = null!;
    public string? Phone { get; private set; }
    public string Status { get; private set; } = null!;
    public long? UserId { get; private set; }

    /// <summary>Creates a new driver. Invariant validation happens in Application validators.</summary>
    public static Driver Create(string fullName, string licenseNumber, string? phone, string status, long? userId) =>
        new()
        {
            FullName = fullName.Trim(),
            LicenseNumber = licenseNumber.Trim(),
            Phone = string.IsNullOrWhiteSpace(phone) ? null : phone.Trim(),
            Status = status,
            UserId = userId,
        };

    /// <summary>Full update of mutable fields (v1: all fields except id are mutable; a null userId clears the link).</summary>
    public void Update(string fullName, string licenseNumber, string? phone, string status, long? userId)
    {
        FullName = fullName.Trim();
        LicenseNumber = licenseNumber.Trim();
        Phone = string.IsNullOrWhiteSpace(phone) ? null : phone.Trim();
        Status = status;
        UserId = userId;
    }
}