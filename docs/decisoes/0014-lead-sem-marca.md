# 0014 — Lead sem marca: `brand_id` nulo só na réplica de leads

- **Data:** 2026-11-03
- **Status:** proposta (técnica, aguarda a aprovação do modelo; complementa a 0003)

## Contexto

A decisão 0003 manda `brand_id uuid not null` em toda tabela de fato e, na mesma decisão, diz que o dado que chega
sem marca (lead do SDR, negócio sem marca) aparece nas duas marcas e é sinalizado como "Sem marca". No CRM, a fila do
SDR não tem marca, a marca do negócio é opcional e o histórico de marketing não tem marca. O protótipo aprovado já
mostra "Sem marca · WhatsApp".

## Decisão

- `brand_id` aceita nulo em uma tabela de fato, e só nela: `crm_leads`. Nulo quer dizer "Sem marca". Com uma marca
  escolhida, esses leads entram e aparecem sinalizados; em "As duas", contam uma vez. O histórico de marketing do CRM,
  que também não tem marca, não é replicado na v1 (nenhuma conta usa); se entrar, segue a mesma regra.
- Tabelas de trilha e de operação (`claude_runs`, `traffic_stops`, `traffic_log`, `sync_runs`, `crm_upstream_runs`)
  aceitam `brand_id` nulo com o sentido "as duas marcas" ou "não é de marca". Elas não são somadas por marca.
- Todas as outras tabelas de fato continuam com `brand_id not null`, com chave estrangeira composta que garante a mesma
  marca da conta ou da campanha.

## Alternativas consideradas

- **Uma linha "Sem marca" em `brands`:** apareceria como terceira marca no menu e faria "As duas" deixar de ser
  ausência de filtro.
- **Descartar o lead sem marca:** os leads do SDR sumiriam das telas.
- **Copiar o lead para as duas marcas:** contaria duas vezes em "As duas".

## Consequências

- Toda conta de lead por marca usa "a marca escolhida ou sem marca" e separa o sem marca no total (regra em
  `docs/dados/metricas.md`).
- Quando o CRM der marca ao lead do SDR (Parte 4 do prompt), os nulos diminuem sem mudança de estrutura.
