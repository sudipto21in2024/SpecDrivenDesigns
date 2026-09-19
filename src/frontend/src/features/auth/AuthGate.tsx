import type { ReactNode } from 'react';
import { Box, CircularProgress } from '@mui/material';
import { useAuth } from './AuthContext';
import LoginPage from './LoginPage';

/**
 * Renders children only for an authenticated session; otherwise shows the login screen (AC-12).
 *
 * Gating at the render boundary means no feature component is even mounted while anonymous, so no
 * feature query fires without a token. The alternative — letting a page render and bounce on 401 —
 * would issue pointless authenticated requests and flash an error state at the user.
 *
 * Note this is *not* the security boundary. It decides what is mounted, nothing more; every request
 * is authorized again server-side (HLD §7).
 */
export default function AuthGate({ children }: { children: ReactNode }) {
  const { status } = useAuth();

  if (status === 'loading') {
    // Restoring a stored session: a spinner avoids flashing the login form at a signed-in user.
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', mt: 8 }} data-testid="auth-loading">
        <CircularProgress aria-label="Restoring session" />
      </Box>
    );
  }

  return status === 'authenticated' ? <>{children}</> : <LoginPage />;
}
