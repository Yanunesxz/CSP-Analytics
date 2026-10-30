# 0003 — Marca como dimensão do fato, sem `company_id`

- **Data:** 2026-10-30
- **Status:** aceita

## Contexto

O padrão (`docs/03`) manda `company_id` em toda tabela quando há mais de uma empresa no mesmo banco, e o seletor `.yn-context` troca de empresa. Corpo Sensual e Plumene têm CNPJs separados, mas no CRM do grupo a base de clientes é uma só (sem `marca_id`) e a marca é atributo de pedido, negócio e ticket. O dono quer ver as duas marcas e "As duas" precisa contar o lojista uma vez.

## Decisão

O CSP-MKT é um sistema de **uma** empresa (o grupo) com **duas** marcas. A regra "`company_id` em toda tabela" não se aplica. Toda tabela de fato (métricas, campanhas, leads agregados, pedidos, ações de tráfego, snapshots) tem `brand_id uuid not null` → `brands(id, code cs|plumene, name, external_id, source = 'csp360')`. Tabela de cliente ou dimensão compartilhada (clientes, representantes, conectores sem marca) não tem `brand_id`. Não existe `company_id` nem `marca_id`. O filtro "As duas" é ausência de filtro em `brand_id`. Dado que chega sem marca (lead do SDR, conversa de WhatsApp, negócio sem marca) aparece nas duas e é sinalizado como "Sem marca" nos totais.

## Alternativas consideradas

- **`company_id` por marca, como duas empresas:** rejeitada — um cliente que compra das duas marcas apareceria duas vezes e "novo" na Plumene mesmo já comprando Corpo Sensual.
- **Marca como instância separada (como os apps de Representantes):** rejeitada — telas duplicadas e "As duas" vira soma, não consolidação.

## Consequências

- O seletor `.yn-context` do menu lateral troca a marca (Corpo Sensual · Plumene · As duas), refletida na URL como `?marca=`.
- Toda view de KPI recebe `brand_id` opcional e, sem ele, deduplica por cliente.
- Se um dia uma terceira marca entrar, é uma linha nova em `brands`, sem migração estrutural.
