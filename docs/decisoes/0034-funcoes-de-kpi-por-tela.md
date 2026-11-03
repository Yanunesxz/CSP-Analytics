# 0034 — Funções de KPI por tela, base de cada fonte e relógio do banco

- **Data:** 2026-11-03
- **Status:** proposta (técnica, aguarda a aprovação do modelo; detalha a 0001 e a 0013)

## Contexto

A decisão 0013 expõe só o esquema `api`, com funções de KPI que recebem os filtros. Faltava dizer o formato da
resposta, como os filtros chegam, quem diz "hoje", como o banco separa "Sem dados" de 0 sem ler a tabela inteira e como
nenhuma chamada passa de 1.000 linhas.

## Decisão

- **Uma função por tela** (`api.kpi_overview`, `api.kpi_acquisition`… e `api.kpi_operators` e `api.kpi_spend_limits`,
  usadas por várias), que devolve um `jsonb` pequeno, já agregado. Listas em `api.list_*`, com até 200 itens e o total.
  Nenhuma chamada traz mais de 1.000 linhas.
- **Filtros** num objeto com chaves e códigos em inglês. A tela traduz a URL numa função só; chave desconhecida dá
  `KPI-400`.
- **Período e "hoje" no banco:** `mkt.period_window` e `mkt.today()`, no fuso de São Paulo. Os testes fixam o relógio
  numa tabela que só existe no PGlite (`test.clock`, do arquivo de apoio; na demonstração fica vazia); em produção vale
  o relógio do banco, e nenhuma sessão muda o "hoje" das contas (a trava do limite usa o mesmo relógio). A comparação
  usa só os dias completos de cada fonte.
- **Sem dados × 0:** a fonte tem base quando o conector já trouxe dado alguma vez (`connectors.first_success_at`, que
  o worker preenche e que nunca volta a nulo) e a conta, o perfil ou a propriedade da marca também
  (`first_read_at`). Dado do próprio CSP-MKT sempre tem base.
- **Permissão:** cada função confere, na primeira linha, todas as permissões das tabelas que lê; quem não tem uma
  delas recebe `KPI-403`, nunca um 0 que a RLS produziu.
- **Três camadas:** fatos (views `mkt.v_*`, todas com `security_invoker`), fórmulas (funções `mkt.*`, cada uma num lugar
  só) e tela (`api.*`). Número com comparação sai como `{current, previous, variation}`.
- **Unidades:** dinheiro em centavos inteiros; taxa e parte com 4 casas; ROAS com 2; a variação é calculada antes de
  arredondar.

## Alternativas consideradas

- **Views de `api` filtradas pela URL do PostgREST:** não recebem o período nem fazem "As duas" contando o cliente uma
  vez.
- **Várias funções pequenas por bloco:** muitas chamadas por tela e a mesma leitura feita várias vezes.
- **"Sem dados" pela tabela vazia, como o protótipo:** lê a tabela toda e erra nos dois sentidos: "Sem dados" para o
  canal ligado e sem gasto, 0 para o canal que nem foi ligado.
- **Relógio do navegador:** cada pessoa veria um "hoje".

## Consequências

- `connectors` ganha `first_success_at` e `last_success_at`; contas, perfis e propriedades ganham `first_read_at`
  (`docs/dados/tabelas.md`).
- `periodo.ts` e as consultas de `queries*.ts` saem quando a versão SQL passar nos mesmos casos (decisão 0018).
- A tela monta rótulos a partir das datas e dos códigos que a função devolve.
- O teste de RLS confere `security_invoker` também nas views de `mkt`.
