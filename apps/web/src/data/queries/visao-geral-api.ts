/**
 * A Visão geral a partir de `api.kpi_overview` (modo Supabase). Pura, com teste em `visao-geral-api.test.ts`: só muda
 * o formato, nunca soma, conta ou divide (decisão 0034; o banco faz a conta).
 *
 * Por enquanto o banco devolve só a mídia: o investimento do período, por marca e por canal. Leads, clientes novos,
 * custo por cliente novo, pedidos e Instagram chegam nulos ("Sem dados") até o CSP 360 chegar; Humano × Claude e a
 * verba por conta (visão Gestor) vêm de outras funções, que ainda não existem.
 */

import type { ApiKpiOverview } from '@csp-mkt/shared';
import type { Filtros } from '../../lib/url-state';
import type { LinhaCusto, Metrica } from '../queries';
import { intervaloDaApi, metricaDaApi } from './seo-geo-api';
import type { VisaoGeral } from './visao-geral';

const sem = (): Metrica => ({ atual: null, anterior: null, variacao: null });

function linha(marca: LinhaCusto['marca'], canal: LinhaCusto['canal'], investimento: Metrica): LinhaCusto {
  return {
    marca,
    canal,
    investimento,
    leads: sem(),
    custoPorLead: sem(),
    clientesNovos: sem(),
    custo: sem(),
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
      pedidos: sem(),
      valorPedidos: sem(),
      faturados: sem(),
      valorFaturado: sem(),
      alcanceInstagram: sem(),
    },
    clientesNovosDeCampanha: r.attributed_new_customers,
    leadsSemMarca: r.leads_without_brand,
    porMarca: r.by_brand.map((b) => linha(b.brand, null, metricaDaApi(b.investment))),
    porCanal: r.by_platform.map((p) => linha(null, p.platform, metricaDaApi(p.investment))),
    porDia: r.daily.map((d) => ({ date: d.metric_on, leads: d.leads, clientesNovos: d.new_customers })),
    gestor: null,
  };
}
