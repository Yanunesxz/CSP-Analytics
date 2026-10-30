# 0007 — Cores de série tiradas dos tokens de dataviz do Tangram (desvio da seção 3)

- **Data:** 2026-10-30
- **Status:** aceita

## Contexto

A seção 3 do padrão permite só preto, branco, cinza, os tons de status e `--color-brand`; a ponte Tailwind apaga qualquer outra cor; nos gráficos do padrão só existem `--color-text`, três tons de status e `muted`. O CSP-MKT precisa distinguir cinco canais, duas marcas e dois operadores (Humano × Claude) em gráficos, chips e legendas. O dono pediu as cores "dos sistemas da RD Station", que é o design system Tangram, com tokens de dataviz próprios.

## Decisão

Escala categórica de 6 tokens `--color-series-1..6`, só do CSP-MKT, tirada das matizes dos tokens de dataviz do Tangram (support mint `#00F2C9`, magenta `#ED0093`, laranja `#FF8900`; primary `#0077B2`/`#00DBFF`; highlight `#8800F7`), congelada em `apps/web/src/styles/series.css` (o Tangram só documenta o modo claro e os valores vivem no bundle do site: nunca buscar em runtime). Definida em `:root` e nos dois blocos do tema escuro. Cada série passa de **3:1 contra o fundo onde o gráfico fica**, nos dois temas, conferido pela regra 10 do Diagnóstico: no claro, mint, laranja e ciano do Tangram ficavam abaixo disso no branco e entram escurecidos em OKLCH, mesma matiz (`#039C81`, `#D17005`, `#0697B0`); no escuro, todas entram clareadas. Entre si as séries se distinguem pela matiz, não por contraste, e cada série sempre tem rótulo, porque ninguém depende só da cor. Uso só para canal (e a origem do lead, inclusive o assistente de IA de onde veio a visita), marca e operador em gráfico, chip e legenda — nunca em botão, status ou texto corrido. Cores de status nunca identificam série.

Quem usa qual série (em `packages/shared/src/labels.ts`), escolhido para os pares que aparecem juntos ficarem distintos: Meta Ads azul, TikTok Ads magenta, Google Ads laranja; Humano azul, Claude laranja; Corpo Sensual magenta, Plumene roxo; Busca orgânica mint, Assistente de IA roxo, Site ciano (no claro, o ciano fica próximo do mint e do azul, então vai para a origem menos disputada). As origens sem série própria (SDR · WhatsApp, Indicação, Direto) ficam em neutros que passam de 3:1 no card. Na tela SEO e GEO, os assistentes (ChatGPT mint, Perplexity ciano, Claude laranja, Gemini azul, Copilot roxo) abrem a origem "Assistente de IA" e usam a mesma escala. Cada dimensão usa a escala sozinha: a mesma cor pode aparecer em dimensões diferentes na mesma tela (Corpo Sensual e TikTok Ads, por exemplo), nunca dentro do mesmo gráfico ou legenda, e o rótulo desfaz a dúvida.

*Atualizada em 2026-10-30: os valores do tema claro e a regra de contraste foram ajustados depois de medir os tokens do Tangram no fundo branco.*

## Alternativas consideradas

- **Nenhuma cor nova (séries em cinzas + traço + rótulo):** zero desvio, mas gráfico com cinco canais fica ilegível. Rejeitada pelo dono.
- **Cores observadas no site rdstation.com:** sem papel semântico nem estados; rejeitada.
- **Trocar a paleta inteira:** sair do padrão; rejeitada.

## Consequências

- Esta é uma cor fora da seção 3: consta em "Regras vigentes" do `CLAUDE.md` e com ressalva no README ao lado de "Padrão: SystemDesing v0.4.0".
- Os tokens vivem em `apps/web/src/styles/series.css`, carregado depois de `tokens.css` e `componentes.css`.
- Se o SystemDesing um dia ganhar escala de dataviz própria, esta decisão é substituída.
