# Sistema — `/usuarios` e `/configuracoes`

> Grupo **Sistema** do menu · pastas `apps/web/src/modules/usuarios` e `apps/web/src/modules/configuracoes` ·
> lista de usuários e quadro de permissões em `apps/web/src/data/queries/sistema.ts` (teste em `sistema.test.ts`).
> Quem vê: **Usuários** só quem pode `gerir_usuarios` (hoje, o dono; rota protegida); **Configurações**, todos os
> papéis (`editar_configuracoes`). O Diagnóstico (`/diagnostico`) é do mesmo grupo e já estava pronto.
>
> A marca e a Visão não mudam estas telas: perfil não tem marca (decisão 0003) e a Visão não é permissão (decisão
> 0011). Não há barra de filtros: nenhuma das duas mostra número de marketing.

## Usuários — `/usuarios`

### O que a pessoa faz nesta tela

- Vê quem tem acesso: pessoa, e-mail e papel, com **Você** na própria linha.
- Vê o que cada papel pode e não pode fazer (**Dono**, **Gestor de tráfego**). As duas listas saem de `permissoes()`
  de `packages/shared`, a mesma regra que esconde o item do menu, protege a rota e, na fase 3, a RLS: a tela nunca
  guarda uma segunda lista.
- Convida uma pessoa por e-mail, escolhendo o papel.
- Entende que, na primeira versão, só o dono entra e que o papel Gestor de tráfego já está pronto (decisão 0011).

### A ação principal (uma só)

**Convidar** (`.yn-btn--primary` com o ícone `user-plus`, na barra do topo). Abre a janela **Convidar pessoa**
(`.yn-modal`): E-mail, Papel (**Gestor de tráfego**, já marcado, ou **Dono**, cada um com a frase do que faz),
**Cancelar** e **Enviar convite**.

- Postel: aceita maiúsculas e espaços em volta e grava o e-mail em minúsculas.
- O erro aparece no próprio campo, sem apagar o que foi digitado.
- Esc, **×** e **Cancelar** fecham; com algo digitado, a janela pergunta antes ("Descartar o convite para …?" com
  **Continuar editando**, que recebe o foco, e **Descartar**). Clicar fora não fecha: a janela tem ação.
- Enquanto envia, o botão vira **Enviando**, travado (`aria-busy`), e o resto da janela não responde (contra clique
  duplo).
- Na demonstração o envio é simulado e a janela diz isso. No modo Supabase, enquanto a função de convite não
  existe (fase 3/4), o envio volta com erro e código, e a janela continua aberta com o que foi digitado.

### Como a tela é montada (de cima para baixo)

| Bloco | O que mostra |
|---|---|
| Aviso (`.yn-alert`, tom info) | "Na primeira versão, só o dono entra" e a frase sobre o papel Gestor de tráfego |
| Quem tem acesso | Tabela **Pessoa** (avatar com as iniciais, nome, **Você**) · **E-mail** · **Papel**; dono primeiro, depois por nome. Sem ação na linha na v1 |
| Papéis | Um cartão por papel, lado a lado: nome, quantas pessoas ("1 pessoa", "Ninguém ainda"), a frase do papel, **Pode** (✓) e **Não pode** (–) |

### Regras (nenhuma conta na tela)

- Lista e contagens vêm de `usuarios(dados)`: dono primeiro; contagem por papel `null` quando o cadastro de acessos
  está vazio ("Sem dados") e 0 ou mais quando há cadastro ("Ninguém ainda").
- O quadro vem de `quadroDePermissoes()`: **Pode** é exatamente `permissoes(papel)`, e **Pode** + **Não pode** cobre
  todas as ações (o teste garante as duas coisas). "Ver nome, telefone e e-mail de lead" fica em **Não pode** nos
  dois papéis, com "Ninguém vê aqui: a ficha do lead fica no CSP 360." (decisão 0006).
- Ninguém muda o próprio papel (seção 10 do padrão). Trocar papel e tirar acesso entram quando houver um segundo
  usuário (fase 3/4); hoje a lista não tem ação.
- O convite confere o e-mail na tela (`validarConvite`, com teste) e, na fase 3/4, de novo no servidor, que confere a
  sessão e o papel do dono no banco antes de enviar.

### Estados

