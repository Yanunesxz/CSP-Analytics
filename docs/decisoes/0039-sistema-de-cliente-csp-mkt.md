# 0039 — Sistema de cliente: "CSP MKT" no menu e o crédito no rodapé

- **Data:** 2026-11-04
- **Status:** aceita (decisão do dono; revê a resposta à pergunta 1 da fase 1 e o nome do repositório da 0001)

## Contexto

Na fase 1 (pergunta 1 de `docs/PROMPT-CSP-MKT.md`), o CSP-MKT foi classificado como produto Yan Nunes: menu com a assinatura "YAN NUNES · MKT", preto no claro e branco no escuro, sem `tema-cliente.css` e sem o crédito no rodapé. Com o protótipo publicado na Vercel, em 2026-11-04, o dono pediu o nome do grupo no menu. Pelo padrão, o menu de produto Yan Nunes leva a assinatura "Yan Nunes" mais o nome do produto, e o de sistema de cliente leva o nome do cliente (seção 5). Sistema de cliente leva também a linha "Criado por Yan Nunes" no fim de toda página (`docs/01-marca.md` do SystemDesing) e usa a cor principal do cliente no botão principal, no item ativo do menu e na seleção (seção 3).

## Decisão

O CSP-MKT passa a ser **sistema de cliente** do grupo Corpo Sensual e Plumene:

- No menu, `.yn-sidebar__brand` mostra "CSP", com `.yn-sidebar__product` = "MKT": "CSP MKT", como o "CSP 360" do CRM.
- A cor principal é preto no tema claro e branco no escuro, os valores do tema padrão: sem `tema-cliente.css` e sem `--color-brand` próprio.
- Toda tela leva o crédito "Criado por Yan Nunes" (`.yn-credit`) no fim da coluna principal, neutro, com o link para `https://github.com/Yanunesxz`, como no modelo da seção 5 do padrão, enquanto o site da Yan Nunes não tem endereço (o `docs/01-marca.md` do SystemDesing deixa a URL do site a definir).
- O título da aba continua "Tela · CSP-MKT".
- O repositório continua `CSP-MKT`, com a exceção da 0001. Pela regra de nome do padrão para sistema de cliente (`docs/05-stack-e-projeto.md`), o alvo de uma troca passa a ser `cliente-csp-mkt`, não mais `yn-csp-mkt`.

## Alternativas consideradas

- **Manter "YAN NUNES · MKT" (produto Yan Nunes):** a resposta da fase 1; o dono pediu a troca ao ver o site publicado.
- **Só "CSP" no menu:** sem o "MKT", o menu não distingue esta central do CSP 360. O dono escolheu "CSP MKT".
- **"YAN NUNES · CSP":** continuaria produto Yan Nunes, mas com o nome do cliente no lugar do nome do produto, fora da regra "Yan Nunes" mais uma palavra do produto. O dono escolheu "CSP MKT".
- **Azul do CSP 360 (`#2563EB`) como cor principal:** igualaria os dois sistemas do grupo; o dono preferiu manter preto e branco.

## Consequências

- O crédito vale para toda tela, inclusive o Diagnóstico e o modo demonstração. O `docs/01-marca.md` do SystemDesing pede que o crédito conste no contrato; quem quiser tirá-lo paga a versão sem marca.
- O item "Sistema de cliente" do checklist da seção 12 do padrão passa a valer: cor do cliente só nos lugares permitidos (aqui, preto e branco) e o rodapé "Criado por Yan Nunes".
- `CLAUDE.md`, `AGENTS.md`, `README.md` e `ESTADO.md` dizem "sistema de cliente"; o `docs/PROMPT-CSP-MKT.md` guarda a resposta da fase 1 como histórico.
- A casca tem teste (`apps/web/src/components/layout/Shell.test.ts`) para o nome no menu e o crédito.
