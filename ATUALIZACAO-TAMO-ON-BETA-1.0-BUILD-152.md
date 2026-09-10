# Tâmo On — atualização incremental da Build 152

## Versões esperadas

- Aplicativo: 152
- HTML: 152
- Service Worker: 152
- Banco: 148, sem alteração
- Edge Function `publish-announcement`: 112, sem alteração

## Causa corrigida

O evento `push` tentava atualizar o badge por `self.registration.setAppBadge()`. A Badging API pertence ao `WorkerNavigator` e deve ser chamada por `self.navigator.setAppBadge()` dentro do Service Worker. Como o acesso anterior usava encadeamento opcional, aparelhos sem o método no objeto incorreto simplesmente ignoravam a atualização.

Por isso, o badge do ícone só aparecia depois que o aplicativo era aberto e o frontend recalculava as notificações pendentes.

## Comportamento da Build 152

- Cada push recebido com o aplicativo fechado atualiza imediatamente o badge do ícone.
- O Service Worker mantém um contador local persistente no aparelho.
- Novos pushes incrementam esse contador sem exigir que o aplicativo seja aberto.
- Ao abrir o aplicativo, o contador local é sincronizado com o total real de avisos não lidos no banco.
- Ao baixar notificações pelo sino ou por clique, o contador do ícone é corrigido imediatamente.
- Se o aparelho não oferecer a Badging API, o push visual continua sendo exibido normalmente.

## Ordem de publicação

1. Extraia o pacote incremental.
2. Envie todo o conteúdo para a raiz do GitHub, substituindo os arquivos existentes e preservando a estrutura.
3. Aguarde o deployment.
4. Abra o aplicativo uma vez para instalar o Service Worker 152.
5. Feche completamente o aplicativo antes do teste de recebimento.

Não há SQL e não é necessário publicar novamente nenhuma Edge Function.

## Teste principal

1. Confirme no diagnóstico: aplicativo 152, HTML 152, Service Worker 152 e banco 148.
2. Feche completamente o Tâmo On, sem deixá-lo aberto em segundo plano.
3. A partir de outra conta, envie uma notificação para o aparelho testado.
4. Sem abrir o Tâmo On, volte à tela inicial do celular.
5. Confirme que o badge aparece imediatamente no ícone.
6. Envie uma segunda notificação e confirme a atualização do número, quando o sistema operacional exibir contagem numérica.
7. Abra o aplicativo sem tocar no sino e confirme que o badge continua refletindo os avisos pendentes.
8. Abra o sino e aplique as regras de leitura; confirme que o badge é reduzido ou apagado conforme o saldo restante.

## Observação sobre o iPhone

O PWA precisa estar instalado pela opção `Adicionar à Tela de Início`, com notificações permitidas. O usuário também pode manter notificações ativas e desabilitar especificamente os badges nos Ajustes do iOS; essa preferência não é exposta ao aplicativo.
