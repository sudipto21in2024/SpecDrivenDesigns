import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach } from 'vitest';
import { seedWarehouse } from '../../mocks/handlers';
import { renderAppAs, resetMocks } from '../../test/renderApp';

beforeEach(() => {
  resetMocks();
});

describe('WarehousesPage (LOGI-0001)', () => {
  it('renders warehouses from the API', async () => {
    seedWarehouse({ name: 'Central DC', address: '12 Industrial Rd' });
    seedWarehouse({ name: 'West Hub', address: '1 Harbor Way' });

    renderAppAs('Admin');

    expect(await screen.findByText('Central DC')).toBeInTheDocument();
    expect(screen.getByText('West Hub')).toBeInTheDocument();
    expect(screen.getByText('12 Industrial Rd')).toBeInTheDocument();
  });

  it('shows an empty state when there are no warehouses', async () => {
    renderAppAs('Admin');
    expect(await screen.findByText('No warehouses found')).toBeInTheDocument();
  });

  it('AC-2: blocks create with empty name/address and shows field errors', async () => {
    const user = userEvent.setup();
    renderAppAs('Admin');

    await user.click(await screen.findByRole('button', { name: 'New Warehouse' }));
    await user.click(await screen.findByRole('button', { name: 'Create' }));

    expect(await screen.findByText('Name is required')).toBeInTheDocument();
    expect(screen.getByText('Address is required'));
  });

  it('AC-1: creates a warehouse and shows it in the list', async () => {
    const user = userEvent.setup();
    renderAppAs('Admin');

    await user.click(await screen.findByRole('button', { name: 'New Warehouse' }));
    await user.type(screen.getByLabelText('Warehouse name'), 'West Hub');
    await user.type(screen.getByLabelText('Warehouse address'), '1 Harbor Way');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    expect(await screen.findByText('Warehouse created')).toBeInTheDocument();
    expect(await screen.findByText('West Hub')).toBeInTheDocument();
  });

  it('AC-3: rejects out-of-range latitude before submit', async () => {
    const user = userEvent.setup();
    renderAppAs('Admin');

    await user.click(await screen.findByRole('button', { name: 'New Warehouse' }));
    await user.type(screen.getByLabelText('Warehouse name'), 'Bad Coords');
    await user.type(screen.getByLabelText('Warehouse address'), '1 Harbor Way');
    await user.type(screen.getByLabelText('Warehouse latitude'), '95');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    expect(await screen.findByText('Latitude must be between -90 and 90')).toBeInTheDocument();
  });

  it('AC-6: edits an existing warehouse', async () => {
    const user = userEvent.setup();
    const seeded = seedWarehouse({ name: 'Old Name', address: '1 Old Ave' });
    renderAppAs('Admin');

    await user.click(await screen.findByRole('button', { name: 'Edit warehouse Old Name' }));
    const nameField = screen.getByLabelText('Warehouse name') as HTMLInputElement;
    expect(nameField).toHaveValue('Old Name');
    await user.clear(nameField);
    await user.type(nameField, 'New Name');
    await user.click(screen.getByRole('button', { name: 'Save Changes' }));

    expect(await screen.findByText('Warehouse updated')).toBeInTheDocument();
    expect(await screen.findByText('New Name')).toBeInTheDocument();
    expect(screen.queryByText('Old Name')).not.toBeInTheDocument();
    // Seeded row is actually mutated in the mock store.
    expect(seeded.name).toBe('New Name');
  });

  it('AC-7: deletes a warehouse after confirmation', async () => {
    const user = userEvent.setup();
    seedWarehouse({ name: 'Doomed DC', address: '9 Gone St' });
    renderAppAs('Admin');

    await user.click(await screen.findByRole('button', { name: 'Delete warehouse Doomed DC' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete warehouse' });
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

    expect(await screen.findByText('Warehouse deleted')).toBeInTheDocument();
    expect(await screen.findByText('No warehouses found')).toBeInTheDocument();
  });

  it('AC-4: search filters by name', async () => {
    const user = userEvent.setup();
    seedWarehouse({ name: 'Central DC' });
    seedWarehouse({ name: 'West Hub' });
    renderAppAs('Admin');

    await user.type(await screen.findByLabelText('Search by name'), 'west');
    await user.click(screen.getByRole('button', { name: 'Search warehouses' }));

    expect(await screen.findByText('West Hub')).toBeInTheDocument();
    expect(screen.queryByText('Central DC')).not.toBeInTheDocument();
  });
});
