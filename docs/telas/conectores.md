# Conectores — `/conectores`

> Grupo **Sistema** do menu, ícone `plug`. Veem: `owner` e `traffic_manager` (`ver_conectores`). "Tentar de novo"
> só aparece para quem tem `tentar_conector_de_novo` (na v1, o dono).
> Tela: `apps/web/src/modules/conectores/` · consulta: `apps/web/src/data/queries/conectores.ts`
> (`painelDeConectores`, parte de `conectores()` de `queries.ts`, com teste em `conectores.test.ts`).
> Tarefa principal T6 (ver `README.md`): menu → **Conectores** → **Tentar de novo** no cartão atrasado (2 toques).

## O que a pessoa faz nesta tela

- Vê numa olhada se alguma integração parou ou atrasou e quais números isso deixa velhos.
- Tenta de novo a integração caída ou atrasada.
- Vê o que falta para ligar o GA4 (hoje simulado: os sites não medem nada sem `NEXT_PUBLIC_GA_ID`).
- Entende atraso de pedido: no cartão do CSP 360, a última rodada apps → CSP 360 e o aviso fixo de que não existe
  conexão direta com os apps de Representantes nem com o ERP Control.

## Ação principal

**Tentar de novo** no primeiro cartão caído ou atrasado. É o único `.yn-btn--primary` da tela e fica no primeiro
cartão da lista, logo abaixo do aviso do topo. Com mais de um conector com problema, os outros cartões têm o mesmo
"Tentar de novo" como botão secundário (o mais grave primeiro: caído antes de atrasado). Sem problema nenhum não há
botão: não há nada a fazer. A barra do topo não tem ação nesta tela.

## Como a tela está montada (de cima para baixo)

1. **Aviso da situação geral** (`.yn-alert`), sempre que existe conector: vermelho quando algum caiu, amarelo quando
   algum atrasou, verde quando tudo está em dia. Diz o que parou, o que isso afeta e o que fazer (ver "Textos").
2. **Aviso da visão Gestor de tráfego** (azul), só nessa visão.
3. **Nota da marca** (texto cinza), só com Corpo Sensual ou Plumene escolhida no menu.
4. **Cartões**, um por integração, em grade sem corte fixo (`repeat(auto-fit, minmax(min(100%, 300px), 1fr))`).
   Ordem: caídos, atrasados, funcionando, simulados (a ligar) e, por último, sem dados; no empate, a ordem do menu
   (CSP 360, Meta Ads, TikTok Ads, Google Ads, Instagram, Search Console, GA4). Cada cartão tem:
   - o nome (h2), "atualizado há X min" e a etiqueta do estado (`.yn-badge`: Funcionando verde, Atrasado amarelo,
     Caído vermelho, "Simulado · a ligar" e "Sem dados" neutros);
   - uma frase com o que a integração traz e de quanto em quanto tempo sincroniza;
   - a ficha (`.yn-dl--rows`): Última sincronização, Atraso, Erros em 24 h, Linhas gravadas em 24 h;
   - no simulado, no lugar da ficha, **O que falta para ligar** (passos numerados) e o link
     "Ver pendências em Tráfego com IA", onde a pendência "GA4 sem ID no site" vive;
   - no CSP 360, o bloco **Caminho dos pedidos**: `ERP Control → apps de Representantes → CSP 360 → CSP-MKT`,
     a última rodada apps → CSP 360 e o texto fixo de que não existe conexão direta com os apps nem com o Control;
   - em caído ou atrasado, o botão **Tentar de novo** (ou "Avise o dono para tentar de novo." sem a permissão).

Sem barra de filtros: conector não tem marca (decisão 0003) nem período, e canal, campanha, operador, origem e
representante não se aplicam.

## O que cada número quer dizer