| Estado | Como ver | O que aparece |
|---|---|---|
| Carregando | `?estado=carregando` | Esqueleto na lista (`aria-busy`). O aviso e os papéis ficam no lugar, sem a contagem de pessoas |
| Vazia | `?estado=vazio`, ou a demonstração sem `VITE_SAMPLE_DATA` | "**Nenhum usuário cadastrado**" · "Convide quem vai usar o sistema em Convidar, no topo da tela." |
| Erro | `?estado=erro` | "**Não deu para carregar os usuários**" · "Tente de novo em alguns segundos." · **Tentar de novo** (tira o `?estado=`) · "Código DEMO-500" |
| Sem dados | `?estado=sem-dados` | Lista "**Sem dados**" · "A lista aparece quando o cadastro de acessos estiver disponível."; a contagem de cada papel em "Sem dados", nunca 0 |
| Sucesso | sem parâmetro, com os dados de exemplo | O dono de demonstração com **Você**; Dono "1 pessoa", Gestor de tráfego "Ninguém ainda" |

**Depois de dar certo (convite):** a janela fecha, o foco volta para **Convidar** e aparece o aviso rápido
"Convite enviado para gestor@empresa.com.br." (com o e-mail já em minúsculas). Na demonstração a pessoa não entra na
lista, e a janela avisou isso antes do envio.

## Configurações — `/configuracoes`

### O que a pessoa faz nesta tela

- Escolhe o tema: **Aparelho · Claro · Escuro**.
- Escolhe a marca padrão: **Corpo Sensual · Plumene · As duas**.
- Escolhe, aviso por aviso, se recebe por **E-mail** e por **WhatsApp**.
- Vê com que nome, e-mail e papel entrou.
- Vê a versão aberta e se já há uma mais nova.

### A ação principal (uma só)

Nenhum botão principal, de propósito: cada escolha vale na hora, sem **Salvar** (lei 12, navalha de Occam: um passo a
mais que não muda nada). O padrão pede no máximo um por tela. Botões secundários: **Ver usuários e papéis** (só para
quem gere usuários) e **Atualizar** (só quando há versão nova).

### Como a tela é montada

Tela de formulário: `.yn-content--narrow` (960px) e seções `.yn-form-section`, com título e frase à esquerda e os
controles à direita; vira uma coluna abaixo de 720px de área. Cada seção tem âncora: `#tema`, `#marca`, `#avisos`,
`#conta`, `#versao`.

| Seção | O que tem | Onde a escolha fica |
|---|---|---|
| Tema | `.yn-segmented` Aparelho · Claro · Escuro | `lib/tema.ts`: localStorage "tema" e `data-theme`; nunca na URL |
| Marca padrão | `.yn-segmented` Corpo Sensual · Plumene · As duas | A mesma memória do seletor do menu (localStorage "marca"). Escolher aqui também troca a marca agora: o menu e a URL acompanham |
| Avisos | Destinos (E-mail do perfil; WhatsApp "A cadastrar"), a regra da tela e um grupo por aviso: título, quando sai e duas chaves (`.yn-switch`) | Demonstração: localStorage "avisos". Fase 3: o perfil, que o n8n lê para mandar (decisão 0001) |
| Sua conta | Nome, E-mail, Papel e a frase do papel; **Ver usuários e papéis** para quem gere usuários | A sessão (`useSessao`) |
| Versão do sistema | Versão, Publicada em, Modo; "Você está na versão mais recente…" ou "Versão nova disponível" + **Atualizar** | `VERSAO_ATUAL` da build e `useVersaoNova()`, que lê `/version.json` |

Os avisos (só aparecem os que o papel pode ver; o gestor de tráfego não recebe "Proposta do Claude para aprovar"):

| Aviso | Quando sai | E-mail | WhatsApp |
|---|---|---|---|
| Conector parado | Uma integração cai ou atrasa além do esperado. Urgente: a qualquer hora | ligado | ligado |
| Gasto perto do teto | O gasto de uma conta de anúncio chega perto do teto definido. Urgente | ligado | ligado |
| Custo por lead acima do limite | O custo por lead de uma campanha passa do limite combinado. Urgente | ligado | ligado |
| Proposta do Claude para aprovar | Uma ação nova entra na fila de aprovação. Horário comercial; várias no mesmo dia viram um resumo | ligado | desligado |
| Relatório da semana | Uma vez por semana, com o link para a Visão geral. Horário comercial | ligado | desligado |

Os valores acima são o padrão: e-mail em tudo, WhatsApp só no urgente (seção 8 do padrão). Na tela, tudo aparece
sempre (contador no menu e faixa no topo); esta seção trata só do que sai do sistema.

### Estados

