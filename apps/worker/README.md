# Worker de leitura (Python)

Lê as fontes e grava no banco pelas funções `ingest.*`, com o papel `mkt_worker`
([`docs/dados/integracoes.md`](../../docs/dados/integracoes.md), seção 2). Hoje só tem o conector do **GA4**.

## Rodar

```bash
cd apps/worker
python3 -m pip install -e ".[dev]"
python3 -m pytest -q          # testes com respostas gravadas, sem rede
python3 -m ruff check .
python3 -m csp_worker ga4     # uma rodada do ga4_daily (precisa das variáveis abaixo)
```

| Variável | O que é | Onde fica |
|---|---|---|
| `WORKER_DATABASE_URL` | conexão do papel `mkt_worker` (Session pooler, porta 5432) | Railway |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | a chave JSON inteira da conta de serviço `csp-mkt-google-leitura` | Railway |

No Railway: serviço com raiz `apps/worker`, comando `python -m csp_worker ga4` e Cron Schedule `0 17 * * *`
(14:00 de São Paulo, em UTC).

## O que precisa existir antes da primeira rodada

1. O portão da fase 3 fechado e o job `producao` do CI ter dado a senha ao `mkt_worker` (`ESTADO.md`).
2. A conta de serviço como **Leitor** em cada propriedade do GA4.
3. As propriedades cadastradas: `node scripts/cadastrar-ga4.mjs --executar cs=<ID>@<host> | psql "$MKT_SETUP_DATABASE_URL"`.

Sem propriedade cadastrada a rodada não abre e o cartão continua "A ligar". Propriedade sem permissão deixa a rodada
`partial` com `PERMISSION`, e as outras seguem.

## Testes

`tests/gravadas/` tem respostas inventadas no formato da `runReport`. O adaptador transforma essas respostas em
`supabase/tests/fixtures/ga4-eventos.json`, e `supabase/tests/conector-ga4.test.ts` grava esse mesmo arquivo no banco
do PGlite: se um lado mudar o formato, um dos dois testes quebra.
