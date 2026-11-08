# Android 176 — correção da consulta de permissões

Relato no teste interno da build 175: abrir notificações falha com `Cannot read properties of undefined (reading 'receive')`.

## Causa confirmada no AAB 175

A inspeção do DEX do arquivo assinado mostrou que `Plugin.getPermissionStates()` foi otimizado pelo R8 para criar um mapa vazio e registrar `missing @CapacitorPlugin annotation`. O ramo que lê as permissões não existe no método compilado. `checkPermissions()` resolve sem dados quando esse mapa está vazio. No Android 13+, o plugin de push delega a consulta a esse método.

A anotação de PushNotifications com alias `receive` está presente no DEX. O problema é o acesso aos metadados pelo PluginHandle otimizado, não uma permissão negada pelo usuário.

## Correção

- Preservar PluginHandle e anotações do Capacitor contra remoção/otimização.
- Retorno ausente ou inválido da ponte vira estado `unavailable`, sem lançar TypeError, sem supor consentimento e sem registrar dispositivo.
- A tela diferencia consulta indisponível de notificações desativadas.
- Teste nativo verifica a anotação de permissão e a resposta da ponte.
- Workflow passa a compilar e testar debug com otimização R8 usando `-PverifyMinifiedBridge`.
- Próximo pacote Android: versionName 1.0.170, versionCode 176.

## Validação

55 testes JS de push/comunidade passaram, incluindo retorno ausente, nulo, vazio e estado inesperado. A verificação estrutural Android passou. Compilação de distribuição assinada concluída (257 tarefas), assinatura verificada e inspeção do DEX confirmou campo pluginAnnotation e getter preservados. SHA256: e397ee580da510b2ab1b1b7d6cc1285bca87f7a42bd7c339bd4403d034fd16c9. Validação no aparelho permanece pendente.

A publicação do código no GitHub foi bloqueada pela revisão automática por exigir autorização explícita para esse destino. Nenhuma alteração remota foi feita nesta etapa.
