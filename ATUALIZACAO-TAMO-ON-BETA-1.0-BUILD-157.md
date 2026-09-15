# Tâmo On Build 157 — documentos, aceite e maioridade

Base: aplicativo/HTML/Service Worker 156, banco 148, publish-announcement 112. Nova versão: aplicativo/HTML/Service Worker 157, banco 149, publish-announcement 113 e delete-beta-user 106.

## O que foi implementado

- Termos de Uso, Política de Privacidade e Código de Conduta v1.2 acessíveis antes do login, na tela de aceite e em Documentos e privacidade. O perfil também dá acesso aos documentos quando a conta ainda não tem grupo.
- Três declarações obrigatórias separadas: concordância com Termos e Conduta; ciência da Política. Nenhuma começa marcada.
- Confirmação expressa de 18 anos completos ou mais. A opção de idade inferior impede continuar. É autodeclaração, sem coleta de nascimento ou verificação documental de identidade/idade.
- Tela bloqueante após autenticação, antes de carregar grupos. Sair da conta permanece disponível. Consentimentos de push continuam opcionais e separados.
- Registro atômico no banco com identidade da sessão, versão, hash do conteúdo, vigência, data UTC, build, origem, user-agent reduzido e declaração de maioridade. Não se coleta IP nesta etapa.
- Validação no banco, políticas restritivas de RLS, hook REST e proteção nas RPCs PL/pgSQL usadas pelo app. As permissões de grupo e do beta continuam sendo aplicadas. As duas Edges verificam o aceite do ator antes de executar ações privilegiadas.
- Novo aceite em troca de versão ativa; preservação das versões e registros anteriores; resistência a envio duplicado, versão ou hash divergente, declarações incompletas e tentativa de aceitar por outra conta.
- Exportação JSON dos próprios aceites e exportação administrativa por UUID, com motivo obrigatório registrado. A confirmação de maioridade fica na prova exportada. O UUID pode ser consultado em Authentication > Users no Supabase.
- Prova jurídica preservada após exclusão da conta: relação + cinco anos, com retenção excepcional possível. Se pg_cron estiver disponível, instala-se rotina diária de expurgo desse conjunto de dados. Sem pg_cron, o operador deve agendar/executar `select tamoon_legal.purge_expired_evidence();` periodicamente pelo SQL Editor. A função é inacessível aos clientes.

## Aplicação dos cinco documentos recebidos

Os documentos 01, 02 e 03 são públicos. Foram convertidos para HTML, mantendo o texto das seções, as tabelas, o CNPJ e os contatos. A identificação editorial de minuta e as instruções pré-publicação da capa não integram o corpo público; versão, atualização e vigência são apresentadas separadamente. O hash do corpo HTML e o hash do DOCX de origem ficam registrados no banco.

O documento 04 orienta o aceite e a auditoria. O documento 05 é a matriz interna de governança. Esses dois documentos internos não foram incluídos nos arquivos públicos. Os cinco DOCX recebidos permanecem inalterados.

A matriz não foi transformada em uma rotina de exclusão geral. Esta build automatiza somente a retenção dos aceites. Os demais prazos, backups, inventário de fornecedores, tratamento de pedidos LGPD, resposta a incidentes e enquadramento do encarregado ainda exigem validação operacional antes do beta aberto. A publicação no site institucional separado de tamoon.app.br deve apontar para as páginas desta instalação ou recebê-las em atualização própria.

## Vigência e ativação

Os cinco DOCX v1.2 ainda indicam `[A DEFINIR NA PUBLICAÇÃO DO BETA ABERTO]`. Por isso, a migration instala a estrutura com `enabled=false`: o aceite e a trava de idade ainda não são exigidos na produção apenas por instalar a Build 157.

É preciso definir a vigência, publicar todos os componentes e executar o SQL de ativação. Esse arquivo vem com `NULL` no parâmetro de vigência, de propósito: sem a data explicitamente definida, ele interrompe sem alterar a exigência. Não preencha retroativamente uma data anterior aos documentos. O SQL não permite ativar antes da data escolhida nem alterar a vigência de versão já publicada.

