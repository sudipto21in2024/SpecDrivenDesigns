import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Alert, Box, Button, Paper, Stack, TextField, Typography } from '@mui/material';
import { ApiError } from '../../api/client';
import { useAuth } from './AuthContext';

/**
 * Login form validation, mirroring the contract's LoginRequest (email format, maxLength 256;
 * password 1..128) and the backend's LoginCommandValidator.
 *
 * Presence/shape only: whether the credentials are *correct* is never a client-side concern. A bad
 * password is a 401 from the server (LOGI-0003 AC-2 vs AC-3).
 */
const loginSchema = z.object({
  email: z.string().trim().min(1, 'Email is required').email('Enter a valid email address').max(256),
  password: z.string().min(1, 'Password is required').max(128),
});

type LoginFormValues = z.infer<typeof loginSchema>;

/** Sign-in screen shown whenever the SPA has no authenticated session (LOGI-0003 AC-12). */
export default function LoginPage() {
  const { login } = useAuth();
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  const submit = handleSubmit(async (values) => {
    setServerError(null);
    try {
      await login(values.email, values.password);
    } catch (error) {
      // 401 → the generic message from the API. Deliberately not "no such user" vs "wrong password":
      // the server refuses to distinguish them, and the UI must not invent a distinction.
      setServerError(
        error instanceof ApiError
          ? (error.problem.detail ?? error.problem.title ?? 'Sign in failed.')
          : 'Unable to reach the server. Please try again.',
      );
    }
  });

  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', mt: { xs: 4, sm: 8 } }}>
      <Paper elevation={2} sx={{ p: 4, width: '100%', maxWidth: 420 }}>
        <Stack spacing={2}>
          <Typography variant="h5" component="h2">
            Sign in to LogiFlow
          </Typography>

          {serverError != null && (
            <Alert severity="error" role="alert">
              {serverError}
            </Alert>
          )}

          <Box component="form" onSubmit={submit} noValidate>
            <Stack spacing={2}>
              <TextField
                label="Email"
                type="email"
                autoComplete="username"
                required
                fullWidth
                error={errors.email != null}
                helperText={errors.email?.message}
                inputProps={{ 'aria-label': 'Email' }}
                {...register('email')}
              />
              <TextField
                label="Password"
                type="password"
                autoComplete="current-password"
                required
                fullWidth
                error={errors.password != null}
                helperText={errors.password?.message}
                inputProps={{ 'aria-label': 'Password' }}
                {...register('password')}
              />
              <Button type="submit" variant="contained" disabled={isSubmitting} data-testid="sign-in">
                Sign in
              </Button>
            </Stack>
          </Box>
        </Stack>
      </Paper>
    </Box>
  );
}