Configuração não depende dos dados de marketing: sem dados de exemplo, a tela abre igual. Só os **Avisos** simulam a
leitura do perfil, porque na fase 3 eles vêm do banco; tema e marca são do navegador e funcionam sempre.

| Estado | Como ver | O que aparece |
|---|---|---|
| Carregando | `?estado=carregando` | Avisos em esqueleto; o resto da tela funciona |
| Erro | `?estado=erro` | Avisos: "**Não deu para carregar seus avisos**" · "Tente de novo em alguns segundos. O tema e a marca continuam funcionando." · **Tentar de novo** · "Código DEMO-500" |
| Vazia e sem dados | `?estado=vazio`, `?estado=sem-dados` | A tela igual, com as escolhas guardadas ou as padrão: aqui não há número para faltar |
| Papel sem aviso | um papel que não pode ver nada do que os avisos apontam | "**Nenhum aviso para o seu papel**" · "Os avisos aparecem quando seu papel puder ver o que eles apontam." |
| Sucesso | sem parâmetro | As escolhas valem na hora e voltam iguais depois de recarregar |

**Depois de dar certo:** o tema troca na hora (e não pisca ao recarregar, pelo script do `index.html`); a marca troca
no menu e na URL; a chave muda de posição e a escolha volta igual depois de recarregar. Sem aviso rápido: o próprio
controle mostra o resultado, e o leitor de tela anuncia "ligado" ou "desligado".

## Textos de cada botão e aviso

| Onde | Texto |
|---|---|
| Barra do topo (Usuários) | "Sistema" (eyebrow) · **Usuários** (h1, desenhado pela casca) · "atualizado há X min" · botão principal **Convidar** |
| Aviso (Usuários) | "Na primeira versão, só o dono entra" · "O papel Gestor de tráfego já está pronto: quando o gestor chegar, é só usar Convidar." |
| Quem tem acesso | "Quem tem acesso" · "Cada pessoa entra com o próprio e-mail e um papel." · colunas "Pessoa", "E-mail", "Papel" · "Você" |
| Papéis | "Papéis" · "O papel decide o que cada pessoa pode ver e fazer. A Visão no topo (Visualizador ou Gestor de tráfego) só muda o que a tela mostra, não o que a pessoa pode." · "Pode" · "Não pode" · "1 pessoa" / "Ninguém ainda" / "Sem dados" |
| Frase de cada papel | Dono: "Vê e faz tudo: aprova as ações do Claude e cuida dos acessos." · Gestor de tráfego: "Vê os números e opera o Tráfego com IA." |
| Ações no quadro | "Ver os números de marketing" · "Ver a lista de leads, sem dado pessoal" · "Ver nome, telefone e e-mail de lead" ("Ninguém vê aqui: a ficha do lead fica no CSP 360.") · "Abrir o Tráfego com IA" · "Operar o Tráfego com IA" · "Aprovar ações do Claude" · "Parar todas as campanhas do Claude" · "Ver os conectores" · "Tentar um conector de novo" · "Convidar pessoas e definir papéis" · "Abrir o Diagnóstico" · "Mudar tema, marca padrão e avisos" |
| Janela de convite | **Convidar pessoa** · "A pessoa recebe um e-mail com o link para entrar e criar a senha." · "E-mail" (exemplo "nome@empresa.com.br") · "Papel" · "Na demonstração, o convite não sai do sistema e a pessoa não entra na lista." · **Cancelar** · **Enviar convite** / **Enviando** · botão **×** ("Fechar") |
| Erros do convite | "Informe o e-mail da pessoa." · "Informe um e-mail válido, como nome@empresa.com.br." · "Este e-mail já tem acesso ao sistema." · "Não deu para enviar o convite" + "O envio de convites por e-mail ainda não está ligado. O que você digitou continua aqui." + "Código USR-501" |
| Descartar | "Descartar o convite para …?" · **Continuar editando** · **Descartar** |
| Aviso rápido | "Convite enviado para gestor@empresa.com.br." |
| Barra do topo (Configurações) | "Sistema" · **Configurações** (h1) · sem botão principal |
| Tema | "Tema" · "Claro, escuro ou igual ao aparelho." · Aparelho · Claro · Escuro · "Aparelho segue o claro ou o escuro do computador ou do celular. A escolha fica guardada neste navegador." |
| Marca padrão | "Marca padrão" · "A marca que aparece quando você abre o sistema." · Corpo Sensual · Plumene · As duas · "Vale quando o link não diz a marca. Trocar a marca no menu também muda esta escolha." |
| Avisos | "Avisos" · "O que você recebe fora do sistema e por qual canal." · "E-mail" · "WhatsApp" · "A cadastrar" · "Na tela, tudo aparece sempre: contador no menu e faixa no topo." + "Na demonstração, nenhum aviso sai do sistema e a escolha fica neste navegador." (ou, fora da demonstração, "Os avisos por WhatsApp começam quando o número estiver no seu perfil.") · "Urgente: sai a qualquer hora." · "Sai em horário comercial." · "Sai em horário comercial; vários no mesmo dia viram um resumo." |
| Sua conta | "Sua conta" · "Com que nome, e-mail e papel você entra." · Nome · E-mail · Papel · "Na demonstração, você entra como o dono de exemplo, sem senha." · **Ver usuários e papéis** |
| Versão do sistema | "Versão do sistema" · "A versão aberta neste navegador." · Versão · Publicada em · Modo ("Demonstração · dados de exemplo", "Demonstração · sem dados de exemplo", "Dados reais") · "Você está na versão mais recente. O sistema confere sozinho de tempos em tempos e avisa no topo da tela." · "Versão nova disponível" + "Atualize para abrir a versão mais recente." + **Atualizar** |

