import { describe, expect, it } from 'vitest';
import type { ConnectorStatus } from '@csp-mkt/shared';
import type { CartaoDeConector, PainelDeConectores } from '../../data/queries/conectores';
import {
  avisoGeral,
  descricao,
  duracao,
  frequencia,
  juntar,
  notaDaRodada,
  oQueFalta,
  quando,
  rotuloDoEstado,
  sincronizado,
  textoAtraso,
  textoContagem,
  textoUltimaSincronizacao,
  tomDoAtraso,
  tomDoEstado,
  trechos,
} from './textos';

const agora = new Date('2026-10-30T15:00:00-03:00');

describe('duração e frequência', () => {
  it('duração em minutos, horas e dias, sem inventar número', () => {
    expect(duracao(0)).toBe('0 min');
    expect(duracao(45)).toBe('45 min');
    expect(duracao(60)).toBe('1 h');
    expect(duracao(130)).toBe('2 h 10 min');
    expect(duracao(1440)).toBe('1 dia');
    expect(duracao(1500)).toBe('1 dia e 1 h');
    expect(duracao(2 * 1440 + 4 * 60 + 5)).toBe('2 dias e 4 h');
    expect(duracao(null)).toBe('—');
    expect(duracao(Number.NaN)).toBe('—');
  });

  it('frequência na fala de quem usa', () => {
    expect(frequencia(5)).toBe('a cada 5 min');
    expect(frequencia(60)).toBe('de hora em hora');
    expect(frequencia(1440)).toBe('uma vez por dia');
    expect(frequencia(120)).toBe('a cada 2 h');
    expect(frequencia(90)).toBe('a cada 1 h 30 min');
    expect(frequencia(2880)).toBe('a cada 2 dias');
    expect(frequencia(0)).toBeNull();
    expect(frequencia(null)).toBeNull();
  });

  it('descrição junta o que traz e a frequência, quando se sabe', () => {
    expect(descricao({ id: 'csp360', esperadoACadaMinutos: 5 })).toBe(
      'Leads, clientes e pedidos das duas marcas, sem nome nem contato. Sincroniza a cada 5 min.',
    );
    expect(descricao({ id: 'meta', esperadoACadaMinutos: 60 })).toMatch(/Sincroniza de hora em hora\.$/);
    expect(descricao({ id: 'ga4', esperadoACadaMinutos: null })).toBe(
      'Visitas aos sites e as que chegam de assistentes de IA.',
    );
  });
});

describe('datas do cartão', () => {
  it('hoje, ontem ou a data inteira, no fuso de São Paulo', () => {
    expect(quando('2026-10-30T14:18:00-03:00', agora)).toBe('hoje, 14:18');
    expect(quando('2026-10-30T00:05:00-03:00', agora)).toBe('hoje, 00:05');
    expect(quando('2026-10-29T22:10:00-03:00', agora)).toBe('ontem, 22:10');
    expect(quando('2026-10-28T09:00:00-03:00', agora)).toBe('28/10/2026 09:00');
    // 01:30 UTC do dia 30 ainda é dia 29 em São Paulo
    expect(quando('2026-10-30T01:30:00Z', agora)).toBe('ontem, 22:30');
    expect(quando(null, agora)).toBe('—');
    expect(quando('não é data', agora)).toBe('—');
  });

  it('última sincronização e atraso: sem dados, nunca sincronizou, em dia e atrasado', () => {
    const base = { estado: 'ok' as ConnectorStatus | null, atrasoMinutos: 0 as number | null };
    expect(
      textoUltimaSincronizacao({ ...base, ultimaSincronizacao: '2026-10-30T14:48:00-03:00' }, agora),
    ).toBe('hoje, 14:48');
    expect(textoUltimaSincronizacao({ ...base, ultimaSincronizacao: null }, agora)).toBe('Nunca sincronizou');
    expect(
      textoUltimaSincronizacao({ estado: null, ultimaSincronizacao: null, atrasoMinutos: null }, agora),
    ).toBe('Sem dados');

    const sincronizou = '2026-10-30T11:50:00-03:00';
    expect(textoAtraso({ estado: 'ok', ultimaSincronizacao: sincronizou, atrasoMinutos: 0 })).toBe('Em dia');
    expect(textoAtraso({ estado: 'late', ultimaSincronizacao: sincronizou, atrasoMinutos: 130 })).toBe(
      '2 h 10 min',
    );
    expect(textoAtraso({ estado: 'down', ultimaSincronizacao: null, atrasoMinutos: null })).toBe('—');
    expect(textoAtraso({ estado: null, ultimaSincronizacao: null, atrasoMinutos: null })).toBe('Sem dados');
  });

  it('cor do atraso só quando pede atenção', () => {
    const sincronizou = '2026-10-30T11:50:00-03:00';
    expect(tomDoAtraso({ estado: 'late', ultimaSincronizacao: sincronizou, atrasoMinutos: 130 })).toBe(
      'warning',
    );
    expect(tomDoAtraso({ estado: 'down', ultimaSincronizacao: sincronizou, atrasoMinutos: 30 })).toBe(
      'danger',
    );
    expect(
      tomDoAtraso({ estado: 'down', ultimaSincronizacao: sincronizou, atrasoMinutos: 0 }),
    ).toBeUndefined();
    expect(tomDoAtraso({ estado: 'ok', ultimaSincronizacao: sincronizou, atrasoMinutos: 0 })).toBeUndefined();
  });

  it('contagens: número formatado ou Sem dados, nunca 0 inventado', () => {
    expect(textoContagem('ok', 1840)).toBe('1.840');
    expect(textoContagem('late', 0)).toBe('0');
    expect(textoContagem(null, null)).toBe('Sem dados');
  });
});

