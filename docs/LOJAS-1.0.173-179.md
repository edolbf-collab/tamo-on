# Publicação nas lojas — 1.0.173 (179)

Em 12/11/2026, o responsável autorizou o envio direto à produção após os testes internos, dispensando uma rodada adicional de homologação física.

## Conteúdo

Inclui as correções de envio e contadores documentadas em `push-repair-2026-11-12.md`: URLs canônicas, tratamento correto das falhas locais, contador nativo no iOS e identificação/remoção dos avisos lidos no Android.

Versão 1.0.173; Android versionCode 179; build Apple planejado 179. Xcode mantém CURRENT_PROJECT_VERSION 173 para as checagens e o arquivamento recebe 179 explicitamente. Dependências e permissões preservadas.

## Preparação

- 271 testes de regressão passaram na versão 1.0.173.
- Android da base corrigida aprovado em CI, incluindo emulador: execução 43220020797.
- Firebase cliente restaurado do AAB 178, SHA-256 verificado contra a publicação anterior: c3856e67274e2ce38eae2487af51c8b0b0476d8aa41fb7e3588a3b3faacfbddb.
- Chave de upload original preservada; arquivos de configuração e assinatura fora do Git.
- Correção de servidor já ativa: publish-announcement versão 41.

## Notas da atualização

Melhoramos a entrega das notificações e a atualização dos indicadores de avisos. Corrigimos a abertura de notificações e a limpeza dos avisos já lidos.

## Estado

Preparação do lançamento. Este registro não confirma envio nem aprovação nas lojas; atualizar após verificar os consoles.
