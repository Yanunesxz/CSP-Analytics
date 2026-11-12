# Contrato dos módulos — fundação do protótipo (fase 2)

> Para quem vai construir um módulo em `apps/web/src/modules/<modulo>/`. Tudo que a tela precisa já existe:
> store, queries, filtros na URL, sessão, casca e componentes `yn-*` em React. Leia isto, não o código inteiro.
> Regras gerais: `CLAUDE.md` (regras vigentes) e `PADRAO-YAN-NUNES.md` (seções 5, 7, 8).

## 1. Estrutura de pastas

```
apps/web/
  index.html                      head do padrão (tema, Manrope, tokens.css e componentes.css do jsDelivr)
  vite.config.ts                  React + Tailwind 4 + plugin que gera public/version.json
  src/
    main.tsx · App.tsx            rotas (React.lazy + limite de erro + rota protegida por papel)
    rotas.ts                      ROTAS: lista de todas as rotas (menu, Diagnóstico e docs seguem ela)
    index.css                     @import tailwindcss + @theme inline do padrão + grades .mkt-*
    styles/series.css             --color-series-1..6 (decisão 0007), claro e escuro
    lib/
      tema.ts · url-state.ts · format.ts · datas.ts · periodo.ts · versao.ts · auth.ts
    data/
      dados.ts                    tipo Dados (o conjunto inteiro) e DADOS_VAZIOS
      store.ts                    store em memória, useDados, useConsulta, Resultado
      queries.ts                  consultas puras (as futuras views SQL)
      actions.ts                  ações que gravam no store (aprovar, descartar, parar tudo…)
      sample/index.ts             gerador determinístico dos dados de exemplo
    components/
      layout/                     Shell, Sidebar, Topbar, PageHeader (pagina.tsx), LimiteDeErro, RotaProtegida
      ui/                         Kpi, GraficoLinha, GraficoBarras, GraficoColunas, Tabela, BarraDeFiltros,
                                  Vazio, Esqueleto, Badge, ChipSerie, Meter, Ranking, ToastRegion, Tela, AsTable
    modules/<modulo>/index.tsx    a tela (export default); subcomponentes na mesma pasta
packages/shared/src/              types.ts · labels.ts · rules.ts (importe de '@csp-mkt/shared')
```

Identificadores em inglês; nomes de pasta de tela em português; tudo que a pessoa lê em pt-BR.

## 2. Como registrar a página

A rota já existe em `src/App.tsx` e no menu (`src/components/layout/Sidebar.tsx`). O módulo só substitui o
`index.tsx` da sua pasta, mantendo o `export default`. Esqueleto mínimo de uma tela de números:

```tsx
import { PageHeader } from '../../components/layout/pagina';
import { BarraDeFiltros, Kpi, Tela } from '../../components/ui';
import { useConsulta } from '../../data/store';
import { kpisVisaoGeral } from '../../data/queries';

export default function VisaoGeral() {
  const r = useConsulta(kpisVisaoGeral);          // honra ?estado= e os filtros da URL sozinho
  return (
    <>
      <PageHeader grupo="Início" titulo="Visão geral" atualizadoEm={r.atualizadoEm} />
      <BarraDeFiltros campos={['canal', 'operador']} />
      <Tela resultado={r}>
        {(k) => (
          <div className="mkt-grid-kpis">
            <Kpi rotulo="Custo por cliente novo" metrica={k.custoPorClienteNovo} formato="dinheiro" menorEhMelhor deltaTexto={k.intervalo.rotuloAnterior} para="/chegada" />
          </div>
        )}
      </Tela>
    </>
  );
}
```

- **Um `PageHeader` por tela** (`grupo`, `titulo`, `acao?` = o único botão principal, `atualizadoEm?`). Ele não desenha
  nada: o h1 fica na barra do topo e o `document.title` vira "Título · CSP-MKT".
- A rota de canais é uma só: `/canais/:plataforma` → `src/modules/canais/index.tsx` lê `useParams().plataforma`
  (`meta | tiktok | google`).
