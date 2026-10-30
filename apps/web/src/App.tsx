/**
 * Rotas: uma por módulo, carregadas com React.lazy, cada uma com limite de erro e esqueleto.
 * Rotas protegidas por papel usam a mesma regra do menu (ROTAS_PROTEGIDAS em @csp-mkt/shared).
 */

import { lazy, Suspense, type ReactNode } from 'react';
import { BrowserRouter, Route, Routes, useLocation } from 'react-router-dom';
import { ROTAS_PROTEGIDAS } from '@csp-mkt/shared';
import { LimiteDeErro } from './components/layout/LimiteDeErro';
import { RotaProtegida } from './components/layout/RotaProtegida';
import { Shell } from './components/layout/Shell';
import { Esqueleto } from './components/ui/Esqueleto';

const VisaoGeral = lazy(() => import('./modules/visao-geral'));
const ChegadaDeClientes = lazy(() => import('./modules/chegada-de-clientes'));
const BaseDeClientes = lazy(() => import('./modules/base-de-clientes'));
const Leads = lazy(() => import('./modules/leads'));
const Canais = lazy(() => import('./modules/canais'));
const Instagram = lazy(() => import('./modules/instagram'));
const SeoGeo = lazy(() => import('./modules/seo-geo'));
const TrafegoIa = lazy(() => import('./modules/trafego-ia'));
const Conectores = lazy(() => import('./modules/conectores'));
const Usuarios = lazy(() => import('./modules/usuarios'));
const Diagnostico = lazy(() => import('./modules/diagnostico'));
const Configuracoes = lazy(() => import('./modules/configuracoes'));
const NaoEncontrada = lazy(() => import('./modules/nao-encontrada'));

function Pagina({ caminho, children }: { caminho: string; children: ReactNode }) {
  const location = useLocation();
  const acao = ROTAS_PROTEGIDAS[caminho];
  const conteudo = acao ? <RotaProtegida acao={acao}>{children}</RotaProtegida> : children;
  return (
    <LimiteDeErro chave={location.pathname}>
      <Suspense fallback={<Esqueleto variante="tela" />}>{conteudo}</Suspense>
    </LimiteDeErro>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Shell />}>
          <Route
            path="/"
            element={
              <Pagina caminho="/">
                <VisaoGeral />
              </Pagina>
            }
          />
          <Route
            path="/chegada"
            element={
              <Pagina caminho="/chegada">
                <ChegadaDeClientes />
              </Pagina>
            }
          />
          <Route
            path="/base"
            element={
              <Pagina caminho="/base">
                <BaseDeClientes />
              </Pagina>
            }
          />
          <Route
            path="/leads"
            element={
              <Pagina caminho="/leads">
                <Leads />
              </Pagina>
            }
          />
          <Route
            path="/canais/:plataforma"
            element={
              <Pagina caminho="/canais">
                <Canais />
              </Pagina>
            }
          />
          <Route
            path="/instagram"
            element={
              <Pagina caminho="/instagram">
                <Instagram />
              </Pagina>
            }
          />
          <Route
            path="/seo-geo"
            element={
              <Pagina caminho="/seo-geo">
                <SeoGeo />
              </Pagina>
            }
          />
          <Route
            path="/trafego"
            element={
              <Pagina caminho="/trafego">
                <TrafegoIa />
              </Pagina>
            }
          />
          <Route
            path="/conectores"
            element={
              <Pagina caminho="/conectores">
                <Conectores />
              </Pagina>
            }
          />
          <Route
            path="/usuarios"
            element={
              <Pagina caminho="/usuarios">
                <Usuarios />
              </Pagina>
            }
          />
          <Route
            path="/diagnostico"
            element={
              <Pagina caminho="/diagnostico">
                <Diagnostico />
              </Pagina>
            }
          />
          <Route
            path="/configuracoes"
            element={
              <Pagina caminho="/configuracoes">
                <Configuracoes />
              </Pagina>
            }
          />
          <Route
            path="*"
            element={
              <Pagina caminho="*">
                <NaoEncontrada />
              </Pagina>
            }
          />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