## Responsivo (pelo espaço)

- **Usuários, 1280px:** aviso, tabela inteira em uma linha por pessoa e os dois cartões de papel lado a lado
  (`.mkt-grid-2`). **375px:** a tabela vira card (`.yn-table--stack`; o título é a pessoa, com avatar e **Você**;
  embaixo, E-mail e Papel); os cartões de papel ficam um embaixo do outro; **Convidar** desce para a linha de baixo
  da barra do topo, ainda no topo. A janela de convite ocupa a largura menos 16px de cada lado, com campo de letra
  16px (o iPhone não dá zoom) e 44px de toque.
- **Configurações, 1280px:** 960px de largura, título à esquerda e controles à direita. **375px:** uma coluna (a
  seção empilha abaixo de 720px de área); os três `.yn-segmented` cabem sem rolar; as chaves ficam lado a lado e
  quebram linha se apertar.
- Claro e escuro só por tokens. Nenhuma cor de série nestas telas.
- **Conferido no navegador** (demonstração com dados de exemplo, 30/10/2026): Usuários em 1280px claro e escuro e
  375px claro, nos cinco estados (`?estado=`), e o convite inteiro (e-mail inválido, e-mail que já tem acesso,
  pergunta ao descartar, envio com o botão travado, aviso rápido e foco de volta em **Convidar**); Configurações em
  1280px claro, e escuro e 375px por medida (contraste dos textos acima de 8:1 no escuro; sem rolagem lateral; menor
  alvo de toque 44px), com tema, marca padrão e chaves de aviso gravando e voltando iguais depois de recarregar.
  Sem erro no console.

## As 8 perguntas de UX (seção 7 do padrão)

### Usuários

1. **Qual é a uma ação principal, e ela é o botão mais forte, no alcance do dedo?** **Convidar**, o único botão
   principal, no topo; no celular desce para a linha de baixo do título, ainda à vista. Dentro da janela, **Enviar
   convite** é o botão forte, no rodapé, longe do **×**.
2. **Funciona como os sites que a pessoa já usa?** Lista de membros com papel e uma janela de convite por e-mail,
   como em qualquer ferramenta com equipe (Google Workspace, Supabase, GitHub). Esc fecha a janela; Enter envia.
3. **Dá para entender os grupos sem ler tudo?** Três blocos com título: o aviso da v1, **Quem tem acesso** e
   **Papéis**. Em cada papel, **Pode** e **Não pode** separados, com ✓ e –.
4. **Tem algo que dá para tirar?** Saíram: indicadores (com uma pessoa, um número no topo só empurra a lista para
   baixo; a contagem foi para o cartão do papel), ações na linha (só o dono existe e ninguém muda o próprio papel),
   filtros e a coluna de situação (não há convite pendente guardado na v1).
5. **O sistema fez o trabalho chato e aceitou o que a pessoa digitou?** O e-mail aceita maiúsculas e espaços e é
   gravado em minúsculas; o papel mais provável (Gestor de tráfego) já vem marcado; o sistema avisa antes de enviar
   se o e-mail já tem acesso.
