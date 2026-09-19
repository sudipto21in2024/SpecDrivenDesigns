using LogiFlow.Application.Abstractions;
using LogiFlow.Domain;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;

namespace LogiFlow.Infrastructure.Persistence;

/// <summary>
/// EF Core DbContext for LogiFlow. Column/table names mirror 04-database-schema.md
/// (snake_case tables/columns, ISO8601 UTC timestamps as TEXT).
///
/// Derives from Identity's context so password hashing and user storage are framework-managed
/// (ADR-007). The LogiFlow <c>users</c> table is the Identity user table; its companion
/// Identity tables (roles, claims, logins, tokens) are additionally mapped into snake_case so the
/// database stays consistent and self-describing. In v1 those tables are the framework's business
/// and are unused by domain code, because the role is a scalar <c>users.role</c> column.
/// </summary>
public class LogiFlowDbContext(DbContextOptions<LogiFlowDbContext> options)
    : IdentityDbContext<AppUser, IdentityRole<long>, long>(options), IAppDbContext
{
    public DbSet<Warehouse> Warehouses => Set<Warehouse>();

    public DbSet<RefreshToken> RefreshTokens => Set<RefreshToken>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);

        modelBuilder.Entity<Warehouse>(entity =>
        {
            entity.ToTable("warehouses");
            entity.HasKey(w => w.Id);
            entity.Property(w => w.Id).HasColumnName("id").ValueGeneratedOnAdd();
            entity.Property(w => w.Name).HasColumnName("name").IsRequired().HasMaxLength(200);
            entity.Property(w => w.Address).HasColumnName("address").IsRequired().HasMaxLength(500);
            entity.Property(w => w.Latitude).HasColumnName("latitude");
            entity.Property(w => w.Longitude).HasColumnName("longitude");
            entity.Property(w => w.CreatedAt).HasColumnName("created_at");
            entity.HasIndex(w => w.Name);
        });

        ConfigureIdentityTables(modelBuilder);
        ConfigureRefreshTokens(modelBuilder);
    }

    /// <summary>
    /// Maps Identity plus the LogiFlow-specific user columns onto the schema's snake_case
    /// <c>users</c> table (04-database-schema.md). Identity's companion tables are renamed to the
    /// same convention so nothing in the database is left in PascalCase.
    /// </summary>
    private static void ConfigureIdentityTables(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<AppUser>(entity =>
        {
            entity.ToTable("users");
            entity.Property(u => u.Id).HasColumnName("id").ValueGeneratedOnAdd();
            entity.Property(u => u.Email).HasColumnName("email").HasMaxLength(256);
            entity.Property(u => u.NormalizedEmail).HasColumnName("normalized_email").HasMaxLength(256);
            entity.Property(u => u.UserName).HasColumnName("user_name").HasMaxLength(256);
            entity.Property(u => u.NormalizedUserName).HasColumnName("normalized_user_name").HasMaxLength(256);
            entity.Property(u => u.PasswordHash).HasColumnName("password_hash");
            entity.Property(u => u.SecurityStamp).HasColumnName("security_stamp");
            entity.Property(u => u.ConcurrencyStamp).HasColumnName("concurrency_stamp");
            entity.Property(u => u.EmailConfirmed).HasColumnName("email_confirmed");
            entity.Property(u => u.PhoneNumber).HasColumnName("phone_number");
            entity.Property(u => u.PhoneNumberConfirmed).HasColumnName("phone_number_confirmed");
            entity.Property(u => u.TwoFactorEnabled).HasColumnName("two_factor_enabled");
            entity.Property(u => u.LockoutEnd).HasColumnName("lockout_end");
            entity.Property(u => u.LockoutEnabled).HasColumnName("lockout_enabled");
            entity.Property(u => u.AccessFailedCount).HasColumnName("access_failed_count");

            // LogiFlow additions to the Identity user (LOGI-0003).
            entity.Property(u => u.FullName).HasColumnName("full_name").IsRequired().HasMaxLength(200);
            entity.Property(u => u.Role).HasColumnName("role").IsRequired().HasMaxLength(32);

            // Email is the login identifier, so uniqueness is both a data rule and the guarantee that
            // two concurrent registrations cannot both succeed. Lookups go through the normalised
            // column, so the index lives there (matching `email TEXT NOT NULL UNIQUE` in the schema).
            entity.HasIndex(u => u.NormalizedEmail).IsUnique().HasDatabaseName("ix_users_normalized_email");
        });

        modelBuilder.Entity<IdentityRole<long>>(entity =>
        {
            entity.ToTable("roles");
            entity.Property(r => r.Id).HasColumnName("id").ValueGeneratedOnAdd();
            entity.Property(r => r.Name).HasColumnName("name").HasMaxLength(256);
            entity.Property(r => r.NormalizedName).HasColumnName("normalized_name").HasMaxLength(256);
            entity.Property(r => r.ConcurrencyStamp).HasColumnName("concurrency_stamp");
        });

        modelBuilder.Entity<IdentityUserRole<long>>(entity =>
        {
            entity.ToTable("user_roles");
            entity.Property(r => r.UserId).HasColumnName("user_id");
            entity.Property(r => r.RoleId).HasColumnName("role_id");
        });

        modelBuilder.Entity<IdentityUserClaim<long>>(entity =>
        {
            entity.ToTable("user_claims");
            entity.Property(c => c.Id).HasColumnName("id").ValueGeneratedOnAdd();
            entity.Property(c => c.UserId).HasColumnName("user_id");
            entity.Property(c => c.ClaimType).HasColumnName("claim_type");
            entity.Property(c => c.ClaimValue).HasColumnName("claim_value");
        });

        modelBuilder.Entity<IdentityUserLogin<long>>(entity =>
        {
            entity.ToTable("user_logins");
            entity.Property(l => l.LoginProvider).HasColumnName("login_provider");
            entity.Property(l => l.ProviderKey).HasColumnName("provider_key");
            entity.Property(l => l.ProviderDisplayName).HasColumnName("provider_display_name");
            entity.Property(l => l.UserId).HasColumnName("user_id");
        });

        modelBuilder.Entity<IdentityUserToken<long>>(entity =>
        {
            entity.ToTable("user_tokens");
            entity.Property(t => t.LoginProvider).HasColumnName("login_provider");
            entity.Property(t => t.Name).HasColumnName("name");
            entity.Property(t => t.UserId).HasColumnName("user_id");
            entity.Property(t => t.Value).HasColumnName("value");
        });

        modelBuilder.Entity<IdentityRoleClaim<long>>(entity =>
        {
            entity.ToTable("role_claims");
            entity.Property(c => c.Id).HasColumnName("id").ValueGeneratedOnAdd();
            entity.Property(c => c.RoleId).HasColumnName("role_id");
            entity.Property(c => c.ClaimType).HasColumnName("claim_type");
            entity.Property(c => c.ClaimValue).HasColumnName("claim_value");
        });
    }

    private static void ConfigureRefreshTokens(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<RefreshToken>(entity =>
        {
            entity.ToTable("refresh_tokens");
            entity.HasKey(t => t.Id);
            entity.Property(t => t.Id).HasColumnName("id").ValueGeneratedOnAdd();
            entity.Property(t => t.UserId).HasColumnName("user_id").IsRequired();
            entity.Property(t => t.TokenHash).HasColumnName("token_hash").IsRequired().HasMaxLength(64);
            entity.Property(t => t.ExpiresAt).HasColumnName("expires_at").IsRequired();
            entity.Property(t => t.CreatedAt).HasColumnName("created_at").IsRequired();
            entity.Property(t => t.RevokedAt).HasColumnName("revoked_at");

            // The hash is the lookup key for every exchange, so uniqueness is a correctness
            // requirement (no ambiguous lookup) as well as a query-performance one.
            entity.HasIndex(t => t.TokenHash).IsUnique().HasDatabaseName("ix_refresh_tokens_token_hash");

            // Deleting a user removes their sessions; a refresh token must not outlive its owner.
            entity.HasOne<AppUser>()
                .WithMany()
                .HasForeignKey(t => t.UserId)
                .HasConstraintName("fk_refresh_tokens_users")
                .OnDelete(DeleteBehavior.Cascade);
        });
    }
}
