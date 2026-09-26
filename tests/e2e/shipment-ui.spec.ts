import { expect, test } from '@playwright/test';
import { ShipmentsPage } from './pages/shipments.page';
import { seedWarehouse, signIn } from './support/api';
import { createShipment, getShipment } from './support/shipments';
import { seedShipmentAt } from './support/shipments';

// LOGI-0008 M2: AC-11 UI seam on real stack (accessible selectors only).
const runTag = `e2e${Date.now().toString(36)}u`;
let seq = 0;
test.describe('LOGI-0008 shipment UI seam', () => {
  test('AC-11 row actions follow role x status matrix // LOGI-0008 AC-11', async ({ page, request }) => {
    const admin = (await signIn(request, 'Admin')).accessToken;
    const disp = (await signIn(request, 'Dispatcher')).accessToken;
    const wh = await seedWarehouse(request, admin, `${runTag} WH ${seq++}`);
    const created = await createShipment(request, disp, { originWarehouseId: wh, destinationAddress: '12 Dock Road', weightKg: 10 });
    const pendingRef = String(created.body.referenceCode);
    const assigned = await seedShipmentAt(request, admin, { status: 'Assigned', warehouseId: wh });
    const transit = await seedShipmentAt(request, admin, { status: 'InTransit', warehouseId: wh });
    const shipments = new ShipmentsPage(page);
    await shipments.goto('Admin');
    await shipments.search(pendingRef);
    await expect(shipments.rowEditButton(pendingRef)).toBeVisible();
    await expect(shipments.rowCancelButton(pendingRef)).toBeVisible();
    await shipments.clearFilters();
    await shipments.search(assigned.referenceCode);
    await expect(shipments.rowCancelButton(assigned.referenceCode)).toBeVisible();
    await expect(shipments.rowEditButton(assigned.referenceCode)).toHaveCount(0);
    await shipments.clearFilters();
    await shipments.search(transit.referenceCode);
    await expect(shipments.rowCancelButton(transit.referenceCode)).toHaveCount(0);
    const viewerPage = new ShipmentsPage(page);
    await viewerPage.goto('Viewer');
    await viewerPage.search(pendingRef);
    await expect(viewerPage.rowEditButton(pendingRef)).toHaveCount(0);
    await expect(viewerPage.rowCancelButton(pendingRef)).toHaveCount(0);
  });
  test('AC-11 edit dialog saves PATCH cancel needs confirm // LOGI-0008 AC-11', async ({ page, request }) => {
    const admin = (await signIn(request, 'Admin')).accessToken;
    const disp = (await signIn(request, 'Dispatcher')).accessToken;
    const wh = await seedWarehouse(request, admin, `${runTag} WH ${seq++}`);
    const created = await createShipment(request, disp, { originWarehouseId: wh, destinationAddress: '12 Dock Road', weightKg: 10 });
    const ref = String(created.body.referenceCode);
    const id = Number(created.body.id);
    const shipments = new ShipmentsPage(page);
    await shipments.goto('Dispatcher');
    await shipments.search(ref);
    await shipments.openEdit(ref);
    await page.getByLabel('Destination address').fill('77 Edited Quay, Antwerp');
    await shipments.saveEdit();
    await shipments.expectSnackbar(new RegExp(`Shipment ${ref} updated`));
    await expect(shipments.row(ref)).toContainText('77 Edited Quay, Antwerp');
    await shipments.openCancel(ref);
    await shipments.confirmCancel('Customer withdrew the order');
    await shipments.expectSnackbar(new RegExp(`Shipment ${ref} cancelled`));
    expect((await getShipment(request, disp, id)).body?.status).toBe('Cancelled');
  });
});