| Número | Conta (na consulta, nunca na tela) |
|---|---|
| Estado | O que o conector diz (`ok`, `late`, `down`, `simulated`), com uma correção: "Funcionando" que passou da frequência esperada vira **Atrasado**. Integração que não veio no conjunto = "Sem dados". |
| Última sincronização | `lastSyncAt`, como "hoje, 14:18", "ontem, 22:10" ou data e hora (fuso de São Paulo). Sem sincronização: "Nunca sincronizou". |
| atualizado há X | O mesmo instante, relativo: "atualizado há 12 min", "há 3 h", "sem atualização". |
| Atraso | Minutos desde a última sincronização − frequência esperada (`expectedEveryMinutes`). 0 = "Em dia"; acima de 0, em horas e minutos ("2 h 10 min"), em amarelo (atrasado) ou vermelho (caído). |
| Erros em 24 h | `errors24h` do conector. |
| Linhas gravadas em 24 h | `rowsWritten` do conector (a janela de 24 h fecha na fase 3; ver "Para decidir"). |
| Última rodada apps → CSP 360 | Última linha de `sincronizacoes` do CRM, replicada pelo worker. Atrasada quando passa de 10 min (o pg_cron do CRM roda a cada 10 min). Na demonstração é "Sem dados": o store ainda não tem esse campo. |
| "atualizado há X min" da barra do topo | A sincronização mais recente entre todos os conectores. |

## Estados

| Estado | Como forçar | O que aparece |
|---|---|---|
| Carregando | `?estado=carregando` | Seis cartões de esqueleto (`aria-busy`). |
| Vazia | `?estado=vazio` ou sem dados de exemplo | Ícone de tomada, "Nenhum conector ainda", "Os cartões aparecem quando a primeira integração sincronizar. No modo demonstração, abra com VITE_SAMPLE_DATA=true." Sem botão (o "Ver conectores" das outras telas apontaria para esta). |
| Erro | `?estado=erro` | "Não deu para carregar os conectores", "Tente de novo em alguns segundos.", botão "Tentar de novo" (tira o `?estado=`) e "Código DEMO-500". |
| Sem dados | `?estado=sem-dados` | Os sete cartões na ordem do menu, com a etiqueta "Sem dados", "sem atualização" e cada linha da ficha em "Sem dados" (nunca 0). Sem aviso geral e sem botão. |
| Sucesso | sem parâmetro, com dados de exemplo | Aviso amarelo "TikTok Ads está atrasado"; o cartão do TikTok Ads primeiro, com "Atrasado", "atualizado há 3 h", atraso "2 h 10 min", 3 erros e o botão principal; os cinco "Funcionando"; o GA4 por último com "Simulado · a ligar" e o que falta. |
| Tentando de novo | tocar em "Tentar de novo" | O botão trava (`aria-busy`, desabilitado, "Tentando de novo") por 0,8 s: na demonstração a sincronização é simulada no store (`tentarConectorDeNovo`); clique duplo não repete. |
| Depois de dar certo | — | Aviso rápido "TikTok Ads sincronizado."; o cartão vira "Funcionando · atualizado agora" e vai para o lugar dele; o aviso do topo fica verde, "Tudo funcionando de novo desde HH:MM — Os conectores ligados estão em dia. GA4 ainda está a ligar."; o foco vai para esse aviso (com outro problema, ele diz o próximo e o próximo "Tentar de novo" vira o principal). |
| Conector caído | um conector com `status = 'down'` (a demonstração ainda não tem; ver pendências) | Aviso vermelho "Google Ads parou de sincronizar — Os números de Google Ads ficam parados na última sincronização. … Tente de novo no cartão."; etiqueta "Caído"; atraso em vermelho; o caído vem antes do atrasado e leva o botão principal. |

## Textos

