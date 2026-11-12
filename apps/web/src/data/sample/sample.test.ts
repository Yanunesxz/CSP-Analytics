import { describe, expect, it } from 'vitest';
import { gerarDadosDeExemplo } from './index';

const agora = new Date('2026-10-30T15:00:00-03:00');

describe('gerarDadosDeExemplo', () => {
  const dados = gerarDadosDeExemplo({ agora });

  it('é determinístico: mesma semente, mesmos dados', () => {
    const outra = gerarDadosDeExemplo({ agora });
    expect(outra).toEqual(dados);
    expect(gerarDadosDeExemplo({ agora, semente: 1 }).leads.length).not.toBe(0);
  });

  it('cobre os últimos 120 dias relativos a hoje', () => {
    const dias = new Set(dados.metrics.map((m) => m.date));
    expect(Math.max(...[...dias].map((d) => (d <= '2026-10-30' ? 1 : 0)))).toBe(1);
    expect([...dias].every((d) => d >= '2026-07-03' && d <= '2026-10-30')).toBe(true);
    expect(dados.igDaily.filter((d) => d.brandId === 'cs')).toHaveLength(120);
  });

  it('tem 6 a 8 campanhas por plataforma, com gestão mista', () => {
    for (const platform of ['meta', 'tiktok', 'google'] as const) {
      const lista = dados.campaigns.filter((c) => c.platform === platform);
      expect(lista.length).toBeGreaterThanOrEqual(6);
      expect(lista.length).toBeLessThanOrEqual(8);
    }
    expect(dados.campaigns.some((c) => c.managedBy === 'claude')).toBe(true);
    expect(dados.campaigns.some((c) => c.managedBy === 'human')).toBe(true);
    expect(new Set(dados.campaigns.map((c) => c.utmCampaign)).size).toBe(dados.campaigns.length);
  });

  it('leads entre 300 e 600, com fontes variadas, UTM casando com campanha e SDR sem marca', () => {
    expect(dados.leads.length).toBeGreaterThanOrEqual(300);
    expect(dados.leads.length).toBeLessThanOrEqual(600);
    const utms = new Set(dados.campaigns.map((c) => c.utmCampaign));
    for (const lead of dados.leads) {
      if (lead.utmCampaign) expect(utms.has(lead.utmCampaign)).toBe(true);
      if (lead.source === 'sdr') expect(lead.brandId).toBeNull();
      if (lead.source === 'organic' || lead.source === 'ai_assistant')
        expect(lead.referrerHost).not.toBeNull();
      if (lead.stage === 'first_order' || lead.stage === 'invoiced') {
        expect(lead.firstOrderAt).not.toBeNull();
        expect(lead.crmCustomerId).not.toBeNull();
      }
      expect(lead.code).toMatch(/^LEAD-\d{4}$/);
    }
    expect(new Set(dados.leads.map((l) => l.source)).size).toBeGreaterThanOrEqual(8);
    expect(new Set(dados.leads.map((l) => l.stage)).size).toBe(5);
  });

  it('400 clientes com situação, pedidos enviados e faturados sem valor faturado', () => {
    expect(dados.customers).toHaveLength(400);
    expect(dados.customers.some((c) => c.situation === 'inactive_old')).toBe(true);
    expect(dados.customers.some((c) => c.situation === null)).toBe(true);
    expect(dados.orders.every((o) => o.status === 'sent')).toBe(true);
    expect(dados.orders.some((o) => o.isInvoiced)).toBe(true);
    expect(dados.orders.every((o) => o.invoicedTotalCents === null)).toBe(true);
    const ids = new Set(dados.customers.map((c) => c.id));
    expect(dados.orders.every((o) => ids.has(o.customerId))).toBe(true);
  });

  it('Instagram, SEO, GEO, ações e conectores', () => {
    expect(dados.igMedia.filter((p) => p.brandId === 'plumene')).toHaveLength(30);
    expect(dados.seoDaily).toHaveLength(240);
    expect(dados.geoDaily).toHaveLength(240 * 5);
    expect(dados.actions.length).toBeGreaterThanOrEqual(15);
    expect(dados.actions.length).toBeLessThanOrEqual(25);
    expect(new Set(dados.actions.map((a) => a.status)).size).toBe(5);
    const doClaude = dados.actions.filter((a) => a.proposedBy === 'claude').length;
    expect(doClaude).toBeGreaterThanOrEqual(Math.floor(dados.actions.length / 2) - 2);
    expect(dados.connectors).toHaveLength(7);
    expect(dados.connectors.find((c) => c.id === 'csp360')?.status).toBe('ok');
    expect(dados.connectors.find((c) => c.id === 'ga4')?.status).toBe('not_connected');
    expect(dados.connectors.filter((c) => c.status === 'late')).toHaveLength(1);
  });

  it('nada fica depois de agora, nem quando o dia mal começou', () => {
    for (const quando of [agora, new Date('2026-10-30T09:05:00-03:00')]) {
      const d = gerarDadosDeExemplo({ agora: quando });
      const instantes = [
        ...d.leads.flatMap((l) => [l.createdAt, l.firstOrderAt]),
        ...d.customers.flatMap((c) => [c.firstOrderAt, c.lastOrderAt]),
        ...d.orders.map((p) => p.createdAt),
        ...d.igMedia.map((p) => p.publishedAt),
        ...d.actions.flatMap((a) => [a.createdAt, a.approvedAt, a.executedAt]),
      ].filter((v): v is string => Boolean(v));
      expect(instantes.filter((v) => Date.parse(v) > quando.getTime())).toEqual([]);
      for (const a of d.actions) {
        if (a.approvedAt) expect(a.approvedAt >= a.createdAt).toBe(true);
        if (a.executedAt && a.approvedAt) expect(a.executedAt >= a.approvedAt).toBe(true);
      }
    }
  });

  it('não tem nome de pessoa nem dado pessoal', () => {
    const texto = JSON.stringify(dados);
    expect(texto).not.toMatch(/@(?!example\.com)/);
    expect(texto).not.toMatch(/\(\d{2}\) 9?\d{4}-\d{4}/);
  });
});