- Rotas protegidas (`/trafego`, `/usuarios`, `/diagnostico`) já passam por `RotaProtegida`; o módulo não confere papel
  para abrir, mas confere para mostrar botões (`pode(perfil.role, 'aprovar_acao')`).

## 3. Sessão e papel — `src/lib/auth.ts`

```ts
useSessao(): { modo: 'demonstracao' | 'supabase'; perfil: Profile | null; carregando: boolean; sair(): Promise<void> }
PERFIL_DEMONSTRACAO: Profile   // { id: 'demo-owner', name: 'Dono (demonstração)', email, role: 'owner' }
iniciais(nome): string         // para .yn-avatar
```

Permissões vêm de `@csp-mkt/shared`: `pode(role, acao)`, `permissoes(role)`, `ROTAS_PROTEGIDAS`. Ações:
`ver_numeros | ver_leads | ver_lead_dado_pessoal (ninguém) | ver_trafego_ia | operar_trafego_ia | aprovar_acao |
parar_tudo | ver_conectores | tentar_conector_de_novo | gerir_usuarios | ver_diagnostico | editar_configuracoes`.
`owner` tem tudo; `traffic_manager` tem `ver_numeros, ver_leads, ver_trafego_ia, operar_trafego_ia, ver_conectores,
editar_configuracoes`. A Visão (`?visao=`) muda o que a tela mostra; o papel muda o que a pessoa pode fazer.

## 4. Filtros na URL — `src/lib/url-state.ts`

```ts
interface Filtros {
  marca: 'cs' | 'plumene' | 'todas';            // padrão 'todas'; também em localStorage "marca"
  visao: 'visualizador' | 'gestor';             // padrão 'visualizador'; também em localStorage "visao"
  periodo: 'este-mes' | 'mes-passado' | '7d' | '30d' | '90d';   // padrão 'este-mes'
  comparar: boolean;                            // padrão true (compara com o período anterior)
  canal: 'meta' | 'tiktok' | 'google' | null;
  campanha: string | null;                      // id ou utmCampaign
  operador: 'human' | 'claude' | 'todos';       // padrão 'todos'
  origem: LeadSource | null;
  representante: string | null;                 // repId
  estado: 'carregando' | 'vazio' | 'erro' | 'sem-dados' | null;   // demonstração
}

useFiltros(): {
  filtros: Filtros;
  definir(parcial: Partial<Filtros>): void;     // grava na URL (replace); null limpa a chave
  limpar(chaves?: ChaveFiltro[]): void;         // sem argumento: canal, campanha, operador, origem, representante
  ativos: ChaveFiltro[];                        // filtros de tela diferentes do padrão
  linkCom(pathname, parcial?): string;          // caminho com os filtros globais (marca, visao, periodo, comparar, estado)
  searchGlobal: string;                         // "?marca=cs&periodo=7d" para <Link to={{ pathname, search }}>
}
```

A URL vence; marca e visão caem para o localStorage e depois para o padrão. Links entre telas usam `linkCom` ou
`searchGlobal` para a marca, a visão e o período seguirem a pessoa. Nunca guarde filtro em estado React.

Período → intervalo (`src/lib/periodo.ts`): `intervaloDoPeriodo(periodo, agora?) → { inicio, fim, anteriorInicio,
anteriorFim, dias, rotulo, rotuloAnterior }` (dias de São Paulo, `AAAA-MM-DD`); `PERIODOS` para selects.

## 5. Store e consultas — `src/data/store.ts`, `src/data/queries.ts`

A tela não sabe o modo (demonstração ou Supabase). Ela chama:

```ts
useConsulta<T>(consulta: (dados: Dados, filtros: Filtros, agora: Date) => T): Resultado<T>
interface Resultado<T> {
  estado: 'carregando' | 'vazio' | 'erro' | 'sem-dados' | 'ok';
  dados: T | null;            // em 'ok' e 'sem-dados' (neste, as métricas vêm null)
  codigo: string | null;      // 'DEMO-500' em erro
  filtros: Filtros;
  atualizadoEm: string | null;
}
```

