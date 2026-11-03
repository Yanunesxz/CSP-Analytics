# 0021 — Limite de gasto por conta e por mês

- **Data:** 2026-11-03
- **Status:** proposta (decisão de produto, aguarda o dono)

## Contexto

No protótipo o limite é o teto de cada campanha (`spendCapCents`), sem dizer de que período. A Visão geral e a tela de
canal comparam o investimento do período escolhido das campanhas ativas com a soma dos tetos (em 90 dias passa de
100%). O Tráfego com IA trata o mesmo número como limite do mês e reparte o limite novo entre as campanhas. A decisão
0005 fala em limite por conta. Na Meta, o teto da campanha vale para a vida dela, não para o mês.

## Decisão

Recomendação, para o dono decidir:

Um limite por **conta de anúncio** (marca × plataforma), **por mês do calendário de São Paulo**, definido no CSP-MKT,
comparado com todo o gasto da conta no mês até hoje, de qualquer campanha. A régua é a mesma na Visão geral (Gestor),
nas telas de canal e no Tráfego com IA, e não muda com o período escolhido. "Perto do limite" a partir de 90%, "Acima
do limite" a partir de 100%. O limite também trava a execução de ação que passaria dele. O teto de campanha que
existir na plataforma vira só informação. Conta sem limite vigente não recebe nada que possa aumentar o gasto. O
acesso de escrita só mexe nas campanhas das contas cadastradas e, na Meta, no limite de gasto da conta, sem acesso a
pagamento nem a usuários.

Na Meta, antes de o Claude poder executar numa conta, o limite também fica gravado na própria conta de anúncio. Quando
ele acaba, a Meta para de gastar em **todas** as campanhas da conta, também nas do gestor humano. Esse teto da Meta não
se renova sozinho a cada mês, então a central o zera e regrava todo dia 1 com o limite do mês. É a única escrita que a central faz sem um clique
no dia, sempre com o limite que o dono aprovou, e por isso é uma **exceção ao "nada automático" da decisão 0005**,
aprovada junto com esta. Se o teto sumir ou ficar acima do limite, a central não executa nada que aumente o gasto na
conta. No TikTok e no Google a central não grava teto na conta: vale só a trava dela.

Motivo: o dono pensa em verba do mês por conta; um número por conta é fácil de manter e não muda quando uma campanha
pausa.

## Alternativas consideradas

- **Por campanha (como o protótipo):** um valor por campanha para manter, teto da Meta que é da vida da campanha, e a
  soma que muda quando uma campanha pausa.
- **Pelo período escolhido na tela:** deixa de ser limite; vira uma proporção que muda com o filtro.
- **Por conta, para a vida da conta:** não bate com a verba mensal.
- **Renovar o teto da Meta só com aprovação, todo dia 1:** nada automático, mas, sem o clique, o teto do mês anterior,
  já quase todo gasto, para a conta inteira logo no começo do mês.
- **Sem teto gravado na Meta:** só a trava da central; um erro na execução poderia gastar sem limite na conta.

## Consequências

- "Verba do mês" (na estratégia, por marca) e "limite" (por conta) continuam separados: a verba é o plano; o limite é o
  teto que a central não deixa passar com o que ela mesma executa (o teto duro é o da plataforma, abaixo).
- "Mudar limite" grava um valor na conta, sem repartir entre campanhas.
- A Visão geral e a tela de canal passam a mostrar o mês corrente na régua, qualquer que seja o período.
- O limite do CSP-MKT avisa e barra execução nova; ele não pausa o que já roda. As plataformas gastam acima do diário
  (a Meta pode gastar até 75% acima do diário num dia; o Google, até o dobro do diário num dia e 30,4 diárias no mês;
  o TikTok, a confirmar). Teto duro é o limite da conta na própria plataforma (o `spend_cap` da conta na Meta), gravado
  por execução quando houver credencial de escrita.
- O limite fica em `spend_limits`. Na Meta, o teto é o `spend_cap` da conta: todo dia 1 a central zera o gasto contado
  nele e grava o limite do mês; quando o dono muda o limite no meio do mês, grava a sobra do limite novo (execução
  `set_account_spend_cap`). Como a Meta conta o gasto depois de zerar fica a confirmar na primeira escrita. O worker lê
  o teto na releitura diária, e o executor bloqueia a escrita (`no_spend_limit`) se ele faltar ou se a sobra dele
  passar da sobra do limite (`docs/dados/integracoes.md`, seção 14).
- Para ligar a escrita numa conta, o dono define o limite dela antes.
- No PR da aprovação, a 0005 e o `CLAUDE.md` registram a exceção do teto mensal da Meta.
