# Tâmo On — atualização incremental da Build 153

## Versões esperadas

- Aplicativo: 153
- HTML: 153
- Service Worker: 153
- Banco: 148, sem alteração
- Edge Function `publish-announcement`: 112, sem alteração

## Organização mensal do Caixa

- O Caixa abre automaticamente no mês atual.
- As setas permitem navegar mês a mês dentro do período coberto pelo histórico financeiro.
- O resumo mensal separa saldo, valores recebidos, valores a receber e despesas.
- O saldo considera somente pagamentos recebidos menos despesas; cobranças não são contadas como entrada antes do pagamento.
- A aba **Extrato** mostra pagamentos e despesas do mês em ordem cronológica e agrupados por dia.
- A aba **Cobranças** usa o mês do vencimento e separa cobranças pendentes, parciais, pagas e canceladas.
- Pagamentos vinculados a cobranças antigas aparecem no Extrato do mês em que foram efetivamente recebidos.
- Pendências de meses anteriores permanecem visíveis em um painel recolhível.
- Busca por descrição ou membro e filtros rápidos estão disponíveis nas duas áreas.
- Cobrança em lote, baixa em lote, lançamento individual e exclusão continuam disponíveis conforme as permissões atuais.

## Ordem de publicação

1. Extraia o pacote incremental.
2. Envie todo o conteúdo para a raiz do GitHub, substituindo os arquivos existentes.
3. Preserve a estrutura do repositório e o arquivo `supabase-config.js` já configurado.
4. Aguarde o deployment.
5. Abra novamente o aplicativo para ativar o Service Worker 153.

Não há migration, healthcheck ou Edge Function para publicar nesta atualização.

## Roteiro de validação

1. Confirme no diagnóstico: aplicativo 153, HTML 153, Service Worker 153 e banco 148.
2. Abra **Caixa** e confirme que o mês atual aparece por padrão.
3. Navegue para um mês anterior e volte ao atual.
4. Confira se **Recebido** soma somente pagamentos e se **Despesas** soma somente saídas do mês.
5. Confira se **Saldo do mês** corresponde a recebido menos despesas.
6. Alterne entre **Extrato** e **Cobranças**.
7. Teste os filtros e a busca pelo nome de um membro ou descrição.
8. Abra o painel de pendências anteriores, quando disponível.
9. Registre uma cobrança, um pagamento e uma despesa e confirme em qual mês cada item aparece.
10. Teste cobrança em lote, baixa em lote e exclusão de lançamento.