| Onde | Texto |
|---|---|
| Aviso caído (vermelho) | **{Nome} parou de sincronizar** (ou **N conectores pararam de sincronizar**) — "Os números de {A e B} ficam parados na última sincronização. {C} está atrasado. Tente de novo no cartão." / "…em cada cartão." |
| Aviso atrasado (amarelo) | **{Nome} está atrasado** (ou **N conectores estão atrasados**) — "Os números de {Nome} podem estar desatualizados. Tente de novo no cartão." |
| Aviso em dia (verde) | **Tudo funcionando** ou, depois de um "Tentar de novo" que resolveu tudo, **Tudo funcionando de novo desde HH:MM** — "Os conectores ligados estão em dia. GA4 ainda está a ligar." |
| Aviso só simulados (azul) | **Nenhum conector ligado ainda** — "{A e B} ainda estão a ligar." |
| Sem a permissão de tentar | No aviso e no cartão: "Avise o dono para tentar de novo." |
| Aviso na visão Gestor (azul) | **Conectores não têm operador nem verba** — "Humano × Claude e o limite de gasto ficam nos canais e em Tráfego com IA." + "Ver Tráfego com IA" |
| Nota com marca escolhida | "Cada conector traz as duas marcas: a marca escolhida no menu não muda esta tela." |
| Frase de cada cartão | CSP 360 "Leads, clientes e pedidos das duas marcas, sem nome nem contato." · Meta Ads "Investimento, impressões, cliques e leads das campanhas da Meta." · TikTok Ads "…do TikTok." · Google Ads "Investimento, impressões, cliques e conversões das campanhas do Google." · Instagram "Seguidores, alcance e posts dos dois perfis." · Search Console "Impressões, cliques e posição dos sites na busca do Google." · GA4 "Visitas aos sites e as que chegam de assistentes de IA." + "Sincroniza a cada 5 min." / "de hora em hora." / "uma vez por dia." |
| Ficha | "Última sincronização" · "Atraso" ("Em dia", "2 h 10 min", "—") · "Erros em 24 h" · "Linhas gravadas em 24 h" · "Nunca sincronizou" · "Sem dados" |
| GA4, o que falta | **O que falta para ligar** — 1. "Preencher `NEXT_PUBLIC_GA_ID` na Vercel dos dois sites. Hoje está vazio e os sites não medem visitas." 2. "Criar o grupo de canais “AI Assistant” em cada propriedade do GA4." 3. "Dar ao CSP-MKT acesso de leitura às duas propriedades do GA4." + "Ver pendências em Tráfego com IA" |
| CSP 360, caminho dos pedidos | **Caminho dos pedidos** — "ERP Control → apps de Representantes → CSP 360 → CSP-MKT" · "Última rodada apps → CSP 360" · "Aparece quando o CSP 360 mandar o diário da sincronização com os apps." / "Pedidos novos podem demorar a aparecer aqui." (atrasada) / "O CSP 360 busca os pedidos nos apps a cada 10 min." · "Não existe conexão direta com os apps de Representantes nem com o ERP Control: pedidos e clientes chegam só pelo CSP 360." |
| Botão | "Tentar de novo" (nome acessível "Tentar de novo {Nome}") · "Tentando de novo" |
| Aviso rápido | "{Nome} sincronizado." |
| Vazia / erro | Ver "Estados". |

## Visão, marca e papel

- **Visão**: não muda os cartões. Conectores é tela de sistema, não de tráfego: "Tentar de novo" é recuperação de
  falha (como o "Tentar de novo" de erro de carregamento) e aparece nas duas visões para quem tem a permissão. Em
  **Gestor de tráfego** aparece só o aviso de onde ficam operador e verba, como nas outras telas sem operador.
- **Marca**: conectores não têm marca (decisão 0003); com uma marca escolhida, a nota explica que a tela não muda.
- **Papel**: `owner` vê e tenta de novo; `traffic_manager` vê, e no lugar do botão lê "Avise o dono para tentar de
  novo." O item do menu pede `ver_conectores`, que os dois papéis têm.

## Responsivo e temas

- **375px**: um cartão por linha; o aviso do topo e o cartão atrasado com o botão principal cabem na primeira tela
  (375×812). Sem rolagem lateral (`scrollWidth` = 375).
- **768px**: dois cartões por linha. **1280px**: três. **1920px**: cinco, usando a largura toda.
- O botão fica logo abaixo da ficha do cartão (não no pé do cartão esticado), junto do que ele resolve.
- Conferida em 30/10/2026 numa build de demonstração (`vite build --mode exemplo`) em 375, 768, 1280 e 1920px,
  claro e escuro, nos cinco `?estado=`, na visão Gestor de tráfego e com marca escolhida; "Tentar de novo" clicado
  (botão travado, aviso rápido, aviso verde e foco nele).

