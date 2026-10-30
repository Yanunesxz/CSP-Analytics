/**
 * Um cartão por integração (.yn-card): nome, estado (.yn-badge), "atualizado há X min", o que a
 * integração traz e de quanto em quanto tempo sincroniza, a ficha (.yn-dl--rows) com a última
 * sincronização, o atraso, os erros e as linhas gravadas, e "Tentar de novo" quando está caída ou
 * atrasada. O simulado mostra o que falta para ligar; o CSP 360 mostra também o caminho dos pedidos
 * (a última rodada apps → CSP 360) e que não existe conexão direta com os apps nem com o Control.
 */

import { ListChecks, RefreshCw } from 'lucide-react';
import { Fragment, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { ConnectorId } from '@csp-mkt/shared';
import { Badge } from '../../components/ui';
import type { CartaoDeConector, RodadaAppsCrm } from '../../data/queries/conectores';
import { atualizadoHa, VAZIO } from '../../lib/format';
import { useFiltros } from '../../lib/url-state';
import {
  CAMINHO_DOS_PEDIDOS,
  descricao,
  duracao,
  notaDaRodada,
  oQueFalta,
  quando,
  rotuloDoEstado,
  SEM_CONEXAO_DIRETA,
  SEM_DADOS,
  textoAtraso,
  textoContagem,
  textoUltimaSincronizacao,
  tomDoAtraso,
  tomDoEstado,
  trechos,
} from './textos';

/** Id do título do cartão (`conector-<id>`), único na tela. */
function idDoTitulo(id: ConnectorId): string {
  return `conector-${id}`;
}

/** Classes escritas por inteiro para o Tailwind achar (cor de status só no texto que pede atenção). */
const CLASSE_DO_TOM = { warning: 'text-tone-warning', danger: 'text-tone-danger' } as const;

/** "Sem dados" e "—" em cinza; o resto como veio. */
function valor(texto: string): ReactNode {
  return texto === SEM_DADOS || texto === VAZIO ? <span className="yn-muted">{texto}</span> : texto;
}

export interface CartaoProps {
  cartao: CartaoDeConector;
  agora: Date;
  /** O papel pode "Tentar de novo" (`tentar_conector_de_novo`). */
  podeTentar: boolean;
  /** O papel pode abrir Tráfego com IA (onde ficam as pendências de medição). */
  verTrafego: boolean;
  /** Primeiro cartão com problema: o botão dele é o principal da tela. */
  principal: boolean;
  /** "Tentar de novo" em andamento neste cartão. */
  tentando: boolean;
  aoTentarDeNovo: (cartao: CartaoDeConector) => void;
}

export function Cartao({
  cartao,
  agora,
  podeTentar,
  verTrafego,
  principal,
  tentando,
  aoTentarDeNovo,
}: CartaoProps) {
  const idTitulo = idDoTitulo(cartao.id);

  return (
    <li className="yn-card flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 id={idTitulo}>{cartao.nome}</h2>
          <p className="yn-muted text-xs">{atualizadoHa(cartao.ultimaSincronizacao, agora)}</p>
        </div>
        <Badge tom={tomDoEstado(cartao.estado)}>{rotuloDoEstado(cartao.estado)}</Badge>
      </div>

      <p className="yn-muted text-sm">{descricao(cartao)}</p>

      {cartao.estado === 'simulated' ? (
        <OQueFalta id={cartao.id} verTrafego={verTrafego} />
      ) : (
        <Ficha cartao={cartao} agora={agora} />
      )}

      {cartao.rodadaAppsCrm ? <CaminhoDosPedidos rodada={cartao.rodadaAppsCrm} agora={agora} /> : null}

      {cartao.temProblema ? (
        podeTentar ? (
          <div className="mkt-actions">
            <button
              type="button"
              className={principal ? 'yn-btn yn-btn--primary' : 'yn-btn yn-btn--secondary'}
              aria-busy={tentando || undefined}
              disabled={tentando}
              onClick={() => aoTentarDeNovo(cartao)}
            >
              {tentando ? null : <RefreshCw strokeWidth={1.75} aria-hidden="true" />}
              {tentando ? 'Tentando de novo' : 'Tentar de novo'}
              <span className="yn-sr-only"> {cartao.nome}</span>
            </button>
          </div>
        ) : (
          <p className="yn-muted text-sm">Avise o dono para tentar de novo.</p>
        )
      ) : null}
    </li>
  );
}

function Ficha({ cartao, agora }: { cartao: CartaoDeConector; agora: Date }) {
  const tomAtraso = tomDoAtraso(cartao);
  return (
    <dl className="yn-dl yn-dl--rows">
      <div>
        <dt>Última sincronização</dt>
        <dd>{valor(textoUltimaSincronizacao(cartao, agora))}</dd>
      </div>
      <div>
        <dt>Atraso</dt>
        <dd className={tomAtraso ? CLASSE_DO_TOM[tomAtraso] : undefined}>{valor(textoAtraso(cartao))}</dd>
      </div>
      <div>
        <dt>Erros em 24 h</dt>
        <dd>{valor(textoContagem(cartao.estado, cartao.erros24h))}</dd>
      </div>
      <div>
        <dt>Linhas gravadas em 24 h</dt>
        <dd>{valor(textoContagem(cartao.estado, cartao.linhasGravadas))}</dd>
      </div>
    </dl>
  );
}

function OQueFalta({ id, verTrafego }: { id: ConnectorId; verTrafego: boolean }) {
  const { linkCom } = useFiltros();
  return (
    <div className="yn-alert">
      <ListChecks strokeWidth={1.75} aria-hidden="true" />
      <div className="min-w-0">
        <strong className="yn-alert__title">O que falta para ligar</strong>
        <ol className="list-decimal pl-5">
          {oQueFalta(id).map((passo) => (
            <li key={passo}>
              {trechos(passo).map((t, i) =>
                t.codigo ? <code key={i}>{t.texto}</code> : <Fragment key={i}>{t.texto}</Fragment>,
              )}
            </li>
          ))}
        </ol>
        {verTrafego ? (
          <p className="mt-2">
            <Link className="underline" to={linkCom('/trafego')}>
              Ver pendências em Tráfego com IA
            </Link>
          </p>
        ) : null}
      </div>
    </div>
  );
}

function CaminhoDosPedidos({ rodada, agora }: { rodada: RodadaAppsCrm; agora: Date }) {
  return (
    <div className="grid gap-2 border-t border-line pt-4">
      <h3>Caminho dos pedidos</h3>
      <p className="yn-muted text-sm">{CAMINHO_DOS_PEDIDOS}</p>
      <dl className="yn-dl">
        <div>
          <dt>Última rodada apps → CSP 360</dt>
          <dd>
            {rodada.ultimaEm ? (
              <>
                {quando(rodada.ultimaEm, agora)}
                {rodada.atrasada ? (
                  <span className="block text-tone-warning">Atrasada {duracao(rodada.atrasoMinutos)}</span>
                ) : null}
              </>
            ) : (
              valor(SEM_DADOS)
            )}
          </dd>
        </div>
      </dl>
      <p className="yn-muted text-xs">{notaDaRodada(rodada)}</p>
      <p className="yn-muted text-xs">{SEM_CONEXAO_DIRETA}</p>
    </div>
  );
}
