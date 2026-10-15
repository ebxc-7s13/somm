import '@fontsource-variable/sora';
import '@fontsource-variable/inter';
import '@fontsource-variable/unbounded';
import '@fontsource-variable/space-grotesk';
import './styles/tokens.css';
import './styles/app.css';
import './styles/fx.scss';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { setupInstall } from './install';

setupInstall();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
