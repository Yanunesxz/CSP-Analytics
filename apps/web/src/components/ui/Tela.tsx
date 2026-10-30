/**
 * Estados de uma tela de números a partir do `Resultado` de `useConsulta`:
 * carregando → esqueleto; erro → "Não deu para carregar" + "Tentar de novo"; vazio → próximo passo;
 * ok e sem-dados → `children(dados, estado)` (em sem-dados as métricas vêm null e cada KPI/gráfico
 * mostra "Sem dados" sozinho).
 */

import { Plug, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { Resultado } from '../../data/store';
import { useFiltros } from '../../lib/url-state';
import { Esqueleto, type EsqueletoProps } from './Esqueleto';
import { Vazio } from './Vazio';

export interface TelaProps<T> {
  resultado: Resultado<T>;
  /** Texto do estado vazio (padrão: "Nenhum dado ainda" com link para Conectores). */
  vazio?: { titulo?: string; texto?: string; icone?: LucideIcon; acao?: ReactNode };
  esqueleto?: EsqueletoProps['variante'];
  /** Padrão: tira `?estado=` da URL (na demonstração, "Tentar de novo" recupera a tela). */
  aoTentarDeNovo?: () => void;
  children: (dados: T, estado: 'ok' | 'sem-dados') => ReactNode;
}

export function Tela<T>({ resultado, vazio, esqueleto = 'tela', aoTentarDeNovo, children }: TelaProps<T>) {
  const { limpar, linkCom } = useFiltros();
  const tentar = aoTentarDeNovo ?? (() => limpar(['estado']));

  if (resultado.estado === 'carregando') return <Esqueleto variante={esqueleto} />;
  if (resultado.estado === 'erro') {
    return (
      <Vazio
        erro
        titulo="Não deu para carregar"
        texto="Tente de novo em alguns segundos. Se continuar, veja os conectores."
        codigo={resultado.codigo}
        aoTentarDeNovo={tentar}
      />
    );
  }
  if (resultado.estado === 'vazio' || resultado.dados === null) {
    return (
      <Vazio
        icone={vazio?.icone ?? Plug}
        titulo={vazio?.titulo ?? 'Nenhum dado ainda'}
        texto={
          vazio?.texto ??
          'Ligue um conector para os números chegarem. No modo demonstração, abra com VITE_SAMPLE_DATA=true.'
        }
        acao={
          vazio?.acao ?? (
            <Link className="yn-btn yn-btn--secondary" to={linkCom('/conectores')}>
              Ver conectores
            </Link>
          )
        }
      />
    );
  }
  return <>{children(resultado.dados, resultado.estado === 'sem-dados' ? 'sem-dados' : 'ok')}</>;
}
