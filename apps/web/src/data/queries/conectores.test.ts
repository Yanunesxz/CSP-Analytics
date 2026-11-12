import { describe, expect, it } from 'vitest';
import type { Connector } from '@csp-mkt/shared';
import { FILTROS_PADRAO, type Filtros } from '../../lib/url-state';
import { DADOS_VAZIOS, type Dados } from '../dados';
import { gerarDadosDeExemplo } from '../sample';
import {
  ORDEM_DOS_CONECTORES,
  painelDeConectores,
  rodadaAppsCrm,
  type ConectorComRodada,
} from './conectores';

const agora = new Date('2026-10-30T15:00:00-03:00');
const f = (parcial: Partial<Filtros> = {}): Filtros => ({ ...FILTROS_PADRAO, ...parcial });
const ha = (minutos: number): string => new Date(agora.getTime() - minutos * 60_000).toISOString();

const conector = (p: Pick<Connector, 'id' | 'status'> & Partial<Connector>): Connector => ({
  name: p.id,
  lastSyncAt: ha(10),
  expectedEveryMinutes: 60,
  errors24h: 0,
  rowsWritten: 100,
  ...p,
});

const comConectores = (connectors: Connector[]): Dados => ({ ...DADOS_VAZIOS, connectors });

describe('painelDeConectores', () => {
  it('sem conectores: um cartão por integração esperada, na ordem do menu, tudo sem dados', () => {
    const p = painelDeConectores({ ...DADOS_VAZIOS }, f(), agora);

    expect(p.cartoes.map((c) => c.id)).toEqual([...ORDEM_DOS_CONECTORES]);
    for (const c of p.cartoes) {
      expect(c).toMatchObject({
        estado: null,
        ultimaSincronizacao: null,
        minutosDesdeSync: null,
        atrasoMinutos: null,
        erros24h: null,
        linhasGravadas: null,
        temProblema: false,
      });
    }
    expect(p.resumo).toEqual({ ok: null, late: null, down: null, not_connected: null, disabled: null });
    expect(p.situacao).toBeNull();
    expect(p.comProblema).toEqual([]);
    expect(p.aLigar).toEqual([]);
    expect(p.ultimaSincronizacao).toBeNull();
    expect(p.agora).toBe(agora.toISOString());
  });

  it('só o CSP 360 traz a linha apps → CSP 360, mesmo sem dados', () => {
    const p = painelDeConectores({ ...DADOS_VAZIOS }, f(), agora);
    expect(p.cartoes.filter((c) => c.rodadaAppsCrm !== null).map((c) => c.id)).toEqual(['csp360']);
    expect(p.cartoes.find((c) => c.id === 'csp360')?.rodadaAppsCrm).toEqual({
      ultimaEm: null,
      minutosDesde: null,
      esperadoACadaMinutos: 10,
      atrasoMinutos: null,
      atrasada: false,
    });
  });

  it('o que pede ação vem primeiro: caído, atrasado, funcionando, a ligar, desligado e sem dados', () => {
    const p = painelDeConectores(
      comConectores([
        conector({ id: 'meta', status: 'ok', lastSyncAt: ha(12) }),
        conector({ id: 'tiktok', status: 'late', lastSyncAt: ha(190), errors24h: 3 }),
        conector({ id: 'google_ads', status: 'down', lastSyncAt: ha(300), errors24h: 12 }),
        conector({ id: 'ga4', status: 'not_connected', lastSyncAt: null, expectedEveryMinutes: 1440 }),
        conector({ id: 'csp360', status: 'ok', lastSyncAt: ha(3), expectedEveryMinutes: 5 }),
        // Desligado pelo dono: a última sincronização antiga não vira "atrasado" nem pede ação.
        conector({ id: 'instagram', status: 'disabled', lastSyncAt: ha(9000) }),
      ]),
      f(),
      agora,
    );

    expect(p.cartoes.map((c) => c.id)).toEqual([
      'google_ads',
      'tiktok',
      'csp360',
      'meta',
      'ga4',
      'instagram',
      'search_console',
    ]);
    expect(p.cartoes.map((c) => c.estado)).toEqual([
      'down',
      'late',
      'ok',
      'ok',
      'not_connected',
      'disabled',
      null,
    ]);
    expect(p.comProblema.map((c) => c.id)).toEqual(['google_ads', 'tiktok']);
    expect(p.aLigar.map((c) => c.id)).toEqual(['ga4']);
    expect(p.resumo).toEqual({ ok: 2, late: 1, down: 1, not_connected: 1, disabled: 1 });
    expect(p.situacao).toBe('caido');
    expect(p.ultimaSincronizacao).toBe(ha(3));
  });

  it('atraso = minutos desde a última sincronização além do esperado', () => {
    const p = painelDeConectores(
      comConectores([
        conector({ id: 'tiktok', status: 'late', lastSyncAt: ha(190), errors24h: 3, rowsWritten: 410 }),
        conector({ id: 'meta', status: 'ok', lastSyncAt: ha(12) }),
      ]),
      f(),
      agora,
    );

    expect(p.cartoes.find((c) => c.id === 'tiktok')).toMatchObject({
      nome: 'TikTok Ads',
      estado: 'late',
      minutosDesdeSync: 190,
      esperadoACadaMinutos: 60,
      atrasoMinutos: 130,
      erros24h: 3,
      linhasGravadas: 410,
      temProblema: true,
    });
    expect(p.cartoes.find((c) => c.id === 'meta')).toMatchObject({
      nome: 'Meta Ads',
      estado: 'ok',
      minutosDesdeSync: 12,
      atrasoMinutos: 0,
      temProblema: false,
    });
    expect(p.situacao).toBe('atrasado');
  });

  it('funcionando que passou do esperado vira atrasado; caído e a ligar ficam como vieram', () => {
    const p = painelDeConectores(
      comConectores([
        conector({ id: 'meta', status: 'ok', lastSyncAt: ha(75) }),
        conector({ id: 'ga4', status: 'not_connected', lastSyncAt: ha(5000), expectedEveryMinutes: 1440 }),
        conector({ id: 'instagram', status: 'down', lastSyncAt: ha(5) }),
      ]),
      f(),
      agora,
    );

    expect(p.cartoes.find((c) => c.id === 'meta')).toMatchObject({
      estado: 'late',
      atrasoMinutos: 15,
      temProblema: true,
    });
    expect(p.cartoes.find((c) => c.id === 'ga4')).toMatchObject({
      estado: 'not_connected',
      temProblema: false,
    });
    expect(p.cartoes.find((c) => c.id === 'instagram')).toMatchObject({
      estado: 'down',
      atrasoMinutos: 0,
      temProblema: true,
    });
  });

  it('tudo em dia, com um conector a ligar', () => {
    const p = painelDeConectores(
      comConectores([
        conector({ id: 'meta', status: 'ok', lastSyncAt: ha(12) }),
        conector({ id: 'ga4', status: 'not_connected', lastSyncAt: null }),
      ]),
      f(),
      agora,
    );

    expect(p.situacao).toBe('em-dia');
    expect(p.comProblema).toEqual([]);
    expect(p.resumo).toEqual({ ok: 1, late: 0, down: 0, not_connected: 1, disabled: 0 });
  });

  it('conector que nunca sincronizou: sem minutos nem atraso, e os erros continuam contando', () => {
    const p = painelDeConectores(
      comConectores([conector({ id: 'search_console', status: 'down', lastSyncAt: null, errors24h: 4 })]),
      f(),
      agora,
    );

    expect(p.cartoes[0]).toMatchObject({
      id: 'search_console',
      estado: 'down',
      minutosDesdeSync: null,
      atrasoMinutos: null,
      erros24h: 4,
      temProblema: true,
    });
    expect(p.ultimaSincronizacao).toBeNull();
  });

  it('marca, período e filtros de tela não mudam os conectores (eles não têm marca)', () => {
    const dados = gerarDadosDeExemplo({ agora });
    const todas = painelDeConectores(dados, f(), agora);
    const recortado = painelDeConectores(
      dados,
      f({ marca: 'cs', periodo: '7d', canal: 'meta', operador: 'claude', origem: 'site' }),
      agora,
    );
    expect(recortado).toEqual(todas);
  });

  it('com os dados de exemplo: TikTok atrasado na frente, GA4 a ligar no fim, nada inventado', () => {
    const p = painelDeConectores(gerarDadosDeExemplo({ agora }), f(), agora);

    expect(p.cartoes.map((c) => c.id)).toEqual([
      'tiktok',
      'csp360',
      'meta',
      'google_ads',
      'instagram',
      'search_console',
      'ga4',
    ]);
    expect(p.situacao).toBe('atrasado');
    expect(p.comProblema.map((c) => c.id)).toEqual(['tiktok']);
    expect(p.aLigar.map((c) => c.id)).toEqual(['ga4']);
    expect(p.resumo).toEqual({ ok: 5, late: 1, down: 0, not_connected: 1, disabled: 0 });
    expect(JSON.stringify(p)).not.toMatch(/NaN|Infinity/);
  });
});

