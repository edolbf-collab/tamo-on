# Tâmo On Beta 1.0 — Build 144

## O que muda

- Nova ação **Baixar em lote** na tela Caixa.
- Lista somente pendências abertas ou parciais vinculadas a membros.
- Exibe nome, descrição, vencimento, valor já pago e saldo restante.
- Permite selecionar várias pendências, definir forma e data do pagamento e confirmar uma única operação.
- Cada entrada é vinculada à cobrança e ao membro correspondente.
- Cada cobrança selecionada é quitada pelo saldo restante, respeitando pagamentos parciais anteriores.
- A operação é transacional: se uma pendência tiver sido alterada, encerrada ou se qualquer item falhar, nenhuma baixa do lote é gravada.

## Versões

- Aplicativo: **144**
- HTML: **144**
- Service Worker: **144**
- Banco: **141**
- Edge Function: **111** — sem alteração nesta atualização

## Ordem de publicação

1. No Supabase, abra o **SQL Editor**.
2. Execute todo o arquivo `backend/backend-migration-beta-1.0-build-144-batch-payments.sql`.
3. Confirme que o SQL terminou sem erro.
4. Envie ao GitHub todo o conteúdo do pacote da Build 144, preservando a estrutura de pastas.
5. Aguarde o deployment concluir e abra o aplicativo.
6. Em **Mais > Sobre e diagnóstico**, confirme Aplicativo 144, HTML 144, Service Worker 144 e Banco 141.

## Teste funcional recomendado

1. Crie uma cobrança em lote para pelo menos dois membros.
2. Se desejar testar saldo parcial, lance manualmente parte do pagamento de um deles.
3. Acesse **Caixa > Baixar em lote**.
4. Selecione as pendências desejadas e confirme.
5. Verifique que:
   - foram criadas entradas individuais para todos os nomes selecionados;
   - cada entrada mostra o membro vinculado;
   - o valor lançado corresponde ao saldo restante de cada pendência;
   - todas as pendências selecionadas aparecem como **Pago**;
   - pendências não selecionadas permanecem inalteradas.

## Edge Function

Não é necessário reenviar nem publicar Edge Function. A `publish-announcement` permanece na **Build 111**.
