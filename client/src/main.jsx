import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'

function isChunkLoadError(value) {
  const message = `${value?.message || value?.reason?.message || value || ''}`;
  return /dynamically imported module|Failed to fetch|Loading chunk|Importing a module script failed|ChunkLoadError/i.test(message);
}

function recoverFromChunkError(event) {
  if (!isChunkLoadError(event.error || event.reason || event.message)) return;
  try {
    const key = 'tiktok:chunk-reload';
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, String(Date.now()));
  } catch (err) {
    // Continue with reload when storage is restricted.
  }
  window.location.reload();
}

window.addEventListener('error', recoverFromChunkError);
window.addEventListener('unhandledrejection', recoverFromChunkError);

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
)