`useConsulta` honra `?estado=` sozinho e devolve `vazio` quando o store está vazio. O componente `Tela` desenha
carregando/erro/vazio e chama `children(dados, estado)` em `ok` e `sem-dados`. Passe a query direto
(`useConsulta(kpisVisaoGeral)`); para uma query com argumento extra, declare a função fora do componente ou use
`useCallback`, senão recalcula a cada render.

Outros exports do store: `useDados(): Dados` (bruto), `store.recomecar()`, `store.alterar(fn)`, `store.demonstracao`,
`store.comDadosDeExemplo`. Ações prontas em `src/data/actions.ts`: `aprovarAcao(id, por)`, `descartarAcao(id, motivo)`,
`marcarAcaoComoFeita(id, por, resultado)`, `proporAcao(acao)`, `pararTudo(marca?) → quantas pausou`,
`tentarConectorDeNovo(id)`. Depois de uma ação, avise com `useToast().avisar('Proposta aprovada.')`.

### Queries (todas `(dados, filtros, agora = new Date())`, puras, com teste)

| Função | Devolve (campos principais) |
|---|---|
| `kpisVisaoGeral` | `leads, clientesNovos, custoPorClienteNovo, custoPorLead, investimento, pedidos, valorPedidos, faturados, valorFaturado (sempre null), alcanceInstagram: Metrica; porMarca[{ marca, investimento, clientesNovos, custoPorClienteNovo }]; porCanal[{ canal, investimento, leads, clientesNovos, custoPorClienteNovo }]; intervalo` |
| `funilChegada` | `etapas[{ etapa, rotulo, total, anterior, taxa }]` (acumuladas: lead → prospect → registered → first_order → invoiced), `taxaLeadParaCliente: Metrica, tempoMedioAtePedidoDias, porOrigem[], porRepresentante[], coorte[{ mes, leads, clientesNovos, taxa }]` |
| `custoPorClienteNovo` | `linhas[]` (marca × canal), `porMarca[]`, `porCanal[]`, `total`; cada linha `{ marca, canal, investimento, leads, custoPorLead, clientesNovos, custo: Metrica }` |
| `metricasPorCampanha` | `linhas[{ campanha, investimento, impressoes, cliques, ctr, cpc, leads, cpl, conversoes, cpa, roas, clientesNovos, custoPorClienteNovo: Metrica, usoDoTeto }]`, `totais`, `serie[{ date, investimento, leads, cliques }]` |
| `porOperador` | `linhas[{ chave, rotulo, formato, humano, claude, diferenca, menorEhMelhor }]` (a mesma linha Humano × Claude com a diferença em %), `porCanal[{ canal, humano, claude, diferencaCpl }]` |
| `baseDeClientes` | `total, ativos, inativosRecentes, inativosAntigos, perdidos, semSituacao, antigos, recompraram, taxaRecompra, reativados, receitaAntigos, receitaNovos, participacaoAntigos, porSituacao[], lista[ClienteDaBase]` (`diasDesdeUltimaCompra, comprouNoPeriodo, reativado, receitaNoPeriodoCents`) |
| `leadsPorOrigem` | `total: Metrica, semMarca, linhas[{ origem, leads: Metrica, clientesNovos, taxaConversao, custoPorLead }], porDia[{ date, total, porOrigem }], lista[{ id, code, origem, marca, etapa, criadoEm, representante, linkCrm }]` (sem dado pessoal) |
| `instagram` | `porMarca[{ marca, seguidores, variacaoSeguidores, alcance, impressoes, engajamento, taxaEngajamento, salvos, posts }], serie[], posts[IgMedia]` |
| `seoGeo` | `seo: { impressoes, cliques, ctr, posicaoMedia, serie[] }`, `geo: { sessoes, leadsPorAssistente, clientesNovosPorAssistente, porFonte[{ fonte, sessoes, leads }], serie[] }` |
| `acoes` | `lista[TrafficAction], porStatus, filaDeAprovacao[], emExecucao[], pendencias[], resumo{ propostas, aprovadas, executadas, descartadas, tempoMedioAteAprovacaoHoras, custoEstimadoDaFilaCents }, tetos[{ marca, canal, investimento, teto, uso, campanhasAtivas }]` |
| `resumoSimples` (em `data/queries/resumo-simples.ts`) | `total, anterior: { investimento, interessados, clientesNovos, custoPorClienteNovo, valorDosPrimeirosPedidos, retornoPorReal }` (os números da T1 mais o que voltou, decisão 0028), `todasAsOrigens{ interessados, clientesNovos }, porCanal[] (+ parcelaDoGasto), porMarca[], campanhas[] (só as com movimento), campanhasSemMovimento` |
| `conectores(dados, agora?)` | `lista[Connector & { minutosDesdeSync, atrasoMinutos, atrasado }], resumo{ ok, late, down, simulated }, ultimaSincronizacao` |

