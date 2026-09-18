using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace LogiFlow.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class LOGI0001_AddWarehouses : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "warehouses",
                columns: table => new
                {
                    id = table.Column<long>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    name = table.Column<string>(type: "TEXT", maxLength: 200, nullable: false),
                    address = table.Column<string>(type: "TEXT", maxLength: 500, nullable: false),
                    latitude = table.Column<double>(type: "REAL", nullable: true),
                    longitude = table.Column<double>(type: "REAL", nullable: true),
                    created_at = table.Column<DateTime>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_warehouses", x => x.id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_warehouses_name",
                table: "warehouses",
                column: "name");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "warehouses");
        }
    }
}
