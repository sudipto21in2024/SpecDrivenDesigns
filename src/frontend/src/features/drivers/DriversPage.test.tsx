import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { seedDriver } from '../../mocks/handlers';
import { renderAppAs, resetMocks } from '../../test/renderApp';

beforeEach(() => {
  resetMocks();
});

/**
 * Renders the app as `role` and opens the Drivers tab. The tab only exists for roles that may read
 * driver master data (spec §2 excludes the Driver persona), so the Driver role is asserted without
 * switching tabs.
 */
async function renderDriversTab(role: 'Admin' | 'Dispatcher' | 'Viewer' = 'Admin') {
  const user = userEvent.setup();
  renderAppAs(role);
  await user.click(await screen.findByTestId('tab-drivers'));
  return user;
}

/** Returns the table row that contains `text` so cell-level assertions stay scoped. */
async function rowFor(text: string) {
  const cell = await screen.findByText(text);
  return cell.closest('tr')!;
}

describe('DriversPage (LOGI-0005)', () => {
  it('AC-1/AC-7: lists drivers in the paged table', async () => {
    seedDriver({ fullName: 'Raj Patil', licenseNumber: 'DL-112-4589' });
    await renderDriversTab();

    expect(await screen.findByRole('table', { name: 'Drivers table' })).toBeInTheDocument();
    expect(screen.getByText('Raj Patil')).toBeInTheDocument();
    expect(screen.getByText('DL-112-4589')).toBeInTheDocument();
  });

  it('AC-7: shows an empty state when there are no drivers', async () => {
    await renderDriversTab();
    expect(await screen.findByText('No drivers found')).toBeInTheDocument();
  });

  it('AC-1/AC-4: creates a driver, defaulting the status to Active', async () => {
    const user = await renderDriversTab();

    await user.click(screen.getByTestId('new-driver'));
    await user.type(screen.getByLabelText('Driver full name'), 'Meera Nair');
    await user.type(screen.getByLabelText('Driver license number'), 'DL-900-1');
    await user.click(screen.getByTestId('driver-submit'));

    expect(await screen.findByText('Driver created')).toBeInTheDocument();
    // AC-4: no status was chosen, so the server default (Active) is what lands in the table.
    const row = await rowFor('Meera Nair');
    expect(within(row).getByText('Active')).toBeInTheDocument();
    expect(within(row).getByText('DL-900-1')).toBeInTheDocument();
  });

  it('AC-2: client-side validation blocks an empty full name and licence', async () => {
    const user = await renderDriversTab();

    await user.click(screen.getByTestId('new-driver'));
    await user.click(screen.getByTestId('driver-submit'));

    expect(await screen.findByText('Full name is required')).toBeInTheDocument();
    expect(screen.getByText('License number is required')).toBeInTheDocument();
  });

  it('AC-3: a duplicate licence number surfaces on the licence field', async () => {
    seedDriver({ fullName: 'Existing Driver', licenseNumber: 'DL-DUP-1' });
    const user = await renderDriversTab();

    await user.click(screen.getByTestId('new-driver'));
    await user.type(screen.getByLabelText('Driver full name'), 'Copy Cat');
    await user.type(screen.getByLabelText('Driver license number'), 'DL-DUP-1');
    await user.click(screen.getByTestId('driver-submit'));

    expect(await screen.findByText(/already exists/)).toBeInTheDocument();
    // No second row was created in the UI.
    expect(screen.queryByText('Copy Cat')).not.toBeInTheDocument();
  });

  it('AC-5: links a driver to an existing user account', async () => {
    const user = await renderDriversTab();

    await user.click(screen.getByTestId('new-driver'));
    await user.type(screen.getByLabelText('Driver full name'), 'Linked Driver');
    await user.type(screen.getByLabelText('Driver license number'), 'DL-LINK-1');
    await user.type(screen.getByLabelText('Driver user id'), '1');
    await user.click(screen.getByTestId('driver-submit'));

    const row = await rowFor('Linked Driver');
    expect(within(row).getByText('1')).toBeInTheDocument();
  });

  it('AC-6: an unknown user id is rejected on the userId field', async () => {
    const user = await renderDriversTab();

    await user.click(screen.getByTestId('new-driver'));
    await user.type(screen.getByLabelText('Driver full name'), 'Ghost Link');
    await user.type(screen.getByLabelText('Driver license number'), 'DL-GHOST-1');
    await user.type(screen.getByLabelText('Driver user id'), '999999');
    await user.click(screen.getByTestId('driver-submit'));

    expect(await screen.findByText(/was not found/)).toBeInTheDocument();
    expect(screen.queryByText('Ghost Link')).not.toBeInTheDocument();
  });

  it('AC-6: an edit keeps the existing user link (PUT sends the current userId)', async () => {
    seedDriver({ fullName: 'Raj Patil', licenseNumber: 'DL-KEEP-1', userId: 1 });
    const user = await renderDriversTab();

    await user.click(await screen.findByRole('button', { name: 'Edit driver Raj Patil' }));
    const nameField = screen.getByLabelText('Driver full name');
    await user.clear(nameField);
    await user.type(nameField, 'Raj P. Patil');
    await user.click(screen.getByTestId('driver-submit'));

    expect(await screen.findByText('Driver updated')).toBeInTheDocument();
    const row = await rowFor('Raj P. Patil');
    expect(within(row).getByText('1')).toBeInTheDocument();
  });

  it('AC-6: clearing the user id unlinks the driver', async () => {
    seedDriver({ fullName: 'Unlink Me', licenseNumber: 'DL-UNLINK-1', userId: 2 });
    const user = await renderDriversTab();

    await user.click(await screen.findByRole('button', { name: 'Edit driver Unlink Me' }));
    await user.clear(screen.getByLabelText('Driver user id'));
    await user.click(screen.getByTestId('driver-submit'));

    expect(await screen.findByText('Driver updated')).toBeInTheDocument();
    const row = await rowFor('Unlink Me');
    expect(within(row).queryByText('2')).not.toBeInTheDocument();
  });

  it('AC-8: edits a driver and keeps the row in the list', async () => {
    seedDriver({ fullName: 'Old Name', licenseNumber: 'DL-EDIT-1' });
    const user = await renderDriversTab();

    await user.click(await screen.findByRole('button', { name: 'Edit driver Old Name' }));
    const nameField = screen.getByLabelText('Driver full name');
    await user.clear(nameField);
    await user.type(nameField, 'New Name');
    await user.click(screen.getByTestId('driver-submit'));

    expect(await screen.findByText('New Name')).toBeInTheDocument();
    expect(screen.queryByText('Old Name')).not.toBeInTheDocument();
  });

  it('AC-8: deletes a driver after confirmation', async () => {
    seedDriver({ fullName: 'Delete Me', licenseNumber: 'DL-DEL-1' });
    const user = await renderDriversTab();

    const row = await rowFor('Delete Me');
    await user.click(within(row).getByRole('button', { name: 'Delete driver Delete Me' }));
    await user.click(screen.getByTestId('confirm-delete'));

    await waitFor(() => expect(screen.queryByText('Delete Me')).not.toBeInTheDocument());
    expect(screen.getByText('Driver deleted')).toBeInTheDocument();
  });

  it('AC-7: search filters the list by full name', async () => {
    seedDriver({ fullName: 'Raj Patil' });
    seedDriver({ fullName: 'Vera Vogel' });
    const user = await renderDriversTab();

    await user.type(await screen.findByLabelText('Search drivers by full name'), 'vera');
    await user.click(screen.getByRole('button', { name: 'Search drivers' }));

    expect(await screen.findByText('Vera Vogel')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('Raj Patil')).not.toBeInTheDocument());
  });

  it('AC-7/AC-4: the status filter offers the contract enum and filters the list', async () => {
    seedDriver({ fullName: 'Active Amy', status: 'Active' });
    seedDriver({ fullName: 'OffDuty Omar', status: 'OffDuty' });
    const user = await renderDriversTab();

    await user.click(screen.getByLabelText('Filter by status'));
    const options = await screen.findAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual(
      expect.arrayContaining(['Active', 'OffDuty', 'Suspended']),
    );
    await user.click(screen.getByRole('option', { name: 'OffDuty' }));

    expect(await screen.findByText('OffDuty Omar')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('Active Amy')).not.toBeInTheDocument());
  });

  it('AC-9: a Viewer sees the list but no write affordances', async () => {
    seedDriver({ fullName: 'Vera Viewer Row' });
    await renderDriversTab('Viewer');

    expect(await screen.findByText('Vera Viewer Row')).toBeInTheDocument();
    expect(screen.queryByTestId('new-driver')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Edit driver/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Delete driver/ })).not.toBeInTheDocument();
  });

  it('AC-9: a Dispatcher can create but sees no delete action', async () => {
    seedDriver({ fullName: 'Dana Dispatcher Row' });
    await renderDriversTab('Dispatcher');

    expect(await screen.findByText('Dana Dispatcher Row')).toBeInTheDocument();
    expect(screen.getByTestId('new-driver')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit driver Dana Dispatcher Row' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Delete driver/ })).not.toBeInTheDocument();
  });

  it('AC-9: the Driver role has no Drivers tab at all (master data is not a driver surface)', async () => {
    renderAppAs('Driver');

    expect(await screen.findByTestId('tab-warehouses')).toBeInTheDocument();
    expect(screen.queryByTestId('tab-drivers')).not.toBeInTheDocument();
  });
});