describe('etiqueta e o que falta', () => {
  it('rótulo e tom de cada estado; a ligar e desligado neutros', () => {
    expect(rotuloDoEstado('ok')).toBe('Funcionando');
    expect(rotuloDoEstado('late')).toBe('Atrasado');
    expect(rotuloDoEstado('down')).toBe('Caído');
    expect(rotuloDoEstado('not_connected')).toBe('A ligar');
    expect(rotuloDoEstado('disabled')).toBe('Desligado');
    expect(rotuloDoEstado(null)).toBe('Sem dados');
    expect(tomDoEstado('ok')).toBe('success');
    expect(tomDoEstado('late')).toBe('warning');
    expect(tomDoEstado('down')).toBe('danger');
    expect(tomDoEstado('not_connected')).toBe('muted');
    expect(tomDoEstado('disabled')).toBe('muted');
    expect(tomDoEstado(null)).toBe('muted');
  });

  it('GA4 diz o que falta, com o nome da configuração em código', () => {
    const passos = oQueFalta('ga4');
    expect(passos[0]).toContain('`NEXT_PUBLIC_GA_ID`');
    expect(trechos(passos[0] ?? '')).toEqual([
      { texto: 'Preencher ', codigo: false },
      { texto: 'NEXT_PUBLIC_GA_ID', codigo: true },
      { texto: ' na Vercel dos dois sites. Hoje está vazio e os sites não medem visitas.', codigo: false },
    ]);
    expect(oQueFalta('tiktok')).toHaveLength(1);
    expect(trechos('sem código')).toEqual([{ texto: 'sem código', codigo: false }]);
  });

  it('junta nomes como se fala', () => {
    expect(juntar([])).toBe('');
    expect(juntar(['GA4'])).toBe('GA4');
    expect(juntar(['Meta Ads', 'GA4'])).toBe('Meta Ads e GA4');
    expect(juntar(['Meta Ads', 'TikTok Ads', 'GA4'])).toBe('Meta Ads, TikTok Ads e GA4');
  });

  it('aviso rápido de sucesso', () => {
    expect(sincronizado('TikTok Ads')).toBe('TikTok Ads sincronizado.');
  });

  it('nota da rodada apps → CSP 360: sem diário, atrasada e em dia', () => {
    expect(notaDaRodada({ ultimaEm: null, atrasada: false, esperadoACadaMinutos: 10 })).toBe(
      'Aparece quando o CSP 360 mandar o diário da sincronização com os apps.',
    );
    expect(
      notaDaRodada({ ultimaEm: '2026-10-30T14:35:00-03:00', atrasada: true, esperadoACadaMinutos: 10 }),
    ).toBe('Pedidos novos podem demorar a aparecer aqui.');
    expect(
      notaDaRodada({ ultimaEm: '2026-10-30T14:53:00-03:00', atrasada: false, esperadoACadaMinutos: 10 }),
    ).toBe('O CSP 360 busca os pedidos nos apps a cada 10 min.');
  });
});

