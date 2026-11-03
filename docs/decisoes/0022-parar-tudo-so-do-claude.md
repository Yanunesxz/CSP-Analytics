# 0022 — "Parar tudo" só para as campanhas do Claude

- **Data:** 2026-11-03
- **Status:** aceita em 2026-11-03 (decisão de produto; o dono aprovou a recomendação)

## Contexto

A v1 tem um botão de parar tudo (decisão 0005). O protótipo pausa as campanhas ativas do Claude da marca escolhida,
em todos os canais, e deixa as do humano rodando; o `ESTADO.md` pergunta se também deve parar as do humano e se dá
para parar um canal só.

## Decisão

O botão para **só as campanhas ativas do Claude**, da marca escolhida (ou das duas), **em todos os canais**. As do
humano continuam. Não há parada por canal na v1.

Motivo: o botão é a trava da automação; as campanhas do humano são responsabilidade do gestor e podem ser pausadas
direto na plataforma. Parar todo o gasto da marca tem efeito de negócio muito maior, e uma escolha a mais num botão de
emergência atrasa quem precisa dele.

## Alternativas consideradas

- **Parar todas as campanhas da marca:** um freio de mão para todo o gasto. Cabe no modelo com pouca mudança, se o
  dono preferir: a lista do alcance da parada ganha "Todas as campanhas" e o botão passa a pegar também as campanhas
  do humano.
- **Escolher o canal na hora:** mais controle, mais um passo na emergência; pode entrar depois como ação própria.

## Consequências

- A parada fica registrada (quem, quando, quais campanhas) e cada campanha vira uma execução na plataforma.
- Sem credencial de escrita, a parada fica registrada e a tela lista o que pausar à mão em cada gerenciador.
- "Desfazer a parada" reativa só as campanhas daquela parada que continuam pausadas e que não estão em outra parada
  aberta; a reativação passa pelo limite do mês, como todo aumento de gasto.
- O botão nunca é recusado por já haver uma parada: a segunda pega só as campanhas que a primeira não pegou. Com
  parada aberta, nada que aumente o gasto sai da fila.
- Se a pausa do Parar tudo ficar em `queued` por mais de 2 min, a tela mostra a lista para pausar à mão e sai o aviso
  urgente.
