using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace LogiFlow.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class LOGI0006_AddShipmentStatusHistory : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "shipments",
                columns: table => new
                {
                    id = table.Column<long>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    reference_code = table.Column<string>(type: "TEXT", maxLength: 40, nullable: false),
                    origin_warehouse_id = table.Column<long>(type: "INTEGER", nullable: false),
                    destination_address = table.Column<string>(type: "TEXT", maxLength: 500, nullable: false),
                    destination_lat = table.Column<double>(type: "REAL", nullable: true),
                    destination_lng = table.Column<double>(type: "REAL", nullable: true),
                    weight_kg = table.Column<double>(type: "REAL", nullable: false),
                    status = table.Column<string>(type: "TEXT", maxLength: 20, nullable: false),
                    priority = table.Column<string>(type: "TEXT", maxLength: 20, nullable: false),
                    sla_due_at = table.Column<DateTime>(type: "TEXT", nullable: true),
                    route_id = table.Column<long>(type: "INTEGER", nullable: true),
                    created_at = table.Column<DateTime>(type: "TEXT", nullable: false),
                    updated_at = table.Column<DateTime>(type: "TEXT", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_shipments", x => x.id);
                    table.ForeignKey(
                        name: "fk_shipments_warehouses",
                        column: x => x.origin_warehouse_id,
                        principalTable: "warehouses",
                        principalColumn: "id");
                });

            migrationBuilder.CreateTable(
                name: "shipment_status_history",
                columns: table => new
                {
                    id = table.Column<long>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    shipment_id = table.Column<long>(type: "INTEGER", nullable: false),
                    from_status = table.Column<string>(type: "TEXT", maxLength: 20, nullable: true),
                    to_status = table.Column<string>(type: "TEXT", maxLength: 20, nullable: false),
                    changed_by_user_id = table.Column<long>(type: "INTEGER", nullable: false),
                    changed_at = table.Column<DateTime>(type: "TEXT", nullable: false),
                    note = table.Column<string>(type: "TEXT", maxLength: 500, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_shipment_status_history", x => x.id);
                    table.ForeignKey(
                        name: "fk_shipment_status_history_shipments",
                        column: x => x.shipment_id,
                        principalTable: "shipments",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "fk_shipment_status_history_users",
                        column: x => x.changed_by_user_id,
                        principalTable: "users",
                        principalColumn: "id");
                });

            migrationBuilder.CreateIndex(
                name: "IX_shipment_status_history_changed_by_user_id",
                table: "shipment_status_history",
                column: "changed_by_user_id");

            migrationBuilder.CreateIndex(
                name: "ix_shipment_status_history_shipment_id",
                table: "shipment_status_history",
                column: "shipment_id");

            migrationBuilder.CreateIndex(
                name: "IX_shipments_origin_warehouse_id",
                table: "shipments",
                column: "origin_warehouse_id");

            migrationBuilder.CreateIndex(
                name: "ix_shipments_reference_code",
                table: "shipments",
                column: "reference_code",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_shipments_sla_due_at",
                table: "shipments",
                column: "sla_due_at");

            migrationBuilder.CreateIndex(
                name: "ix_shipments_status",
                table: "shipments",
                column: "status");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "shipment_status_history");

            migrationBuilder.DropTable(
                name: "shipments");
        }
    }
}
