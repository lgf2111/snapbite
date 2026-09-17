import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { applyTelegramTheme, initTelegram } from './lib/telegram.js';
import './styles.css';

initTelegram();
applyTelegramTheme();

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Root element #root not found');

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