`Metrica = { atual: number | null; anterior: number | null; variacao: number | null }`. Métrica sem base é `null`
(nunca 0 nem NaN); contagem sobre tabela vazia é `null`, sobre tabela com linhas é 0 ou mais. Utilidades exportadas:
`filtrarPeriodo(linhas, campo, { inicio, fim })`, `filtrarMarca`, `metrica`, `razao`, `soma`, `contagem`, `ETAPAS`,
e as regras de lead e de cliente novo: `leadsFiltrados(dados, filtros)`, `chegouAoPedido(lead)` e
`clientesNovos(leads, janela)` (um por cliente, no dia do 1º pedido), e os recortes de campanha:
`campanhasFiltradas(dados, filtros)` e `comCampanha(leads, campanhas)` (atribuição pela UTM). Use essas, nunca uma
cópia: nenhuma regra em dois lugares. Dinheiro sempre em centavos.

## 6. Componentes — `src/components/ui` (importe de `'../../components/ui'`)

| Componente | Props |
|---|---|
| `Kpi` | `rotulo; metrica?: Metrica` ou `valor?: number \| null` + `delta?`; `formato?: 'numero' \| 'dinheiro' \| 'percentual' \| 'decimal' \| 'abreviado' \| 'dinheiroAbreviado'; casas?; deltaTexto?` ("vs. mês anterior"); `menorEhMelhor?` (custo: cair é verde); `nota?; para?` (rota da tela que trabalha o número; leva os filtros globais) `; paraFiltros?; semDadosTexto?`. Null = "Sem dados". |
| `GraficoLinha` | `titulo; descricao?; series: { id, rotulo, cor, pontos: { x: 'AAAA-MM-DD', y: number \| null }[] }[]` (1 a 6; `cor` = `cor('platform','meta')` de shared); `formato?; formatoEixo?; area?; altura?; estado?: 'ok' \| 'semDados' \| 'erro' \| 'carregando'; aoTentarDeNovo?; codigoErro?`. Sempre com "Ver como tabela". |
| `GraficoBarras` | `titulo; descricao?; itens: { rotulo, valor, cor?, tom?, detalhe? }[]; formato?; maximo?; estado?; rotuloValor?` (`.yn-bars`) |
| `GraficoColunas` | `titulo; descricao?; colunas: { rotulo, valor, cor?, tom? }[]; formato?; maximo?; altura?; estado?; rotuloValor?` (`.yn-columns`) |
| `Tabela<T>` | `colunas: { chave, titulo, numerica?, valor?(linha), render?(linha), ordenavel? }[]; linhas: T[]; chaveDaLinha(linha); empilhar?` (cards no celular) `; ordenacaoInicial?: { chave, direcao }; legenda?; vazio?: ReactNode; selecionada?(linha)` |
| `BarraDeFiltros` | `rapidos?: { chave, valor, rotulo, contagem?, cor? }[]` (até 5 chips `aria-pressed`); `campos?: ('canal' \| 'campanha' \| 'operador' \| 'origem' \| 'representante')[]` (padrão canal, operador, origem) `; opcoes?: { campanhas?, representantes? }` (`{ valor, rotulo }[]`, vindos dos dados) `; semPeriodo?; semComparacao?`. Período + "Comparar com o anterior", botão "Filtros" com `.yn-drawer` (só quando `campos` não é vazio), chips ativos com "Remover filtro X", "Limpar filtros" (uma gravação só; no painel, volta também o período), "Meus filtros" (localStorage `meus-filtros`). |
| `Tela<T>` | `resultado: Resultado<T>; vazio?: { titulo?, texto?, icone?, acao? }` (`acao: null` tira o link "Ver conectores") `; erroTexto?; esqueleto?: 'tela' \| 'kpis' \| 'grafico' \| 'tabela' \| 'texto'; aoTentarDeNovo?; children: (dados, estado: 'ok' \| 'sem-dados') => ReactNode` |
| `Vazio` | `titulo; texto?; icone?; erro?; codigo?; aoTentarDeNovo?; acao?` (`.yn-empty`, `data-state="error"` + "Tentar de novo") |
| `Esqueleto` | `variante?: 'texto' \| 'kpis' \| 'grafico' \| 'tabela' \| 'tela'; quantidade?` |
| `Badge` | `lista + codigo` (ex.: `lista="actionStatus" codigo={a.status}`) ou `tom + children` |
| `ChipSerie` | `lista + codigo` (brand, platform, operator, leadSource, geoSource) ou `rotulo + cor`; `pressionado?; aoClicar?; contagem?`. `PontoDeSerie({ cor })` para o ponto sozinho. |
| `Meter` | `rotulo; valor; maximo; esperado?; formato?; legenda?; estado?: 'behind' \| 'ahead' \| 'done'` (`.yn-meter`) |
| `Ranking` | `itens: { id, rotulo, valor (formatado), iniciais?, cor?, atual? }[]; rotulo?` |
| `AsTable` | `colunas: string[]; linhas: ReactNode[][]; legenda?; texto?: number[]` — "Ver como tabela" para um gráfico próprio. A 1ª coluna e as de `texto` (ex.: "Detalhe") alinham à esquerda e quebram linha; as outras são número, numa linha só. O cabeçalho quebra linha para a tabela caber num cartão de meia tela |
| `useToast()` | `avisar(texto, { tom?: 'success' \| 'danger', duracaoMs? })` — a casca já tem o `ToastProvider` |
| `EmConstrucao` | marcador temporário; some quando o módulo fica pronto |

