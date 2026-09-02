# Tâmo On — atualização incremental da Build 149

## Versões esperadas

- Aplicativo: 149
- HTML: 149
- Service Worker: 149
- Banco: 146
- Edge Function `publish-announcement`: 112

## Ordem de publicação

1. Execute no SQL Editor somente `backend/backend-migration-beta-1.0-build-149-user-notification-inbox.sql`.
2. Execute `backend/backend-healthcheck-beta-1.0-build-149.sql` e confirme que todos os resultados são `true`.
3. Publique `publish-announcement-edge-build-112.ts` sobre a Edge Function `publish-announcement`.
4. Extraia o pacote incremental e envie todo o conteúdo para a raiz do GitHub, preservando as pastas.
5. Aguarde o deployment e confirme as versões no diagnóstico do aplicativo.

O arquivo `backend/supabase-schema.sql` deve ser mantido no GitHub como esquema consolidado. Não o execute sobre o banco atual.

## O que muda

- O sino passa a contar todas as notificações individuais ainda não lidas.
- Avisos, lembretes, eventos, presenças, ausências, cobranças e mensagens do sistema entram na mesma caixa.
- O contador mostra de `1` a `9` e passa a `9+` acima desse limite.
- A caixa funciona mesmo para usuários sem push habilitado.
- Ao abrir o sino, as mensagens exibidas são marcadas como lidas.
- A antiga Central de avisos permanece em **Mais**, somente como histórico e administração dos comunicados do grupo.
- O teste técnico de push não entra na caixa, evitando registros desnecessários.

## Roteiro funcional

Use duas contas: uma de administrador/organizador e outra de membro.

1. Na conta do membro, abra a tela inicial e confirme que o sino não possui contador.
2. Na conta do organizador, envie um lembrete de confirmação para esse membro.
3. Sem recarregar o aplicativo do membro, aguarde alguns segundos e confirme que o sino mostra `1`.
4. Abra o sino e confirme que aparece um cartão compacto de lembrete marcado como **Novo**.
5. Confirme que o contador desaparece ao abrir a caixa.
6. Feche e abra novamente a caixa; a mesma mensagem deve continuar no histórico, sem **Novo**.
7. Toque no cartão e confirme que o aplicativo abre o evento correto.
8. Repita com um aviso do grupo e confirme que o contador aumenta novamente.
9. Desative o push no aparelho do membro, envie outro lembrete e confirme que o alerta visual ainda aparece no aplicativo.

## Avaliação de simplicidade

Durante os testes, observe:

- se título, tipo, grupo e horário podem ser entendidos rapidamente;
- se o cartão inteiro ser clicável é mais simples que apresentar vários botões;
- se a lista com rolagem continua confortável após várias mensagens;
- se a separação entre **Notificações** e **Central de avisos** fica clara;
- se algum tipo de mensagem parece repetitivo ou dispensável.

A interface foi mantida sem filtros, abas ou configurações adicionais nesta etapa. Esses controles só devem ser adicionados se os testes demonstrarem necessidade real.
