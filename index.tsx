import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
// Hoja de estilos de la aplicación (Tailwind + estilos propios). Va en la compilación,
// no en un CDN: ver index.css.
import './index.css';

// Manejo de errores de carga de chunks (módulos dinámicos) después de un nuevo despliegue
window.addEventListener('vite:preloadError', (event) => {
  const reloadCount = parseInt(sessionStorage.getItem('chunk_failed_reload') || '0', 10);
  if (reloadCount < 2) {
    sessionStorage.setItem('chunk_failed_reload', String(reloadCount + 1));
    const url = new URL(window.location.href);
    url.searchParams.set('t', Date.now().toString());
    window.location.href = url.toString();
  }
});

// Service worker mínimo (public/sw.js): permite instalar la app; no guarda caché.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL }).catch(() => {});
  });
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);