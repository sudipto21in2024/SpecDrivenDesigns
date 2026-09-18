import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppBar, CssBaseline, Toolbar, Typography, Container } from '@mui/material';
import { ThemeProvider } from '@mui/material/styles';
import { theme } from './theme';
import WarehousesPage from './features/warehouses/WarehousesPage';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false },
  },
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <AppBar position="static" color="primary" elevation={0}>
          <Toolbar>
            <Typography variant="h6" component="h1">
              LogiFlow
            </Typography>
          </Toolbar>
        </AppBar>
        <Container maxWidth="lg" sx={{ mt: 3, mb: 6 }}>
          <WarehousesPage />
        </Container>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
