# Publicação nas lojas — 1.0.173 (179)

Em 12/11/2026, o responsável autorizou o envio direto à produção após os testes internos, dispensando uma rodada adicional de homologação física.

## Conteúdo

Inclui as correções de envio e contadores documentadas em `push-repair-2026-11-12.md`: URLs canônicas, tratamento correto das falhas locais, contador nativo no iOS e identificação/remoção dos avisos lidos no Android.

Versão 1.0.173; Android versionCode 179; build Apple 179. Xcode mantém CURRENT_PROJECT_VERSION 173 para as checagens e o arquivamento recebe 179 explicitamente. Dependências e permissões preservadas.

## Preparação

- 271 testes de regressão passaram na versão 1.0.173.
- Android da base corrigida aprovado em CI, incluindo emulador: execução 43220020797.
- Firebase cliente restaurado do AAB 178, SHA-256 verificado contra a publicação anterior: c3856e67274e2ce38eae2487af51c8b0b0476d8aa41fb7e3588a3b3faacfbddb.
- Chave de upload original preservada; arquivos de configuração e assinatura fora do Git.
- Correção de servidor já ativa: publish-announcement versão 41.

## Notas da atualização

Melhoramos a entrega das notificações e a atualização dos indicadores de avisos. Corrigimos a abertura de notificações e a limpeza dos avisos já lidos.

## Estado

### Google Play — envio confirmado em 12/11/2026

- Produção: release 7, `Tâmo On 1.0.173 (179) – Notificações`.
- Console confirmou **Alterações em revisão** após o envio; as verificações rápidas foram concluídas. A revisão de produção segue pendente, sem confirmação de publicação.
- Implementação de 100%, nos países já selecionados, com publicação gerida desativada (liberação após aprovação).
- Nenhum dispositivo perdeu compatibilidade. Único aviso não bloqueante: ausência de símbolos de depuração nativos; arquivo ReTrace incluído.
- AAB assinado com a chave original: `Tamo-On-Android-1.0.173-179.aab`, 20.897.351 bytes, SHA-256 `e6b6a3b325895678729e037ac2ec97ffad97e821f7180f8aa8056411428a02a5`.
- Fonte exata do pacote: `486a97d28a5a5bab6360da2ed4f858935bb4da2e`.
- Console: https://play.google.com/console/u/0/developers/6239987374283365556/app/4974514517817412573/publishing

### App Store — envio para revisão confirmado em 12/11/2026

- Versão anterior 1.0.172 confirmada como Ready for Distribution.
- Versão 1.0.173 criada em Prepare for Submission; notas da atualização e revisão salvas. Publicação automática após aprovação e atualização imediata para todos preservadas.
- O responsável autorizou a continuação da autenticação do GitHub pelo Google e a gravação deste registro; login concluído.
- Build 179 gerado e enviado pelo workflow `ios-testflight.yml`, com `source_sha=486a97d28a5a5bab6360da2ed4f858935bb4da2e`, `build_number=179`, `upload=true`. Execução 43233350566 concluída com sucesso em 12/11/2026 às 14:09:16 UTC.
- App Store Connect recebeu 1.0.173 (179) às 11:09 de Brasília; processamento concluído e build vinculado à versão de produção.
- Apesar da descrição antiga da opção de upload mencionar teste interno, a configuração efetiva usa `method=app-store-connect`, `destination=upload` e `testFlightInternalTestingOnly=false`, permitindo submissão à App Store.
- Submissão final realizada às 11:13 de Brasília. Confirmação exibida: **1 Item Submitted**; versão **1.0.173 Waiting for Review**.
- Publicação automática após aprovação e liberação imediata para todos preservadas; não foi iniciada nova rodada de distribuição de testes.
- Console: https://appstoreconnect.apple.com/apps/6830420681/distribution/ios/version/inflight

### Validação da versão final

- 271 testes de regressão aprovados localmente na versão 1.0.173.
- CI Android nativo: 43222171705, sucesso, incluindo emulador e ponte minificada.
- CI iOS: 43222171843, sucesso, incluindo compilação Swift, archive Release e testes nativos de inicialização, Keychain e contador.
- CI exclusão de conta: 43222171725, sucesso.
- Bundletool e assinaturas AAB/APK validados; certificado igual ao pacote 178; assets conferidos contra a fonte da versão.
- Não houve nova rodada física de push nesta publicação, conforme autorização do responsável.
