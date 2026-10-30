import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './index.css';

const raiz = document.getElementById('root');
if (!raiz) throw new Error('index.html sem #root');

createRoot(raiz).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
