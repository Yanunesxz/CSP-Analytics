/** Todas as rotas do sistema: o menu, o Diagnóstico e o docs/telas/README.md seguem esta lista. */
export const ROTAS = [
  '/',
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
