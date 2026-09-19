import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach } from 'vitest';
import { mockPassword, mockUsers, seedWarehouse } from '../../mocks/handlers';
import { renderAnonymousApp, renderAppAs, resetMocks } from '../../test/renderApp';

beforeEach(() => {
  resetMocks();
});

const admin = mockUsers.find((u) => u.role === 'Admin')!;

describe('Auth (LOGI-0003)', () => {
  // -------------------------------------------------------------- AC-12: gating

  it('shows the login screen when there is no session', async () => {
    renderAnonymousApp();

    expect(await screen.findByRole('heading', { name: 'Sign in to LogiFlow' })).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    // No feature content is mounted while anonymous.
    expect(screen.queryByText('Warehouses')).not.toBeInTheDocument();
  });

  it('restores a stored session and renders the app shell', async () => {
    renderAppAs('Admin');

    // The header only renders for an authenticated user, so its role chip proves restoration.
    expect(await screen.findByTestId('current-role')).toHaveTextContent('Admin');
    expect(screen.getByTestId('current-user')).toHaveTextContent(admin.fullName);
    expect(await screen.findByRole('heading', { name: 'Warehouses' })).toBeInTheDocument();
  });

  // -------------------------------------------------------------- AC-1 / AC-2: login

  it('AC-1: signs in with valid credentials and reaches the warehouses screen', async () => {
    const user = userEvent.setup();
    renderAnonymousApp();

    await user.type(await screen.findByLabelText('Email'), admin.email);
    await user.type(screen.getByLabelText('Password'), mockPassword);
    await user.click(screen.getByTestId('sign-in'));

    expect(await screen.findByTestId('current-role')).toHaveTextContent('Admin');
    expect(await screen.findByRole('heading', { name: 'Warehouses' })).toBeInTheDocument();
  });

  it('AC-2: shows a generic error for a wrong password and does not sign in', async () => {
    const user = userEvent.setup();
    renderAnonymousApp();

    await user.type(await screen.findByLabelText('Email'), admin.email);
    await user.type(screen.getByLabelText('Password'), 'wrong-password');
    await user.click(screen.getByTestId('sign-in'));

    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password.');
    // Still anonymous: the login form remains and no user identity is rendered.
    expect(screen.getByRole('heading', { name: 'Sign in to LogiFlow' })).toBeInTheDocument();
    expect(screen.queryByTestId('current-role')).not.toBeInTheDocument();
  });

  it('AC-2: an unknown email produces the same message as a wrong password', async () => {
    const user = userEvent.setup();
    renderAnonymousApp();

    await user.type(await screen.findByLabelText('Email'), 'nobody@logiflow.dev');
    await user.type(screen.getByLabelText('Password'), mockPassword);
    await user.click(screen.getByTestId('sign-in'));

    // The UI must not leak the distinction the API deliberately withholds.
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password.');
  });

  it('AC-3: rejects malformed input client-side without calling the API', async () => {
    const user = userEvent.setup();
    renderAnonymousApp();

    await user.click(await screen.findByTestId('sign-in'));

    expect(await screen.findByText('Email is required')).toBeInTheDocument();
    expect(screen.getByText('Password is required')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  // -------------------------------------------------------------- AC-12: role-aware affordances

  it('AC-12: a Viewer sees no write affordances', async () => {
    seedWarehouse({ name: 'Central DC' });
    renderAppAs('Viewer');

    // Read access works...
    expect(await screen.findByText('Central DC')).toBeInTheDocument();
    // ...but nothing that would produce a 403 is offered.
    expect(screen.queryByTestId('new-warehouse')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit warehouse Central DC' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete warehouse Central DC' })).not.toBeInTheDocument();
  });

  it('AC-12: a Dispatcher may create and edit but not delete', async () => {
    seedWarehouse({ name: 'Central DC' });
    renderAppAs('Dispatcher');

    expect(await screen.findByText('Central DC')).toBeInTheDocument();
    expect(screen.getByTestId('new-warehouse')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit warehouse Central DC' })).toBeInTheDocument();
    // DELETE is Admin-only per x-roles: [Admin].
    expect(screen.queryByRole('button', { name: 'Delete warehouse Central DC' })).not.toBeInTheDocument();
  });

  it('AC-12: an Admin sees the full set of affordances', async () => {
    seedWarehouse({ name: 'Central DC' });
    renderAppAs('Admin');

    expect(await screen.findByText('Central DC')).toBeInTheDocument();
    expect(screen.getByTestId('new-warehouse')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit warehouse Central DC' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete warehouse Central DC' })).toBeInTheDocument();
  });

  // -------------------------------------------------------------- AC-9: sign out

  it('AC-9: signing out clears the session and returns to the login screen', async () => {
    const user = userEvent.setup();
    renderAppAs('Admin');

    await user.click(await screen.findByTestId('account-menu'));
    await user.click(await screen.findByTestId('sign-out'));

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Sign in to LogiFlow' })).toBeInTheDocument();
    });
    expect(screen.queryByTestId('current-role')).not.toBeInTheDocument();
  });
});