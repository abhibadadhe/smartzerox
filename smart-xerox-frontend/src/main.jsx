import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './index.css';

// Suppress expected network errors in development
const originalError = console.error;
console.error = (...args) => {
  // Suppress CORS and network errors that are expected during development
  const message = String(args[0]);
  if (
    message.includes('CORS') ||
    message.includes('Network Error') ||
    message.includes('ERR_NETWORK') ||
    message.includes('Failed to fetch') ||
    message.includes('Access to XMLHttpRequest') ||
    message.includes('Cross-Origin Request Blocked')
  ) {
    return; // Silently ignore
  }
  originalError.apply(console, args);
};

createRoot(document.getElementById('root')).render(<App />);
