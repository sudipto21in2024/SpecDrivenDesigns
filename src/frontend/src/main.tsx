import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

// Enable MSW mock API when explicitly requested (contract-first dev, ADR-004):
// `VITE_ENABLE_MOCKS=1 npm run dev`
async function enableMocksIfRequested() {
  if (import.meta.env.VITE_ENABLE_MOCKS === '1') {
    const { worker } = await import('./mocks/browser');
    await worker.start({ onUnhandledRequest: 'warn' });
  }
}

enableMocksIfRequested().then(() => {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
});