Grades em `index.css`: `.mkt-grid-kpis` (cards de KPI), `.mkt-grid-2` (dois blocos lado a lado), `.mkt-stack`,
`.mkt-actions`, `.mkt-filters`. Para o resto do layout, Tailwind só de espaçamento e grade (`grid`, `gap-4`, `flex`).

O que o `index.css` já resolve para toda tela (não precisa de contorno no módulo): a coluna do `.yn-content` e a do
`.mkt-chart` não crescem com o conteúdo (fila de chips ou tabela larga rola dentro do bloco, sem rolagem lateral na
página); `<dialog class="yn-modal">` abre no meio; `.yn-table-wrap` e `.yn-tabs` seguram o `.yn-sr-only` de dentro;
`.yn-tabs` sem barra de rolagem em pé; link no meio do texto sublinhado. Cuidados que continuam valendo:

- O `componentes.css` do padrão entra sem camada e vence os utilitários do Tailwind (que ficam em `@layer
  utilities`): `p-0` não tira o padding do `.yn-card`, `text-xl` não muda um `h2`. Use a classe do padrão ou estilo
  em linha com token.
- `Tabela` com `empilhar`: célula com mais de um nó (texto + `span`) se espalha no celular, porque o `td` vira flex com
  `space-between`; envolva o conteúdo da célula num elemento só.