6. **Como fica quando demora, quando dá errado e quando dá certo?** Demora: esqueleto na lista e **Enviando**
   travado. Erro: no próprio campo, ou na janela com código, sem perder o que foi digitado. Certo: a janela fecha, o
   aviso rápido diz para quem foi o convite e o foco volta ao botão.
7. **A pessoa sabe o que falta e até quando?** O aviso diz que, na v1, só o dono entra e que o papel do gestor está
   pronto; o cartão do gestor mostra "Ninguém ainda".
8. **O mais importante está no começo do menu e no topo da lista?** Usuários fica no grupo Sistema, depois de
   Conectores (o que mais se abre ali). Na tela, quem tem acesso vem antes do quadro de papéis, e o dono vem primeiro
   na lista.

### Configurações

1. **Qual é a uma ação principal, e ela é o botão mais forte, no alcance do dedo?** Não há: cada escolha vale na
   hora, e um **Salvar** seria um passo sem efeito. Os controles têm 44px no celular.
2. **Funciona como os sites que a pessoa já usa?** Configurações em seções com título à esquerda, como nos
   aplicativos de sistema e no GitHub; chaves liga/desliga para avisos; escolha de tema Aparelho · Claro · Escuro.
3. **Dá para entender os grupos sem ler tudo?** Cinco seções com título e uma frase cada; nos Avisos, um grupo por
   aviso com as duas chaves juntas.
4. **Tem algo que dá para tirar?** Saíram: botão **Salvar**, "Restaurar padrão" (as escolhas padrão já são as do
   padrão Yan Nunes) e a Visão padrão (o topo já guarda a última escolha).
5. **O sistema fez o trabalho chato e aceitou o que a pessoa digitou?** Os avisos já vêm ligados do jeito do padrão
   (e-mail em tudo, WhatsApp só no urgente); a marca padrão é a mesma memória do menu, sem configurar duas vezes.
6. **Como fica quando demora, quando dá errado e quando dá certo?** Avisos: esqueleto ao carregar e "Não deu para
   carregar seus avisos" com **Tentar de novo**, sem travar o tema e a marca. Certo: o controle muda na hora e volta
   igual ao recarregar.
7. **A pessoa sabe o que falta e até quando?** O WhatsApp mostra "A cadastrar"; cada aviso diz quando sai (a
   qualquer hora ou em horário comercial); a versão diz se há uma nova.
8. **O mais importante está no começo do menu e no topo da lista?** Configurações é o último item do grupo Sistema
   (o padrão põe o segundo mais importante por último). Na tela, o que mais se mexe vem antes (tema e marca), os
   avisos no meio e as informações (conta e versão) por último.

## Pendências

- **Fundação, `index.css`:** o reset do Tailwind (preflight) zera a `margin` do `<dialog>`, e o `.yn-modal` do
  padrão (e o `.yn-sheet` no computador) conta com a margem automática do navegador para ficar no meio: a janela
  abre no canto superior esquerdo. Corrigido só na janela de convite (`style={{ margin: 'auto' }}`). Correção
  geral sugerida: `@layer base { dialog { margin: auto; } }` no `index.css` (o `.yn-drawer` e a folha no celular
  seguem com margem 0, porque o CSS do padrão não tem camada e vence).
- **Fundação, `Sidebar.tsx`:** "Perfil", no menu do usuário, leva a `/usuarios`, que exige `gerir_usuarios`; o
  gestor de tráfego cairia em "Você não tem acesso a esta tela". Sugestão: apontar para `/configuracoes#conta`.
- **`packages/shared`:** os rótulos das ações (`ROTULO_DA_ACAO`) e a frase de cada papel (`RESUMO_DO_PAPEL`) estão
  em `data/queries/sistema.ts`; o lugar deles é `labels.ts`, como a lista `acao`.
- **`data/actions.ts`:** `enviarConvite` está em `modules/usuarios/convite.ts`; vai para `actions.ts` e, na fase
  3/4, chama a função de convite que confere sessão e papel no banco.
- **Regra a decidir:** a decisão 0005 fala em aprovação "do dono (ou do gestor, quando existir)", mas `rules.ts` não
  dá `aprovar_acao` ao `traffic_manager`. A tela mostra o que o código diz ("Não pode: Aprovar ações do Claude").
- **Fase 3:** número de WhatsApp no perfil só para avisos (dado pessoal com finalidade registrada); avisos e marca
  padrão guardados no perfil (hoje no navegador); os limites de "gasto perto do teto" e "custo por lead acima do
  limite"; trocar papel e tirar acesso.
