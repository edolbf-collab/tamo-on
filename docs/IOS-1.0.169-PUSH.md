# iOS 1.0.169 — notificações e apresentação pública

Atualização sobre a versão publicada 1.0.168 (171). Build Apple 172 enviado em 07/11/2026, às 03:55 UTC.

Inclui notificações nativas APNs, controles de ativação/desativação e teste apenas para o aparelho atual; retirada dos textos públicos de Beta; área de Devoluções e revisão administrativa vindas de main af41b65. Nomes técnicos de tabelas, RPC e canal permanecem compatíveis. Marketplace continua restrito.

## Servidor

- Migração `supabase/migrations/20261107031426_native_ios_push.sql` cria registros nativos separados, leitura apenas do próprio usuário e RPC com validação de acesso. Saída remove a inscrição; rotação substitui o token anterior; nova conta reatribui a mesma instalação.
- `publish-announcement` reutiliza os filtros existentes de usuários ativos, grupos, bloqueios e caixa de avisos. Web Push continua no fluxo existente. APNs usa ES256, tópico fixo `br.app.tamoon`, HTTPS e validade de entrega zero para não reter notificações offline após uma saída.
- Configurar somente no servidor: `APNS_KEY_ID`, `APNS_TEAM_ID=4T892ZTN46`, `APNS_PRIVATE_KEY`. Chave específica de produção para `br.app.tamoon`. Nunca colocar a chave no repositório, bundle ou cliente.
- A chave App Store Connect e a chave Sign in with Apple não substituem a chave APNs.
- O pacote atual registra o ambiente APNs de produção, próprio para TestFlight/App Store; testes em aparelho assinado para desenvolvimento exigem configurar sandbox em uma variante separada.

## Validação

- Testes de payload, JWT ES256, destinos permitidos, rejeições APNs, consentimento, troca de conta, saída concorrente e abertura antes do login em `integration/community/tests/native-push.test.mjs`.
- `tests/ios-preparation/native-push.sql`: teste transacional com rollback, sem envio de notificações, cobrindo RLS, rotação, reatribuição e remoção entre contas autorizadas.
- Verificação do plugin nativo e consulta de permissão adicionadas ao teste Swift de inicialização.
- Checagens locais de pacote e 178 testes Node passaram. Migração validada transacionalmente no projeto da Comunidade. Checagem Deno passou.

## Execução em 07/11/2026

- Chave APNs específica de produção criada para `br.app.tamoon` e armazenada nos secrets do projeto da Comunidade. O material privado não integra o repositório ou o aplicativo.
- Migração aplicada em `xvwgrpnioaqyijhzqxqh`; `publish-announcement` publicada como versão 33. Tabela nativa com RLS, sem escrita direta do cliente; chamada sem autenticação retorna 401. Nenhum dispositivo nativo registrado durante a implantação.
- Fonte do build: `66256826fa7e65783108ccf332e38b403114da93` na branch `ios-build-165`.
- Validação completa no GitHub Actions: execução `42335473292`, sucesso. Inclui compilação iOS e teste de inicialização, ponte de push/permissão, Keychain, login e navegação Comunidade/Marketplace no simulador.
- Assinatura e upload: execução `42335877562`, sucesso. Archive `br.app.tamoon / 1.0.169 (172) / arm64` validado, entitlement APNs de produção conferido, exportação e upload aceitos pela Apple.
- Pacote elegível para App Store (`testFlightInternalTestingOnly=false`). Página 1.0.169 criada no App Store Connect, com notas e informações de revisão atualizadas.
- Build 172 processado e associado à versão 1.0.169. Submissão confirmada em 07/11/2026, por volta de 01:00 BRT: **Waiting for Review**. Publicação automática após aprovação, atualização para todos os usuários. A versão 1.0.168 permanece a versão pública até a aprovação.
- Recebimento real por APNs no iPhone permanece pendente; testes automatizados não substituem esta validação.

## Validação prática e publicação

1. Aguardar a análise da Apple; submissão já concluída. Acompanhar em https://appstoreconnect.apple.com/apps/6830420681/distribution/ios/version/inflight.
2. No iPhone: permitir notificações; testar aberto/fechado; tocar no aviso; sair e trocar conta; negar/reautorizar nos Ajustes. Não declarar entrega real validada antes do teste no aparelho.

Notas para a loja: “Agora o Tâmo On permite receber notificações no iPhone mesmo com o aplicativo fechado. Esta atualização também melhora a apresentação do app e a organização da Administração.”
