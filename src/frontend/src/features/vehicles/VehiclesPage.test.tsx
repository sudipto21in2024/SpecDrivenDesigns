import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { seedVehicle } from '../../mocks/handlers';
import { renderAppAs, resetMocks } from '../../test/renderApp';

beforeEach(() => {
  resetMocks();
});

/** Renders the app as `role` on the default tab (warehouses) — the Tabs chrome with the vehicles tab only renders once the session restores. */
async function renderVehiclesTab(role: 'Admin' | 'Dispatcher' | 'Viewer' | 'Driver' = 'Admin') {
  const user = userEvent.setup();
  renderAppAs(role);
  await user.click(await screen.findByTestId('tab-vehicles'));
  return user;
}

describe('VehiclesPage (LOGI-0004)', () => {
  it('AC-1/AC-7: lists vehicles in the paged table', async () => {
    seedVehicle({ plateNumber: 'RT-8421-X' });
    await renderVehiclesTab();

    expect(await screen.findByRole('table', { name: 'Vehicles table' })).toBeInTheDocument();
    expect(screen.getByText('RT-8421-X')).toBeInTheDocument();
  });

  it('AC-1: creates a vehicle via the dialog and shows a success message', async () => {
    const user = await renderVehiclesTab();

    await user.click(screen.getByRole('button', { name: 'New Vehicle' }));
    await user.type(screen.getByLabelText('Vehicle plate number'), 'RT-9000-Z');
    await user.type(screen.getByLabelText('Vehicle capacity'), '12000');
    await user.click(screen.getByTestId('vehicle-submit'));

    expect(await screen.findByText('RT-9000-Z')).toBeInTheDocument();
    expect(screen.getByText('Vehicle created')).toBeInTheDocument();
  });

  it('AC-3: duplicate plate surfaces a plate field error', async () => {
    seedVehicle({ plateNumber: 'RT-DUP-1' });
    const user = await renderVehiclesTab();

    await user.click(screen.getByRole('button', { name: 'New Vehicle' }));
    await user.type(screen.getByLabelText('Vehicle plate number'), 'RT-DUP-1');
    await user.type(screen.getByLabelText('Vehicle capacity'), '12000');
    await user.click(screen.getByTestId('vehicle-submit'));

    expect(await screen.findByText(/already exists/)).toBeInTheDocument();
  });

  it('AC-5/AC-2: client-side validation rejects empty plate and non-positive capacity', async () => {
    const user = await renderVehiclesTab();

    await user.click(screen.getByRole('button', { name: 'New Vehicle' }));
    // Touch capacity with an invalid value; plate left empty.
    await user.type(screen.getByLabelText('Vehicle capacity'), '0');
    await user.click(screen.getByTestId('vehicle-submit'));

    expect(await screen.findByText('Plate number is required')).toBeInTheDocument();
    expect(screen.getByText('Capacity must be greater than 0')).toBeInTheDocument();
  });

  it('AC-9: viewer sees the list but no write affordances', async () => {
    seedVehicle({ plateNumber: 'RT-1111-A' });
    await renderVehiclesTab('Viewer');

    expect(await screen.findByText('RT-1111-A')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'New Vehicle' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Edit / })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Delete / })).not.toBeInTheDocument();
  });

  it('AC-9: dispatcher can create but sees no delete action', async () => {
    seedVehicle({ plateNumber: 'RT-2222-B' });
    await renderVehiclesTab('Dispatcher');

    expect(await screen.findByText('RT-2222-B')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New Vehicle' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Delete / })).not.toBeInTheDocument();
  });

  it('AC-8: deletes a vehicle after confirmation', async () => {
    seedVehicle({ plateNumber: 'RT-DEL-1' });
    const user = await renderVehiclesTab();

    const row = await screen.findByText('RT-DEL-1');
    const tableRow = row.closest('tr')!;
    await user.click(within(tableRow).getByRole('button', { name: 'Delete RT-DEL-1' }));
    await user.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(screen.queryByText('RT-DEL-1')).not.toBeInTheDocument());
    expect(screen.getByText('Vehicle deleted')).toBeInTheDocument();
  });
});
