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
- Pacote publicado no teste interno: versionName 1.0.170, versionCode 176.

## Validação

55 testes JS de push/comunidade passaram, incluindo retorno ausente, nulo, vazio e estado inesperado. A verificação estrutural Android passou. Compilação de distribuição assinada concluída (257 tarefas), assinatura verificada e inspeção do DEX confirmou campo pluginAnnotation e getter preservados. SHA256: e397ee580da510b2ab1b1b7d6cc1285bca87f7a42bd7c339bd4403d034fd16c9.

Código publicado na branch `feat/android-native` após autorização. Build 176 disponível no teste interno da Google Play desde 08/11/2026. O usuário confirmou que a consulta de permissões e a criação do vínculo funcionam no aparelho.

## Correção posterior no servidor: URL de notificação

O teste físico seguinte falhou com mensagem pública de rejeição pelo serviço de push. Os registros do servidor mostraram `INVALID_NOTIFICATION_URL`, HTTP 400, em 08/11/2026 às 12:18:43 UTC. O envio era bloqueado pelo validador local antes de chegar ao FCM: o handler usava `Origin: https://localhost` do Android para montar o link. Somente a origem interna do iOS já era normalizada.

`publish-announcement` agora normaliza as origens internas de Android e iOS para `https://app.tamoon.app.br`. A lista de destinos permitidos do FCM/APNs permanece intacta, assim como a autenticação, o vínculo existente e a preferência por `APP_BASE_URL` configurada.

O teste de regressão executa o handler real com I/O simulado e os validadores reais dos dois provedores. Antes da correção, seis casos de origem localhost falharam. Depois, passaram todos os 70 testes JS de push/comunidade. Também são verificados o retorno ao app instalado, a manutenção do bloqueio de URLs externas e a exigência de sessão válida.

Correção publicada no Supabase Comunidade como versão 37 de `publish-announcement`, status ACTIVE; os arquivos recuperados do servidor conferem com os testados. A validação remota do FCM retornou HTTP 200 com `validate_only`, sem enviar mensagem ao aparelho. A confirmação visual de recebimento deve ser feita repetindo o teste na build 176, sem reinstalar ou criar novo vínculo.
