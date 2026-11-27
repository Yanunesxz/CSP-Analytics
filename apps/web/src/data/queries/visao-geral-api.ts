/**
 * A Visão geral a partir de `api.kpi_overview` (modo Supabase). Pura, com teste em `visao-geral-api.test.ts`: só muda
 * o formato, nunca soma, conta ou divide (decisão 0034; o banco faz a conta).
 *
 * O banco devolve a mídia e o CSP 360: investimento, leads, clientes novos, custo por cliente novo e pedidos enviados,
 * no total, por marca e por canal. Sem a base de cada fonte, o número chega nulo ("Sem dados"). O valor faturado e o
 * Instagram ficam nulos até o Control e o conector do Instagram; Humano × Claude e a verba por conta (visão Gestor) vêm
 * de outras funções, que ainda não existem.
 */

import type { ApiKpiOverview, ApiKpiOverviewLine } from '@csp-mkt/shared';
import type { Filtros } from '../../lib/url-state';
import type { LinhaCusto, Metrica } from '../queries';
import { intervaloDaApi, metricaDaApi } from './seo-geo-api';
import type { VisaoGeral } from './visao-geral';

const sem = (): Metrica => ({ atual: null, anterior: null, variacao: null });

function linha(marca: LinhaCusto['marca'], canal: LinhaCusto['canal'], l: ApiKpiOverviewLine): LinhaCusto {
  return {
    marca,
    canal,
    investimento: metricaDaApi(l.investment),
    leads: metricaDaApi(l.leads),
    custoPorLead: metricaDaApi(l.cost_per_lead),
    clientesNovos: metricaDaApi(l.new_customers),
    custo: metricaDaApi(l.cost_per_new_customer),
  };
}

export function visaoGeralDaApi(r: ApiKpiOverview, filtros: Filtros, agora: Date = new Date()): VisaoGeral {
  return {
    intervalo: intervaloDaApi(r, filtros, agora),
    numeros: {
      leads: metricaDaApi(r.leads),
      clientesNovos: metricaDaApi(r.new_customers),
      custoPorClienteNovo: metricaDaApi(r.cost_per_new_customer),
      investimento: metricaDaApi(r.investment),
      pedidos: metricaDaApi(r.orders.count),
      valorPedidos: metricaDaApi(r.orders.total_cents),
      faturados: metricaDaApi(r.orders.invoiced_count),
      valorFaturado: metricaDaApi(r.orders.invoiced_total_cents),
      alcanceInstagram: sem(),
    },
    clientesNovosDeCampanha: r.attributed_new_customers,
    leadsSemMarca: r.leads_without_brand,
    porMarca: r.by_brand.map((b) => linha(b.brand, null, b)),
    porCanal: r.by_platform.map((p) => linha(null, p.platform, p)),
    porDia: r.daily.map((d) => ({ date: d.metric_on, leads: d.leads, clientesNovos: d.new_customers })),
    gestor: null,
  };
}
