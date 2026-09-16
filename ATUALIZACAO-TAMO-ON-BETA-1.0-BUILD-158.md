# Tâmo On — Build 158: abertura e leitura de notificações

Base: Build 157 já instalada. Aplicativo/HTML/Service Worker 158; banco 149; `publish-announcement` 114; `delete-beta-user` 106.

## O que mudou

- Tocar em um aviso na central abre seu conteúdo dentro do aplicativo, inclusive quando já está lido.
- O push reaproveita a janela do app por mensagem, sem navegar ou reiniciar quando a janela confirma que pode tratar a abertura. Sem janela, abre o aplicativo normalmente. Uma versão antiga que não entende a mensagem recebe a navegação de compatibilidade.
- Cada novo envio recebe um ID por destinatário, compartilhado pelos aparelhos desse destinatário. O ID salvo no banco acompanha o push. Um reenvio recebe um novo ID.
- Abrir o aviso ou tocar no push registra a leitura da notificação correspondente e atualiza os contadores. Os demais avisos permanecem como estão.
- Falha de gravação mantém a mensagem aberta, o estado de não lida e a opção “Tentar novamente”. O aplicativo não marca localmente como lida sem confirmação.
- Avisos de “Vou” e “Não vou” continuam sendo lidos automaticamente ao abrir a central; os demais exigem toque. As regras de retenção permanecem as da Build 151.
- O destino é validado, a troca de grupo respeita os grupos da conta e o bloqueio de aceite continua vigente. Conteúdo removido é informado sem impedir a consulta do texto da notificação disponível para a conta.
- Pushes antigos sem ID são associados somente quando há uma correspondência inequívoca. Quando há mais de uma, o app mostra a central para selecionar o aviso. Não baixa vários avisos por suposição.

## Publicação

1. Extraia `Tamo-On-Build-158-INCREMENTAL.zip` e envie seu conteúdo para a raiz do repositório, preservando as pastas. O pacote contém 10 arquivos; não apague pastas existentes.
2. Aguarde o deployment do Cloudflare. Abra o app e aplique a atualização. Confirme aplicativo, HTML e Service Worker 158. A instalação de uma nova versão pode recarregar a página uma vez; abrir o app totalmente encerrado também exige o carregamento inicial normal.
3. No Supabase, substitua o código da função existente **publish-announcement** pelo arquivo **publish-announcement-edge-build-114.ts** e publique. Preserve nome, secrets e configurações de autenticação. Subir o arquivo ao GitHub não publica automaticamente a Edge.
4. Execute `backend-healthcheck-beta-1.0-build-158.sql` no SQL Editor. É somente leitura. Todos os sete campos da primeira consulta devem ser `true`. A segunda consulta informa a ativação jurídica atual, sem modificá-la. Se algum campo estrutural for `false`, envie o resultado para diagnóstico; não execute o schema completo.
5. Faça os testes de aparelho abaixo usando notificações novas, geradas depois da publicação da Edge 114.

**Não há migration nesta atualização.** O banco permanece na versão 149 e `delete-beta-user` permanece na 106. Não execute novamente o SQL de ativação jurídica por causa desta build. Os documentos e os aceites já registrados são preservados.

O arquivo SQL na pasta `backend` do incremental pode ser enviado ao GitHub junto com os demais arquivos. Ele é um healthcheck, não uma migration.

## Testes de aparelho

Use duas contas: administrador para enviar e membro para receber. Alguns avisos excluem o próprio remetente.

1. Com o app do membro em segundo plano, crie um evento na conta administradora. Toque no push: deve abrir o evento e baixar somente esse aviso, sem retornar à tela de carregamento.
2. Envie um comunicado e abra-o pelo sininho. Feche os detalhes e confira que o aviso saiu do estado “Nova” e que o contador diminuiu. Toque novamente no aviso lido: o conteúdo deve abrir sem reiniciar o app.
3. Reenvie o comunicado. O novo alerta deve voltar a contar como não lido. Abrir o reenvio deve baixar apenas ele.
4. Repita com o app encerrado: o carregamento inicial é esperado, seguido da abertura e leitura do aviso. Se houver exigência de login/aceite, ela deve ser cumprida antes do acesso ao conteúdo.

Se houver outros avisos não lidos, o contador continuará exibindo esses avisos. Uma falha ao registrar leitura deve apresentar uma opção de nova tentativa. Registros `notification_read_failed` e `notification_open_failed` ajudam no diagnóstico sem registrar o texto do aviso.

## Validação realizada

- 21 verificações no Chromium com o código real do frontend e serviços Supabase simulados: abertura fria/quente, clique na central, reenvio, falhas/repetição, troca de grupo, ID ausente/alheio e bloqueio jurídico.
- 24 verificações do Service Worker e da Edge em ambiente isolado: reuso de janela, compatibilidade, destino externo, IDs por destinatário/aparelho, publicação, reenvio, evento, lembrete, mensagem do sistema e falha de persistência.
- Healthcheck com sete resultados `true` em PostgreSQL isolado; teste da RPC real antes/depois do aceite e da restrição ao usuário dono do aviso.
- Sintaxe, inspeção visual em 390 px e integridade do ZIP verificadas.

Os testes locais não enviaram notificações reais e não alteraram o Supabase publicado. A confirmação em Android/iPhone depende dos testes acima após o deployment.
