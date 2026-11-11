/**
 * Configurações → Avisos: para cada aviso que o papel recebe, uma chave por canal (E-mail, WhatsApp).
 * Vale na hora, sem botão Salvar. Na tela tudo aparece sempre; aqui é só o que sai do sistema.
 *
 * As escolhas viriam do perfil (fase 3); por isso só esta seção simula a leitura pela URL:
 * `?estado=carregando` mostra o esqueleto e `?estado=erro` a falha com "Tentar de novo". Em vazio e sem
 * dados ela abre igual: configuração não depende dos dados de marketing.
 */

import { BellOff } from 'lucide-react';
import type { ReactNode } from 'react';
import { pode } from '@csp-mkt/shared';
import { Esqueleto, Vazio } from '../../components/ui';
import { useSessao } from '../../lib/auth';
import { useFiltros } from '../../lib/url-state';
import { avisosDoPapel, CANAIS_DE_AVISO, definirAviso, textoDoHorario, useAvisos } from './avisos';
import { Secao } from './Secao';

export function SecaoDeAvisos() {
  const { perfil, modo } = useSessao();
  const { filtros, limpar } = useFiltros();
  const preferencias = useAvisos();
  const avisos = avisosDoPapel(perfil?.role);
  const podeMudar = pode(perfil?.role, 'editar_configuracoes');

  let conteudo: ReactNode;
  if (filtros.estado === 'carregando') {
    conteudo = <Esqueleto variante="texto" quantidade={6} />;
  } else if (filtros.estado === 'erro') {
    conteudo = (
      <Vazio
        erro
        titulo="Não deu para carregar seus avisos"
        texto="Tente de novo em alguns segundos. O tema e a marca continuam funcionando."
        codigo="DEMO-500"
        aoTentarDeNovo={() => limpar(['estado'])}
      />
    );
  } else if (avisos.length === 0) {
    conteudo = (
      <Vazio
        icone={BellOff}
        titulo="Nenhum aviso para o seu papel"
        texto="Os avisos aparecem quando seu papel puder ver o que eles apontam."
      />
    );
  } else {
    conteudo = (
      <>
        <dl className="yn-dl">
          <div>
            <dt>E-mail</dt>
            {perfil?.email ? <dd>{perfil.email}</dd> : <dd className="yn-muted">A cadastrar</dd>}
          </div>
          <div>
            <dt>WhatsApp</dt>
            <dd className="yn-muted">A cadastrar</dd>
          </div>
        </dl>
        <p className="yn-hint">
          Na tela, tudo aparece sempre: contador no menu e faixa no topo.
          {modo === 'demonstracao'
            ? ' Na demonstração, nenhum aviso sai do sistema e a escolha fica neste navegador.'
            : ' Os avisos por WhatsApp começam quando o número estiver no seu perfil.'}
        </p>
        <div className="grid gap-5">
          {avisos.map((aviso) => {
            const idQuando = `aviso-${aviso.id}-quando`;
            return (
              <fieldset
                key={aviso.id}
                className="yn-fieldset"
                disabled={!podeMudar}
                aria-describedby={idQuando}
              >
                <legend>{aviso.titulo}</legend>
                <p className="yn-hint" id={idQuando}>
                  {aviso.descricao} {textoDoHorario(aviso)}
                </p>
                <div className="flex flex-wrap gap-x-6 gap-y-2">
                  {CANAIS_DE_AVISO.map(({ canal, rotulo }) => (
                    <label key={canal} className="yn-check">
                      <input
                        type="checkbox"
                        role="switch"
                        className="yn-switch"
                        checked={preferencias[aviso.id][canal]}
                        onChange={(evento) => definirAviso(aviso.id, canal, evento.currentTarget.checked)}
                      />
                      {rotulo}
                    </label>
                  ))}
                </div>
              </fieldset>
            );
          })}
        </div>
      </>
    );
  }

  return (
    <Secao id="avisos" titulo="Avisos" descricao="O que você recebe fora do sistema e por qual canal.">
      {conteudo}
    </Secao>
  );
}
