import { createRoot } from 'react-dom/client';

// Must run before any component fires a request: wires the API base URL
// (VITE_API_URL) into the shared api-client-react instance.
import './lib/api-base';

import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';

import './index.css';

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