Até a ativação, o menu mostra os textos preparados e informa que a vigência está pendente. Após ativar, novos acessos sem aceite ficam bloqueados. Sessões abertas são reavaliadas ao voltar para a aba, no monitor periódico de dois minutos e quando o backend recusa uma operação. Uma versão antiga do app não pode contornar o backend; deve ser atualizada para exibir o aceite.

## Ordem de instalação

1. No Supabase atual da Comunidade, executar `backend/backend-migration-beta-1.0-build-157-legal-acceptance.sql`.
2. Executar `backend/backend-healthcheck-beta-1.0-build-157.sql`. Todos os campos da primeira consulta devem ser `true`. A segunda consulta informa o estágio; `legal_requirement_active=false` é esperado antes da ativação. `scheduler_available` informa se há pg_cron e não é um teste de falha da implantação.
3. Enviar o conteúdo do incremental à raiz do GitHub, preservando as pastas. Mesclar `backend`, `legal` e `supabase` com as existentes. Não substituir o projeto inteiro nem apagar pastas antes do upload.
4. Publicar as duas Edge Functions: `supabase/functions/publish-announcement/index.ts` (113) e `supabase/functions/delete-beta-user/index.ts` (106). O upload no GitHub, sozinho, não garante a publicação delas no Supabase.
5. Aguardar o deployment do frontend. Conferir aplicativo/HTML/SW 157 e banco 149. Abrir Documentos e privacidade e conferir os três textos e os contatos.
6. Após definir a vigência, preencher e executar `backend/backend-activation-beta-1.0-build-157.sql`. Repetir o healthcheck: a segunda consulta deve mostrar a exigência ativa e três documentos ativos.
7. Fazer os testes abaixo em contas do beta, incluindo a conta administrativa.

`backend/supabase-schema.sql` permanece como referência consolidada no GitHub. Não executá-lo sobre o banco existente. A instalação não remove a lista de e-mails autorizados do beta nem integra o Marketplace.

## Testes de aceitação no ambiente publicado

- Conta existente sem aceite: não vê grupos antes das declarações; nenhuma seleção pré-marcada.
- Menos de 18 anos: não consegue continuar, mesmo marcando os três documentos.
- Maioridade confirmada com uma declaração faltando: botão permanece bloqueado.
- Ler/fechar cada documento: as seleções permanecem; sair funciona sem aceite.
- Completar e aceitar: retornar ao app com os mesmos grupos e permissões. Fechar/reabrir não pede novamente para a mesma versão.
- Outra conta: seu aceite é independente. Repetir com a conta administrativa.
- Documentos e privacidade: ler os três textos, baixar o próprio registro, fechar a tela e continuar no app.
- Administrador: exportar por UUID e motivo; confirmar registro em `tamoon_legal.audit`. Membro comum não pode executar a exportação administrativa.
- Validar push e as demais operações já homologadas depois do aceite; conferir que a conta sem aceite não consegue disparar ações por Edge.

## Validação executada

- Migration, reaplicação, healthcheck e 44 verificações de comportamento em PostgreSQL via PGlite, com tabelas e funções representativas em ambiente isolado. Não houve execução no Supabase de produção.
- 20 verificações do frontend real em Chromium com backend simulado, em 390 px e 1280 px: bloqueio inicial, maioridade, declarações, preservação das seleções, falha de rede, retorno ao app, reavaliação, logout, acesso público e menu permanente.
- Inspeção visual e ajuste de contraste dos controles e tabelas. Sem rolagem horizontal da página no celular; tabelas extensas têm rolagem própria.
- Conteúdo dos três DOCX comparado à conversão HTML, sintaxe JavaScript/TypeScript e integridade do ZIP conferidos.

Esses testes não substituem a homologação das políticas e funções legadas no banco real nem o teste em Safari/iPhone. O healthcheck e a sequência acima permitem validar essa integração sem ativar o bloqueio antecipadamente.

Referência técnica da proteção REST combinada com RLS: [Supabase — Securing your API](https://supabase.com/docs/guides/api/securing-your-api).