describe('aviso do topo', () => {
  const cartao = (nome: string, estado: ConnectorStatus | null): CartaoDeConector => ({
    id: 'meta',
    nome,
    estado,
    ultimaSincronizacao: null,
    minutosDesdeSync: null,
    esperadoACadaMinutos: 60,
    atrasoMinutos: null,
    erros24h: 0,
    linhasGravadas: 0,
    temProblema: estado === 'down' || estado === 'late',
    rodadaAppsCrm: null,
  });

  const painel = (
    cartoes: CartaoDeConector[],
    situacao: PainelDeConectores['situacao'],
  ): Pick<PainelDeConectores, 'cartoes' | 'situacao' | 'aLigar' | 'resumo'> => ({
    cartoes,
    situacao,
    aLigar: cartoes.filter((c) => c.estado === 'not_connected'),
    resumo: {
      ok: cartoes.filter((c) => c.estado === 'ok').length,
      late: cartoes.filter((c) => c.estado === 'late').length,
      down: cartoes.filter((c) => c.estado === 'down').length,
      not_connected: cartoes.filter((c) => c.estado === 'not_connected').length,
      disabled: cartoes.filter((c) => c.estado === 'disabled').length,
    },
  });

  const semPermissao = { podeTentar: false, recuperadoEm: null };
  const dono = { podeTentar: true, recuperadoEm: null };

  it('um atrasado: amarelo, diz o que afeta e o que fazer', () => {
    const p = painel([cartao('TikTok Ads', 'late'), cartao('Meta Ads', 'ok')], 'atrasado');
    expect(avisoGeral(p, dono)).toEqual({
      tom: 'warning',
      titulo: 'TikTok Ads está atrasado',
      texto: 'Os números de TikTok Ads podem estar desatualizados. Tente de novo no cartão.',
    });
    expect(avisoGeral(p, semPermissao)?.texto).toBe(
      'Os números de TikTok Ads podem estar desatualizados. Avise o dono para tentar de novo.',
    );
  });

  it('caído vence atrasado e cita os dois', () => {
    const p = painel(
      [cartao('Google Ads', 'down'), cartao('Instagram', 'down'), cartao('TikTok Ads', 'late')],
      'caido',
    );
    expect(avisoGeral(p, dono)).toEqual({
      tom: 'danger',
      titulo: '2 conectores pararam de sincronizar',
      texto:
        'Os números de Google Ads e Instagram ficam parados na última sincronização. TikTok Ads está atrasado. Tente de novo em cada cartão.',
    });
    expect(avisoGeral(painel([cartao('Google Ads', 'down')], 'caido'), dono)?.titulo).toBe(
      'Google Ads parou de sincronizar',
    );
  });

  it('vários atrasados', () => {
    const p = painel([cartao('TikTok Ads', 'late'), cartao('Meta Ads', 'late')], 'atrasado');
    expect(avisoGeral(p, dono)?.titulo).toBe('2 conectores estão atrasados');
    expect(avisoGeral(p, dono)?.texto).toContain('TikTok Ads e Meta Ads');
    expect(avisoGeral(p, dono)?.texto).toContain('Tente de novo em cada cartão.');
  });

  it('em dia confirma, lembra o que falta ligar e diz desde quando voltou', () => {
    const p = painel([cartao('Meta Ads', 'ok'), cartao('GA4', 'not_connected')], 'em-dia');
    expect(avisoGeral(p, dono)).toEqual({
      tom: 'success',
      titulo: 'Tudo funcionando',
      texto: 'Os conectores ligados estão em dia. GA4 ainda está a ligar.',
    });
    expect(avisoGeral(p, { podeTentar: true, recuperadoEm: '2026-10-30T14:32:00-03:00' })?.titulo).toBe(
      'Tudo funcionando de novo desde 14:32',
    );
    expect(avisoGeral(painel([cartao('Meta Ads', 'ok')], 'em-dia'), dono)?.texto).toBe(
      'Os conectores ligados estão em dia.',
    );
  });

  it('só a ligar: nenhum ligado ainda', () => {
    const p = painel([cartao('GA4', 'not_connected'), cartao('Search Console', 'not_connected')], 'em-dia');
    expect(avisoGeral(p, dono)).toEqual({
      tom: 'info',
      titulo: 'Nenhum conector ligado ainda',
      texto: 'GA4 e Search Console ainda estão a ligar.',
    });
  });

  it('sem conectores, sem aviso', () => {
    expect(avisoGeral(painel([cartao('Meta Ads', null)], null), dono)).toBeNull();
  });
});
