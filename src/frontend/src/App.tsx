import { useState } from 'react';
import {
  AppBar,
  Box,
  Chip,
  Container,
  CssBaseline,
  Divider,
  IconButton,
  ListItemIcon,
  Menu,
  MenuItem,
  Toolbar,
  Typography,
  useTheme,
} from '@mui/material';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { theme } from './theme';
import { AccountIcon, LogoutIcon } from './components/icons';
import AuthGate from './features/auth/AuthGate';
import { AuthProvider, useAuth } from './features/auth/AuthContext';
import WarehousesPage from './features/warehouses/WarehousesPage';
import VehiclesPage from './features/vehicles/VehiclesPage';
import { Tab, Tabs } from '@mui/material';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false },
  },
});

/**
 * Application chrome. The header is only meaningful for a signed-in user, so it renders inside the
 * auth gate and shows who is signed in (AC-12). Role is displayed because it explains what the UI
 * is (and is not) offering — e.g. a Viewer seeing no write affordances.
 */
function AppHeader() {
  const { user, logout } = useAuth();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const theme = useTheme();

  if (user == null) return null;

  return (
    <AppBar position="static" color="primary" elevation={0}>
      <Toolbar sx={{ gap: 1 }}>
        <Typography variant="h6" component="h1" sx={{ flexGrow: 1 }}>
          LogiFlow
        </Typography>
        <Chip
          label={user.role}
          size="small"
          data-testid="current-role"
          sx={{ bgcolor: theme.palette.primary.dark, color: theme.palette.primary.contrastText }}
        />
        <Typography variant="body2" data-testid="current-user">
          {user.fullName}
        </Typography>
        <IconButton
          color="inherit"
          aria-label="Account menu"
          data-testid="account-menu"
          onClick={(event) => setAnchor(event.currentTarget)}
        >
          <AccountIcon />
        </IconButton>
        <Menu anchorEl={anchor} open={anchor != null} onClose={() => setAnchor(null)}>
          <MenuItem disabled>
            <Box>
              <Typography variant="body2">{user.fullName}</Typography>
              <Typography variant="caption" color="text.secondary">
                {user.email}
              </Typography>
            </Box>
          </MenuItem>
          <Divider />
          <MenuItem
            data-testid="sign-out"
            onClick={() => {
              setAnchor(null);
              void logout();
            }}
          >
            <ListItemIcon>
              <LogoutIcon fontSize="small" />
            </ListItemIcon>
            Sign out
          </MenuItem>
        </Menu>
      </Toolbar>
    </AppBar>
  );
}

export default function App() {
  const [tab, setTab] = useState<'warehouses' | 'vehicles'>('warehouses');

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        {/* AuthProvider must wrap the gate: it owns the session the gate reads, and it also supplies
            the client's session-expiry handler. */}
        <AuthProvider>
          <AuthGate>
            <AppHeader />
            <Container maxWidth="lg" sx={{ mt: 3, mb: 6 }}>
              <Tabs
                value={tab}
                onChange={(_, next) => setTab(next)}
                aria-label="Master data sections"
                sx={{ mb: 2 }}
              >
                <Tab value="warehouses" label="Warehouses" data-testid="tab-warehouses" />
                <Tab value="vehicles" label="Vehicles" data-testid="tab-vehicles" />
              </Tabs>
              {tab === 'warehouses' ? <WarehousesPage /> : <VehiclesPage />}
            </Container>
          </AuthGate>
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
