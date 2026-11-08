# Android nativo — preparação 1.0.170 (175)

O aplicativo Android publicado usa TWA. No aparelho testado em 07/11/2026, trocar o navegador padrão para Chrome liberou as notificações. Esta migração empacota as telas da Comunidade e do Marketplace com Capacitor e usa FCM diretamente no Android. O recebimento deixa de depender das permissões de sites ou da escolha do navegador padrão.

## Implementação

- `mobile/android` é o novo projeto Android. O diretório `android` na raiz permanece como referência da versão TWA; não deve ser usado para gerar a nova distribuição.
- Mesmo `applicationId` (`br.app.tamoon`) e alias de upload (`tamoon-upload`). O AAB final precisa da mesma chave de upload já aceita pela Play Console. Confirmar que o código 175 ainda está livre antes do envio.
- Telas e JavaScript locais, sem `server.url`, scripts remotos ou atualização de código pela web. O aplicativo continua usando os serviços online de autenticação e dados.
- Login Google por OAuth/PKCE no navegador do sistema, com retorno ao aplicativo. Nenhuma exigência de Chrome padrão. A sessão fica cifrada com chave AES/GCM do Android Keystore e não participa de backups. Retorno após encerramento do processo recupera a tentativa pendente; vinculação verifica a identidade.
- FCM usa o pedido de permissão do Android e o canal `tamoon-alerts`. Permissão do sistema/canal bloqueada não produz estado ativo. Renovação de token é persistida sem exigir novo vínculo manual. Saída remove o vínculo do servidor antes de apagar o token.
- `android_push_subscriptions` e RPCs específicos mantêm os cadastros APNs e Web Push existentes. Migração aditiva com RLS, acesso autenticado, aceite legal e exclusão em cascata.
- Envio HTTP v1 com OAuth assinado no servidor, cache de token, URLs fixas, carga visível em segundo plano e pacote destinatário restrito. Apenas `UNREGISTERED` invalida o token; falhas de configuração não apagam registros.
- Origens nativas `https://localhost` e `capacitor://localhost` aceitas pelas duas funções de integração do Marketplace, preservando autenticação e permissões.

## Configuração e implantação em 08/11/2026

- Projeto Firebase exclusivo `tamoon-notificacoes` (número `768885495310`), plano Spark e Analytics desativado. Android registrado como `1:768885495310:android:d942be52d76c3845854e5f`, pacote `br.app.tamoon`.
- `google-services.json` obtido e validado em `mobile/android/app`, ignorado pelo Git. Credencial de envio de uma conta de serviço dedicada salva como `FCM_SERVICE_ACCOUNT_JSON` no Supabase da Comunidade. A credencial privada não integra o aplicativo nem o repositório.
- Teste do remetente FCM HTTP v1 em modo `validate_only` retornou HTTP 200, sem entrega de mensagens. Isso valida a configuração do serviço; não comprova recebimento em aparelho físico.
- Migração `native_android_push` aplicada na Comunidade (`xvwgrpnioaqyijhzqxqh`). RLS de leitura pelo próprio usuário; chamadas anônimas e escrita direta pelo cliente bloqueadas.
- `publish-announcement` versão 36 e `marketplace-group-pilot` versão 7 publicados na Comunidade. `community-marketplace-session` versão 6 publicado no Marketplace (`owybghlwcohfyapvsfdo`). Autenticação interna e configuração de verificação JWT anteriores preservadas; origens Android adicionadas à integração.
- Compilações debug e release concluídas com a configuração Firebase real. AAB 1.0.170 (175) assinado com a chave de upload original; SHA-256 do arquivo: `aee20e8138dff8c3677ba17d76bd5d597465c2cffb0e3f22e96dec50bc4a310a`. Arquivo de entrega: `Tamo-On-Android-Nativo-1.0.170-175.aab`.
- O AAB ainda não foi enviado à Play Store. Conferir disponibilidade do código 175 e realizar a distribuição de teste antes da validação física e da liberação pública.

## Validação

Em 08/11, os testes locais de Comunidade, Marketplace, autenticação, push web/nativo e banco isolado somaram 219 aprovações. O teste de banco aplica as migrações reais em Postgres isolado, com funções de autorização de teste, e verifica rotação, RLS, impedimento de gravação direta, ausência de acesso anônimo, transferência de vínculo, remoção e cascata sem alterar dados de produção.

`android-native-validation.yml` compila o aplicativo debug e executa um teste em emulador para abertura do login empacotado e leitura/gravação/remoção pela ponte de armazenamento cifrado. Consultar o resultado da execução antes de considerar essa validação aprovada.

Ainda necessários antes da distribuição: teste físico de permissão, recebimento com tela bloqueada e app em segundo plano/encerrado, abertura do aviso na Comunidade e no Marketplace, troca de conta, atualização sobre o app atual da Play Store e Google login com Chrome e Samsung Internet como padrão. O Android continua podendo suspender notificações após uma parada forçada explícita ou bloqueio imposto pelo usuário.

A atualização TWA → Capacitor preserva a conta e os dados do servidor, mas pode pedir um novo login porque a sessão antes pertencia ao navegador. Os vínculos Web Push antigos não são apagados em massa: não há identificação segura para distingui-los de outros dispositivos. Conferir eventual duplicidade no teste de atualização e tratar somente o vínculo identificado.

## Comandos

```sh
npm ci --prefix mobile
npm run sync:android --prefix mobile
npm run check --prefix mobile
npm run check:android --prefix mobile
node --test tests/push/*.test.mjs integration/auth/tests/*.test.mjs integration/community/tests/*.test.mjs integration/marketplace/tests/*.test.mjs tests/ios-preparation/identity-linking.test.mjs mobile/tests/android-*.test.mjs
# Na pasta mobile/android, depois de configurar Firebase e a assinatura:
./gradlew --no-daemon :app:bundleRelease
```
