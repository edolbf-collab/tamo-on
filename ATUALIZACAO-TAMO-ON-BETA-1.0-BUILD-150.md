# Tâmo On — atualização incremental da Build 150

## Versões esperadas

- Aplicativo: 150
- HTML: 150
- Service Worker: 150
- Banco: 147
- Edge Function `publish-announcement`: 112, sem alteração nesta build

## Ordem de publicação

1. Execute no SQL Editor somente `backend/backend-migration-beta-1.0-build-150-attendance-share-and-read-all.sql`.
2. Execute `backend/backend-healthcheck-beta-1.0-build-150.sql` e confirme que todos os resultados são `true`.
3. Extraia o pacote incremental e envie todo o conteúdo para a raiz do GitHub, preservando as pastas.
4. Aguarde o deployment e confirme as versões no diagnóstico do aplicativo.

O arquivo `backend/supabase-schema.sql` deve ser atualizado no GitHub, mas não executado sobre o banco atual.

## Alterações

- Abrir o sino passa a marcar todas as notificações do usuário como lidas.
- O contador do sino e o badge do ícone instalado são limpos imediatamente.
- A operação alcança também notificações que não estejam entre os cartões carregados na tela.
- Administrador e organizador podem compartilhar a lista após o início do evento.
- O botão permanece disponível durante o evento e no histórico.
- A lista separa `Vão`, `Espera`, `Não vão` e `Sem resposta`.
- Convidados são identificados no texto.
- A tela apresenta uma prévia e as opções `Enviar pelo WhatsApp` e `Copiar lista`.

## Teste das notificações

1. Gere duas ou mais notificações para a mesma conta.
2. Confirme o contador no sino e no ícone instalado.
3. Toque apenas no sino, sem abrir nenhum cartão.
4. Confirme que o contador desaparece imediatamente.
5. Feche e abra novamente a central; nenhuma mensagem deve voltar como não lida.

## Teste do compartilhamento

1. Abra um evento futuro como administrador ou organizador e confirme que o botão ainda não aparece.
2. Use um evento que já começou ou está no histórico.
3. Abra os detalhes e toque em `Compartilhar lista`.
4. Confira os quatro grupos e seus totais na prévia.
5. Confirme que a espera respeita a ordem sorteada.
6. Confirme que convidados aparecem com a identificação `(convidado)`.
7. Use `Copiar lista` e cole o conteúdo em um campo de texto.
8. Use `Enviar pelo WhatsApp` e confirme a formatação antes de escolher a conversa.
9. Entre como membro comum e confirme que o botão não é apresentado.
