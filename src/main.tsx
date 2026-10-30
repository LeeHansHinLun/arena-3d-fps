import './index.css';
import App from './App';
import { errorScreen } from './ui/ErrorScreen';

const host = document.getElementById('root');
if (host) {
  // No React, no error boundary: mount the app, and swap in a recovery screen
  // if anything throws while it renders or while an event handler runs.
  try {
    host.appendChild(App().root);
  } catch (err) {
    console.error('NEON RIOT crashed:', err);
    host.replaceChildren(errorScreen(err instanceof Error ? err.message : String(err)));
  }

  const recover = (err: unknown) => {
    console.error('NEON RIOT crashed:', err);
    host.replaceChildren(errorScreen(err instanceof Error ? err.message : String(err)));
  };
  window.addEventListener('error', (e) => recover(e.error ?? e.message));
  window.addEventListener('unhandledrejection', (e) => recover(e.reason));
}
