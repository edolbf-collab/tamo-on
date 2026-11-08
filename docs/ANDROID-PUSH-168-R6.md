# Android push — 168-R6

Em 07/11/2026, o usuário confirmou que a atualização pelo TestFlight funcionou. No Android, relatou confirmação de vínculo sem mudança na tela. A imagem mostra assinatura existente, vínculo salvo, estado de permissão diferente de granted/denied e ausência dos botões de teste. A entrega física no Android continua sem validação.

## Correção

- Consultar PushManager.permissionState de forma assíncrona, além de Notification.permission. Não presumir autorização pela existência da assinatura nem guardar uma autorização anterior. Negação explícita continua prevalecendo.
- Validar novamente a permissão, a assinatura local e o vínculo salvo antes de confirmar a ativação.
- Exibir “Vínculo salvo · permissão pendente” quando aplicável e atualizar a tela após a tentativa. Permitir nova consulta após ajustes no sistema.
- Manter o teste local do Android acessível mesmo com permissão pendente; a própria API decide se pode exibir. O teste remoto exige permissão e vínculo ativos.
- Atualizar a integração web/cache para 168-R6. Sem alterações de banco, envio de push em massa ou novo build iOS.

## Evidência e limites

Testes executam os métodos reais do app com APIs do aparelho simuladas, cobrindo a tela relatada, autorização assíncrona com snapshot síncrono pendente, sucesso falso após requestPermission, atualização da tela e revogação nos ajustes. Não comprovam a exibição no telefone físico.

O Chromium documenta a delegação da permissão da TWA para o aplicativo Android: https://chromium.googlesource.com/chromium/src/+/HEAD/chrome/android/java/src/org/chromium/chrome/browser/browserservices/permissiondelegation/README.md

Essa delegação é contexto técnico; a causa específica da divergência de APIs no aparelho do usuário ainda não foi confirmada. Após publicar, confirmar 168-R6, verificar permissão e executar o teste local, seguido do remoto quando habilitado.