Formatação (`src/lib/format.ts`): `dinheiro(cents)` ("R$ 1.234" ou "R$ 1.234,56"), `dinheiroAbreviado`,
`numero(n, casas?)`, `numeroAbreviado` ("82,4 mil"), `percentual(fracao)`, `variacao(fracao)` ("+12,4%"),
`diferenca(atual, anterior)`, `data`, `dataHora`, `hora`, `diaMes`, `diaMesCurto`, `mesAno`, `atualizadoHa(iso)`,
`plural`. Null vira "—"; o "Sem dados" é do `Kpi`.

Rótulos e cores (`@csp-mkt/shared`): `rotulo(lista, codigo)`, `cor(lista, codigo)` (token `var(--color-…)`),
`tom(lista, codigo)`, `opcoes(lista)`, `rotuloMarca(marca)`, `SEM_MARCA`. Listas: `brand, platform, operator,
campaignStatus, leadStage, leadSource, customerSituation, orderStatus, igMediaType, geoSource, actionKind,
actionStatus, level, connectorId, connectorStatus, role`.

## 7. Como honrar `?estado=`

Use `useConsulta` + `Tela` e está feito: `carregando` mostra o esqueleto; `vazio` mostra o próximo passo; `erro`
mostra "Não deu para carregar" com "Tentar de novo" (que tira o parâmetro); `sem-dados` roda a query sobre o conjunto
vazio, então cada `Kpi` mostra "Sem dados" e cada gráfico recebe `estado="semDados"` quando a série vier sem valor.
Se a tela tiver vários blocos com queries próprias, use um `useConsulta` por bloco e um `Tela` por bloco, ou
leia `resultado.estado` e passe `estado={r.estado === 'sem-dados' ? 'semDados' : 'ok'}` para os gráficos.

Nunca invente número: métrica `null` é "Sem dados", em KPI, tabela ("—") e gráfico.

## 8. Textos

- pt-BR, "você", frase curta, verbo no começo ("Ver leads", "Aprovar proposta", "Tentar de novo").
- Sucesso: "Proposta aprovada." Erro: "Não deu para carregar: …". Vazio: "Nenhum lead ainda. …próximo passo".
- "Sem dados" nunca vira 0. Status em português pelo `rotulo()`; o código nunca aparece na tela.
- Um botão principal (`.yn-btn--primary`) por tela, passado em `PageHeader acao` ou dentro do bloco que o pede.
- Nada de nome de pessoa, telefone, e-mail, CNPJ ou dado de cliente em código, dado de exemplo ou texto.

## 9. Proibido

- Cor crua, paleta do Tailwind, `rounded-xl/2xl`, `shadow-xl`, `text-[11px]`, fonte ou tamanho fixo. Cores só por
  token (`var(--color-…)`) e pelas classes do padrão; cor de série só para marca, canal (e origem do lead, inclusive o
  assistente de IA) e operador, sempre com rótulo (decisão 0007).
- Componente inventado quando existe `yn-*` ou um dos componentes acima.
- Somar linhas ou calcular KPI dentro da tela: toda conta vive em `queries.ts` (com teste). Precisa de um número
  novo? Adicione a query, teste e depois use.
- Guardar filtro em estado React, criar rota de filtro, pôr tema na URL.
- Chamar Supabase, Claude API ou plataforma direto da tela; `fetch` só por `lib/` ou `data/`.
- Mais de um `h1`, botão só com ícone sem `aria-label`, gráfico sem "Ver como tabela", texto abaixo de 12px.
- Importar o `index.tsx` de outro módulo. O que é comum vai para `components/ui` ou `data/`.

## 10. Antes de entregar o módulo

`pnpm verify` verde (tipos, lint, testes, build); tela conferida em 1280px e 375px, claro e escuro, nos cinco
estados (`?estado=`); as 8 perguntas de UX respondidas; `docs/telas/<modulo>.md` com a tela e os estados.
