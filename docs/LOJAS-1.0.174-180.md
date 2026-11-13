# Publicação nas lojas — 1.0.174 (180)

Em 13/11/2026, o responsável validou as alterações na web e autorizou atualizar as duas lojas com todo o conteúdo atual.

## Conteúdo

- Métricas mensais para parceiros e administração do Marketplace, com comparação dos dias e horários mais e menos ocupados.
- Ajustes no centro de operações e no tema claro.
- Padronização mobile dos rótulos e valores na Comunidade e no Marketplace, evitando palavras partidas e números quebrados.
- Correções de notificações da versão 1.0.173 preservadas.

Versão 1.0.174; Android versionCode 180; build Apple 180. Xcode mantém CURRENT_PROJECT_VERSION 174 para as checagens; o arquivamento recebe 180 explicitamente. Permissões, assinatura e restrições do piloto preservadas.

## Validação

- Base aprovada: ae6efee5a8372f497d64f4e99a3f681093903780.
- 279 testes internos de regressão aprovados após atualizar os metadados da versão.
- Verificações de empacotamento e configuração Android aprovadas.
- CI da base: Android 43448171425 e iOS 43448171544 concluídos com sucesso, incluindo emulador/simulador, ponte nativa e archive Release iOS.
- Tipografia mobile validada em oito larguras, Chromium e WebKit, nos dois módulos.

## Notas da atualização

Melhoramos a leitura de textos e valores no celular e a organização dos painéis. Incluímos métricas mensais para os participantes autorizados do Marketplace e ajustes de aparência e estabilidade.

## Estado em 13/11/2026

- Versão anterior 1.0.173 (179) confirmada publicada nos dois consoles.
- Fonte exata dos dois pacotes: `61a217d7c02d4c08b9aebb7533bbb58f6d6f18a1`.

### Google Play — envio confirmado

- Produção: `Tâmo On 1.0.174 (180) – Métricas e mobile`.
- Console confirmou **Alterações em revisão** após a confirmação final. Verificações rápidas automáticas ainda em execução no momento do registro; a revisão prossegue após sua conclusão. Não é confirmação de publicação.
- Implementação de 100%, países já selecionados e publicação gerida desativada, para liberação após aprovação.
- Nenhum dispositivo perdeu compatibilidade. Aviso não bloqueante de símbolos nativos ausentes; mapeamento ReTrace incluído.
- AAB de 20.905.417 bytes, SHA-256 `f9614bb90bd23a73fd4d01950baace6a1b028b0d2b6e3e35f0fd58d81d1950a9`.
- Bundletool aprovado, assinatura verificada e certificado idêntico ao build 178. APK de distribuição também verificado. Assets do AAB conferidos contra o pacote nativo preparado, incluindo `marketplace/mobile-layout.css`.
- Console: https://play.google.com/console/u/0/developers/6239987374283365556/app/4974514517817412573/publishing

### App Store — envio confirmado

- Workflow de distribuição `43454972182` concluído com sucesso, `source_sha=61a217d7c02d4c08b9aebb7533bbb58f6d6f18a1`, `build_number=180`, `upload=true`.
- Corrigidos apenas os rótulos antigos do workflow para refletir a configuração efetiva: App Store Connect, `testFlightInternalTestingOnly=false`. Não foi alterada a configuração de distribuição.
- Build 180 processado e vinculado à versão 1.0.174. Notas da versão e instruções para revisão atualizadas; credenciais existentes preservadas.
- Submissão final confirmada por **1 Item Submitted** e **1.0.174 Waiting for Review**.
- Publicação automática após aprovação e liberação imediata para todos preservadas. Não foi iniciada outra rodada de testes.
- Console: https://appstoreconnect.apple.com/apps/6830420681/distribution/ios/version/inflight

### Validação final

- CI Android nativo `43454426883`: sucesso, incluindo emulador e ponte minificada.
- CI iOS `43454426865`: sucesso, incluindo simulador, Swift, archive Release e Keychain.
- CI tipografia mobile `43454427205`: sucesso.
- CI exclusão de conta `43454426723`: sucesso.
- Compilação Android Release (AAB e APK): sucesso. Firebase e assinatura originais preservados; arquivos privados fora do Git.
