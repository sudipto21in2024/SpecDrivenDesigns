using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace LogiFlow.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class LOGI0009_AddRoutes : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "routes",
                columns: table => new
                {
                    id = table.Column<long>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    name = table.Column<string>(type: "TEXT", maxLength: 200, nullable: false),
                    planned_start = table.Column<DateTime>(type: "TEXT", nullable: false),
                    planned_end = table.Column<DateTime>(type: "TEXT", nullable: false),
                    actual_start = table.Column<DateTime>(type: "TEXT", nullable: true),
                    actual_end = table.Column<DateTime>(type: "TEXT", nullable: true),
                    vehicle_id = table.Column<long>(type: "INTEGER", nullable: true),
                    driver_id = table.Column<long>(type: "INTEGER", nullable: true),
                    status = table.Column<string>(type: "TEXT", maxLength: 20, nullable: false),
                    created_at = table.Column<DateTime>(type: "TEXT", nullable: false),
                    updated_at = table.Column<DateTime>(type: "TEXT", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_routes", x => x.id);
                    table.ForeignKey(
                        name: "fk_routes_drivers",
                        column: x => x.driver_id,
                        principalTable: "drivers",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_routes_vehicles",
                        column: x => x.vehicle_id,
                        principalTable: "vehicles",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "ix_routes_driver_id",
                table: "routes",
                column: "driver_id");

            migrationBuilder.CreateIndex(
                name: "ix_routes_status",
                table: "routes",
                column: "status");

            migrationBuilder.CreateIndex(
                name: "ix_routes_vehicle_id",
                table: "routes",
                column: "vehicle_id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "routes");
        }
    }
}
