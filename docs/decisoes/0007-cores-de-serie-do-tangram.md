# 0007 — Cores de série tiradas dos tokens de dataviz do Tangram (desvio da seção 3)

- **Data:** 2026-10-30
- **Status:** aceita

## Contexto

A seção 3 do padrão permite só preto, branco, cinza, os tons de status e `--color-brand`; a ponte Tailwind apaga qualquer outra cor; nos gráficos do padrão só existem `--color-text`, três tons de status e `muted`. O CSP-MKT precisa distinguir cinco canais, duas marcas e dois operadores (Humano × Claude) em gráficos, chips e legendas. O dono pediu as cores "dos sistemas da RD Station", que é o design system Tangram, com tokens de dataviz próprios.

## Decisão

Escala categórica de 4 a 6 tokens `--color-series-1..6`, só do CSP-MKT, tirada dos tokens de dataviz do Tangram (support mint `#00F2C9`, magenta `#ED0093`, laranja `#FF8900`; primary `#0077B2`/`#00DBFF`; highlight `#8800F7`), congelada em arquivo no repositório (o Tangram só documenta o modo claro e os valores vivem no bundle do site: nunca buscar em runtime). Definida em `:root` e nos dois blocos do tema escuro, com versão escura derivada e contraste de 3:1 entre as séries e com o fundo, conferido pela regra 10 do Diagnóstico. Uso só para canal, marca e operador em gráfico, chip e legenda — nunca em botão, status ou texto corrido; cada série também tem rótulo, porque ninguém depende só da cor. Cores de status nunca identificam série.

## Alternativas consideradas

- **Nenhuma cor nova (séries em cinzas + traço + rótulo):** zero desvio, mas gráfico com cinco canais fica ilegível. Rejeitada pelo dono.
- **Cores observadas no site rdstation.com:** sem papel semântico nem estados; rejeitada.
- **Trocar a paleta inteira:** sair do padrão; rejeitada.

## Consequências

- Esta é uma cor fora da seção 3: consta em "Regras vigentes" do `CLAUDE.md` e com ressalva no README ao lado de "Padrão: SystemDesing v0.4.0".
- Os tokens vivem em `apps/web/src/styles/series.css`, carregado depois de `tokens.css` e `componentes.css`.
- Se o SystemDesing um dia ganhar escala de dataviz própria, esta decisão é substituída.
