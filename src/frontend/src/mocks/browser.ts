import { setupWorker } from 'msw/browser';
import { handlers } from './handlers';

// Service-worker based MSW for browser mock mode (`VITE_ENABLE_MOCKS=1 npm run dev`).
export const worker = setupWorker(...handlers);
