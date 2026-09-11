# Tâmo On — atualização incremental da Build 154

## Versões esperadas

- Aplicativo: 154
- HTML: 154
- Service Worker: 154
- Banco: 148, sem alteração
- Edge Function `publish-announcement`: 112, sem alteração

## Ajuste no resumo do Caixa

- O saldo consolidado do grupo passa a ocupar o principal destaque do cartão financeiro.
- O saldo consolidado considera todos os pagamentos recebidos menos todas as despesas efetivadas até o momento atual.
- Lançamentos com data futura não são antecipados no saldo consolidado.
- O período mensal selecionado não altera o saldo consolidado.
- O saldo do mês passa para o quadro de indicadores menores.
- Os quatro indicadores mensais são: saldo do mês, recebido no mês, a receber no mês e despesas do mês.
- Navegação mensal, Extrato, Cobranças, filtros, busca, pendências anteriores e ações em lote permanecem iguais à Build 153.
- A correção do badge de notificações da Build 152 permanece preservada.

## Ordem de publicação

1. Extraia o pacote incremental.
2. Envie todo o conteúdo para a raiz do GitHub, substituindo os arquivos existentes.
3. Preserve o `supabase-config.js` já configurado.
4. Aguarde o deployment.
5. Abra novamente o aplicativo para ativar o Service Worker 154.

Não há migration, healthcheck ou Edge Function para publicar nesta atualização.

## Roteiro de validação

1. Confirme no diagnóstico: aplicativo 154, HTML 154, Service Worker 154 e banco 148.
2. Confira se o **Saldo consolidado** está em destaque.
3. Valide o cálculo: todos os pagamentos efetivados até hoje menos todas as despesas efetivadas até hoje.
4. Navegue entre dois meses e confirme que o saldo consolidado não muda.
5. Confira se saldo, recebido, a receber e despesas do mês mudam conforme o período escolhido.
6. Registre e exclua um pagamento ou uma despesa e confirme a atualização do consolidado.

