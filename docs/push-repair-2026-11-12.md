# Correção de push e contador — 12/11/2026

## Diagnóstico e alteração

O servidor usava o Origin da requisição para montar links. Avisos enviados pela instalação web antiga (`resenhafc-beta.pages.dev`) falhavam nos validadores nativos, antes de chegar à Apple ou ao Google. Todos os novos links agora usam `https://app.tamoon.app.br`. A validação dos destinos permanece restrita à Comunidade.

O APNs e o FCM passam a receber o total de avisos não lidos do destinatário, consultado no servidor após a criação do aviso. A consulta segue a janela de 90 dias e o limite de 200 avisos do painel. O contador não vem do cliente. Se sua consulta falhar, o envio continua sem alterar o contador existente.

Erros locais de URL no iOS agora são classificados como payload inválido (400), sem três tentativas indevidas nem diagnóstico de falha de transporte.

O pacote móvel inclui uma ponte iOS para atualizar/zerar o contador após leitura ou saída e atualiza a caixa de avisos ao voltar ao app. Android remove as notificações já lidas da bandeja; o indicador do ícone depende do launcher. As remoções preservam avisos recém-chegados que não constavam da consulta. A fila descarta atualizações da conta anterior ao sair ou trocar de conta.

## Verificação executada

- 272 testes de regressão passaram, incluindo o handler real com I/O simulado para presença, nova partida e cobrança originados no domínio antigo, ambos os provedores, isolamento do contador por destinatário, falha de consulta e validação de URLs.
- Pacote local Android gerado e checagens estruturais iOS/Android aprovadas.
- Teste de inicialização Swift ampliado para chamar a ponte do contador; compilação e execução dependem do CI macOS.
- Edge Function `publish-announcement` publicada como versão 39. A chamada sem sessão continua respondendo 401.

## Validação física antes de publicar os pacotes móveis

1. Instalar a versão de testes Android/TestFlight com este commit.
2. Receber aviso real de outra conta com o app fechado e a tela bloqueada; confirmar alerta, contador e abertura da tela correta.
3. Abrir um aviso e conferir redução do contador; ler todos e conferir limpeza.
4. Retornar ao app após ler avisos em outro dispositivo e conferir atualização.
5. Sair da conta e conferir limpeza da bandeja/contador; entrar em outra conta e conferir ausência de avisos da anterior.

O teste de envio do painel não cria aviso na caixa e, portanto, não incrementa o contador. Eventos que excluem o autor devem ser acionados por outra conta. Os testes automatizados não comprovam recebimento físico. Não foi feito disparo em massa nem submissão das lojas nesta alteração.
