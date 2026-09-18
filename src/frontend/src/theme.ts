import { createTheme } from '@mui/material/styles';
import type { ThemeOptions } from '@mui/material/styles';

// LogiFlow theme — MUI v5 (ADR-002). Enterprise, tablet-friendly defaults.
const themeOptions: ThemeOptions = {
  palette: {
    mode: 'light',
    primary: { main: '#1565c0' },
    secondary: { main: '#00695c' },
  },
  typography: {
    h6: { fontWeight: 600 },
  },
  components: {
    MuiButton: { defaultProps: { variant: 'contained' } },
  },
};

export const theme = createTheme(themeOptions);