## As 8 perguntas de UX (seção 7 do padrão)

1. **Qual é a uma ação principal, e ela é o botão mais forte, no alcance do dedo?** "Tentar de novo" no conector
   caído ou atrasado mais grave: único botão principal, no primeiro cartão, visível na primeira tela do celular.
   Sem problema, não há botão principal porque não há o que fazer.
2. **Funciona como os sites que a pessoa já usa?** Como uma página de status: um serviço por cartão, estado com cor
   e texto, "atualizado há", e o "Tentar de novo" ao lado do problema. A ficha é rótulo à esquerda e valor à
   direita, como nas outras telas do sistema.
3. **Dá para entender os grupos sem ler tudo?** O aviso do topo resume; cada cartão é uma integração, com nome e
   estado na mesma linha; o bloco "Caminho dos pedidos" do CSP 360 é separado por uma linha; 24px entre blocos.
4. **Tem algo que dá para tirar?** Tirado: barra de filtros (conector não tem marca nem período), indicadores de
   contagem por estado (o aviso e a ordem dos cartões já dizem quem está com problema), "Sincronizar agora" em
   conector que funciona e a ficha no simulado (só o que falta para ligar).
5. **O sistema fez o trabalho chato e aceitou o que a pessoa digitou?** Calcula o atraso contra a frequência de
   cada integração, corrige "Funcionando" vencido para "Atrasado", ordena pela gravidade, diz quais números ficam
   velhos e lista os passos do GA4. Não há o que digitar.
6. **Como fica quando demora, quando dá errado e quando dá certo?** Esqueleto; erro com "Tentar de novo" e código;
   botão travado com "Tentando de novo" (sem clique duplo); sucesso com aviso rápido, cartão "Funcionando ·
   atualizado agora" e o aviso verde "Tudo funcionando de novo desde HH:MM", com o foco nele; "Sem dados" quando
   falta base.
7. **A pessoa sabe o que falta e até quando?** "atualizado há X min" em cada cartão e na barra; o atraso em tempo
   ("2 h 10 min") contra a frequência ("Sincroniza de hora em hora"); o GA4 com os passos numerados do que falta.
8. **O mais importante está no começo do menu e no topo da lista?** O aviso geral é o primeiro bloco; caídos e
   atrasados são os primeiros cartões; Conectores fica no grupo Sistema do menu, onde o padrão põe as telas de
   sistema.

## Para decidir na fase 3

- **"Tentar de novo" de verdade**: Edge Function que confere o papel e pede uma rodada ao worker; o botão fica em
  "Tentando de novo" até o `lastSyncAt` mudar (Realtime ou nova leitura); se falhar, aviso vermelho com o motivo e o
  código, e o cartão continua Caído. Hoje a demonstração sempre dá certo.
- **Janela das contagens**: "Erros em 24 h" e "Linhas gravadas em 24 h" viram contas sobre `sync_runs`. Na
  demonstração, "Tentar de novo" zera os erros (`actions.ts`); erro das últimas 24 h não some com um sucesso, então
  decidir entre "nas últimas 24 h" e "desde o último sucesso".
- **Tolerância do atraso**: hoje 1 minuto além da frequência já é atraso; avaliar uma folga (por exemplo 10% da
  frequência) para não piscar amarelo a cada rodada lenta.
- **Rodada apps → CSP 360**: campo no conector do CSP 360 (`upstreamLastRunAt`, que a consulta já lê se existir) ou
  tabela própria replicada de `sincronizacoes`.
- **Um conector por marca**: se Corpo Sensual e Plumene tiverem contas separadas (Parte 4, até 2 × 6), decidir entre
  um cartão por conta e as contas dentro do cartão da plataforma.
- **Diário por conector**: últimas rodadas e erros com código, num painel lateral (`.yn-drawer`) "Ver diário".
