import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import './index.css';
import { App } from './App';

const updateSW = registerSW({
  onNeedRefresh() {
    // Surface refresh-available banner via a custom event the App listens to.
    window.dispatchEvent(new CustomEvent('tideline:update-available'));
  },
  onOfflineReady() {
    window.dispatchEvent(new CustomEvent('tideline:offline-ready'));
  },
});

// Expose updater so the App's refresh banner can trigger it.
(window as unknown as { __tidelineUpdate?: () => Promise<void> }).__tidelineUpdate = () =>
  updateSW(true);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
