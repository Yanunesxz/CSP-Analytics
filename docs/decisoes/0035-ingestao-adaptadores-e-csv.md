# 0035 — Ingestão: um adaptador por provedor, evento único, releitura e CSV de reserva

- **Data:** 2026-11-03
- **Status:** proposta (técnica, aguarda a aprovação do modelo; detalha a 0001 e a 0016)

## Contexto

O padrão pede um adaptador por provedor, convertendo para um evento único do sistema; webhook que responde 200 e
processa depois; idempotência; retentativa com espera crescente. As plataformas mudam números por dias depois (a Meta
por até 28, o Google por 30 a 90, o GA4 por até 12), entregam dinheiro em unidades diferentes e o dia no fuso da conta.
E a aprovação de uma API pode atrasar.

## Decisão

- O worker tem **um adaptador por provedor**. Cada um devolve registros no formato único do sistema: tipo, fonte, chave
  natural com os ids externos, marca, valores já em centavos, dia e códigos em inglês, e quando foi lido. Um gravador só
  leva os registros às funções `ingest.*`, em lotes de até 1.000; linha recusada não derruba o lote.
- **Leitura de hora em hora** (hoje e ontem) e **releitura diária** da janela em que a plataforma ainda muda o número
  (`docs/dados/integracoes.md`); a releitura troca o dia inteiro da conta, do perfil ou da propriedade
  (`ingest.replace_day`): a linha que deixou de vir sai.
- Não há tabela `integration_log`: a rodada fica em `sync_runs` (90 dias), a escrita em `platform_executions` e cada
  chamada no log JSON do worker e do executor, com o `external_id` de conta, campanha ou propriedade (nunca de pessoa).
- **Nenhum webhook na v1:** o que chega por webhook (lead de formulário) é dado pessoal e é do CRM (decisão 0037); o
  resto, a leitura de hora em hora já traz.
- **CSV de reserva:** o dono envia o relatório de campanha pela central; o arquivo fica em `mkt.csv_imports` até ser
  lido; as linhas entram com `source = 'csv'`; a API regrava o CSV, nunca o contrário; arquivo com dado de pessoa é
  recusado.
- **Retentativa:** 1, 2, 4, 8 e 16 s; limite da plataforma respeita a espera dela; outro 4xx não repete. Moeda só
  real.

## Alternativas consideradas

- **SDK de cada plataforma gravando direto nas tabelas:** cada provedor com o seu jeito, e a conversão espalhada.
- **Webhooks das plataformas:** endpoint público, segredo e fila para dado que a leitura já traz.
- **CSV por script do desenvolvedor:** o dono dependeria de alguém para subir o arquivo.

## Consequências

- `tabelas.md` ganha `csv_imports`; `papeis-e-rls.md`, a função `api.upload_csv`; o botão "Enviar CSV" entra na tela
  de Conectores na fase 4 (não está no protótipo).
- O worker tem um teste por adaptador, com respostas gravadas e inventadas.
- Trocar a versão de uma API é trocar o adaptador, em PR com teste.
