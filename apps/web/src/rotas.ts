/** Todas as rotas do sistema: o menu, o Diagnóstico e o docs/telas/README.md seguem esta lista. */
export const ROTAS = [
  '/',
  '/resumo',
  '/chegada',
  '/base',
  '/leads',
  '/canais/meta',
  '/canais/tiktok',
  '/canais/google',
  '/instagram',
  '/seo-geo',
  '/trafego',
  '/conectores',
  '/usuarios',
  '/diagnostico',
  '/configuracoes',
] as const;

export type Rota = (typeof ROTAS)[number];

/* Âncoras que outras telas usam para abrir uma tela já no bloco certo, com `linkCom`
   (ex.: linkCom('/chegada#custo-por-cliente-novo')). A tela de destino rola até o bloco. */

/** Chegada de clientes: custo por cliente novo por marca e canal (tarefa T1). */
export const ANCORA_DO_CUSTO = 'custo-por-cliente-novo';
/** Base de clientes: a lista com os filtros rápidos (tarefa T5). */
export const ANCORA_DA_LISTA_DA_BASE = 'lista-de-clientes';
