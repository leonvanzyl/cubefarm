import { createRoot } from 'react-dom/client';
import { App } from './App';
import { connect } from './net';
import { registerServiceWorker } from './pwa';
import { useStore } from './store';
import './ui/a11y';
import './styles.css';

connect();
registerServiceWorker();
if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__swarmStore = useStore;
createRoot(document.getElementById('root')!).render(<App />);