describe('rodadaAppsCrm', () => {
  const csp360: ConectorComRodada = conector({
    id: 'csp360',
    status: 'ok',
    lastSyncAt: ha(3),
    expectedEveryMinutes: 5,
  });

  it('em dia até 10 minutos, atrasada depois disso', () => {
    expect(rodadaAppsCrm({ ...csp360, upstreamLastRunAt: ha(7) }, agora)).toEqual({
      ultimaEm: ha(7),
      minutosDesde: 7,
      esperadoACadaMinutos: 10,
      atrasoMinutos: 0,
      atrasada: false,
    });
    expect(rodadaAppsCrm({ ...csp360, upstreamLastRunAt: ha(25) }, agora)).toMatchObject({
      minutosDesde: 25,
      atrasoMinutos: 15,
      atrasada: true,
    });
  });

  it('sem o diário da sincronização do CSP 360: sem dados, nunca atrasada', () => {
    expect(rodadaAppsCrm(csp360, agora)).toMatchObject({
      ultimaEm: null,
      minutosDesde: null,
      atrasoMinutos: null,
      atrasada: false,
    });
    expect(rodadaAppsCrm(undefined, agora).ultimaEm).toBeNull();
  });

  it('o painel lê a rodada quando o conector do CSP 360 a traz', () => {
    const comRodada: ConectorComRodada = { ...csp360, upstreamLastRunAt: ha(25) };
    const p = painelDeConectores(comConectores([comRodada]), f(), agora);
    expect(p.cartoes.find((c) => c.id === 'csp360')?.rodadaAppsCrm).toMatchObject({
      minutosDesde: 25,
      atrasada: true,
    });
  });
});
