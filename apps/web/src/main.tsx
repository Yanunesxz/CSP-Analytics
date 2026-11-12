import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { observarInstalacao, registrarServiceWorker } from './lib/app-instalavel';
import './index.css';

// Antes do React: o convite de instalação do navegador costuma chegar cedo e vem uma vez só
observarInstalacao();
registrarServiceWorker();

const raiz = document.getElementById('root');
if (!raiz) throw new Error('index.html sem #root');

createRoot(raiz).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
