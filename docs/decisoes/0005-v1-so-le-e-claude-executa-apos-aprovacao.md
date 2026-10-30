# 0005 — A v1 só lê; o Claude recomenda e executa só depois de aprovação

- **Data:** 2026-10-30
- **Status:** aceita

## Contexto

O dono pediu "o Claude rodando o tráfego pago". O padrão (`docs/06`) trata a IA como quem sugere, não decide. Executar nas plataformas exige credenciais de escrita aprovadas (Meta Full Access com App Review e Business Verification; usuário com nível Standard na conta Google Ads; app TikTok com escopos de gestão), que levam semanas, e cria risco de gasto.

## Decisão

A v1 só lê as plataformas e o CRM. A única escrita fora do CSP-MKT é a execução de ação de tráfego pelo Claude, sempre depois de aprovação do dono (ou do gestor, quando existir) na central, e só quando houver credencial de escrita aprovada. A central mostra cada recomendação com os números que a justificam; a fila de aprovação, o `spend_cap` por conta e o botão de parar tudo nascem na v1. Enquanto não há credencial de escrita, a recomendação tem "Marcar como feita" (quem, quando). Nada automático: autonomia acima de "executa depois de aprovação" só entraria com decisão nova e limites numéricos.

Credenciais de leitura e de escrita são separadas por plataforma; ficam só no Railway (variáveis de ambiente) ou na tabela `connector_credentials`, cifradas, sem política de leitura para `anon`/`authenticated`; nunca com prefixo `VITE_`, nunca em log. Trilha em `traffic_actions` (proposto por, prompt, contexto, ação, parâmetros, status, aprovado por, executado em, resultado) e cópia diária dos logs `activities` da Meta e `change_event` do Google.

## Alternativas consideradas

- **Só recomendar, humano executa no Ads Manager:** menos risco e sem App Review, mas o dono pediu o Claude operando.
- **Executar sozinho até um limite / autonomia total:** rejeitadas na v1 — desvio da regra da IA que sugere, exigiria limites numéricos e monitoramento diário.

## Consequências

- Começar cedo a Business Verification e o App Review da Meta: é o item mais longo do projeto.
- O contexto enviado ao Claude nunca leva nome, documento ou telefone.
- O módulo Tráfego com IA funciona completo no modo demonstração com operador simulado.
