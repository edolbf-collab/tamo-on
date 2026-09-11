# Tâmo On — atualização incremental da Build 155

## Versões esperadas

- Aplicativo: 155
- HTML: 155
- Service Worker: 155
- Banco: 148, sem alteração
- Edge Function `publish-announcement`: 112, sem alteração

## Ajustes no Caixa

- As cobranças são apresentadas em blocos ordenados: **Em aberto e vencidas**, **Parciais**, **Pagas** e **Canceladas**.
- Dentro dos blocos, as cobranças seguem a data de vencimento; entre as pendências, cobranças vencidas têm prioridade sobre as ainda em aberto.
- A data de vencimento passa a aparecer em cada cobrança.
- A lista de jogadores do lançamento manual está em ordem alfabética, sem alterar a ordem de outras telas.
- A busca nominal agora possui um botão **Buscar** visível.
- A tecla de pesquisa do teclado virtual também executa a busca e fecha o teclado.
- A filtragem continua acontecendo enquanto o usuário digita.
- O campo de pesquisa utiliza o tamanho mínimo seguro para impedir o zoom automático do Safari no iPhone.
- A pesquisa do Extrato encontra membros vinculados tanto a pagamentos quanto a despesas.
- A organização mensal e o saldo consolidado das Builds 153 e 154 permanecem preservados.

## Ordem de publicação

1. Extraia o pacote incremental.
2. Envie todo o conteúdo para a raiz do GitHub, substituindo os arquivos existentes.
3. Preserve o `supabase-config.js` já configurado.
4. Aguarde o deployment.
5. Abra novamente o aplicativo para ativar o Service Worker 155.

Não há migration, healthcheck ou Edge Function para publicar nesta atualização.

## Roteiro de validação

1. Confirme no diagnóstico: aplicativo 155, HTML 155, Service Worker 155 e banco 148.
2. Abra **Caixa > Cobranças** e confirme a ordem dos quatro blocos.
3. Confira se cada cobrança exibe sua data de vencimento.
4. Abra **+ Lançar** e confirme a ordem alfabética dos jogadores.
5. Toque no campo de pesquisa pelo iPhone e confirme que a tela não aumenta o zoom.
6. Pesquise o nome de um membro e pressione **Buscar**.
7. Repita a pesquisa usando a tecla de busca do teclado virtual.
8. Confira a busca em Extrato e Cobranças, inclusive para uma despesa vinculada a membro.
