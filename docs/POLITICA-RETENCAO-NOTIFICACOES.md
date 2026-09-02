# Política operacional de retenção de notificações — Tâmo On

Versão técnica correspondente à Beta 1.0 Build 151 / Database Build 148.

Este documento registra a regra implementada no produto e serve como fonte para a futura adequação da Política de Privacidade, dos Termos de Uso, do registro das operações de tratamento e do RIPD. A redação pública final deve ser revisada pelo encarregado de dados ou pela assessoria jurídica.

## Prazos implementados

| Registro | Exibição normal | Conservação no banco principal | Destino |
| --- | ---: | ---: | --- |
| Notificação individual | 90 dias | 180 dias | Exclusão automática |
| Estado e método de leitura | Junto da notificação | 180 dias | Exclusão conjunta |
| Aviso publicado no grupo | 12 meses ou exclusão anterior pelo administrador | 24 meses | Exclusão automática |
| Recibo de acesso a aviso do grupo | Não possui tela própria | 24 meses | Exclusão automática |
| Tentativa técnica de push | Painel técnico limitado aos últimos 30 dias | 180 dias | Exclusão automática, quando a tabela técnica estiver presente |
| Assinatura de push desativada ou invalidada | Não exibida como ativa | 30 dias após a invalidação ou atualização | Exclusão automática |
| Resultado das rotinas de descarte | Não exibido ao usuário | 24 meses | Exclusão automática |

Os dados existentes em backups seguem a janela contratada e tecnicamente praticada pelo provedor de infraestrutura. Esse prazo precisa ser confirmado no plano efetivamente utilizado antes de ser declarado nos documentos públicos.

## Significado da leitura

- `clicked`: o usuário clicou no cartão da notificação para abri-la.
- `notification_center_opened`: a Central foi aberta e a baixa automática foi aplicada exclusivamente aos avisos de presença.
- `legacy`: o registro foi marcado antes de o sistema distinguir o método de baixa.

O campo de leitura não comprova que o usuário leu ou compreendeu o conteúdo. Ele registra somente a ação técnica correspondente.

## Tipos baixados por clique

- Aviso do grupo (`announcement`).
- Aviso reenviado (`announcement-resend`).
- Novo evento (`match-created`).
- Lembrete de confirmação (`attendance-reminder`).
- Nova cobrança (`charge-created`).
- Mensagem do sistema (`system-announcement`).
- Tipos novos ou desconhecidos, por segurança, também exigem clique.

## Tipos baixados ao abrir a Central

- Presença confirmada (`attendance-confirmed`).
- Alteração para ausência (`attendance-declined`).

## Preservação excepcional

Uma notificação ou um aviso pode receber preservação temporária por obrigação legal, investigação de fraude, incidente de segurança, disputa ou exercício regular de direitos. A preservação exige:

1. identificação exata do registro;
2. justificativa documentada;
3. data final obrigatória;
4. acesso restrito;
5. liberação ou reavaliação ao término do prazo.

Enquanto a preservação estiver ativa, o banco impede a exclusão do registro correspondente. A justificativa fica em tabela administrativa sem acesso por membros dos grupos.

## Acesso excepcional

O acesso ao histórico completo deve ocorrer pelo SQL Editor do Supabase, por pessoa autorizada, com consulta somente de leitura e escopo mínimo. Deve-se registrar externamente a data, o responsável, a finalidade, o usuário ou grupo consultado e o período abrangido.

Arquivos exportados constituem novas cópias de dados pessoais. Devem permanecer protegidos e ser eliminados assim que a finalidade específica terminar.

## Execução da limpeza

A função `public.purge_expired_notification_data()` é restrita ao serviço administrativo. O agendamento `tamoon-notification-retention-daily` a executa diariamente às 03:17 UTC. Cada execução grava apenas os totais eliminados e o horário, sem copiar o conteúdo das notificações.
