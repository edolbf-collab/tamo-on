# iOS 1.0.169 — notificações e apresentação pública

Atualização sobre a versão publicada 1.0.168 (171). Próximo envio previsto: build Apple 172.

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

## Antes de enviar à revisão

1. Concluir a chave APNs e configurar os secrets do servidor.
2. Aplicar migração e publicar a função; confirmar ausência de alteração nas inscrições Web Push existentes.
3. Compilar e assinar build 172, verificar entitlement APNs de produção no archive exportado e enviar ao TestFlight.
4. No iPhone: permitir notificações; testar aberto/fechado; tocar no aviso; sair e trocar conta; negar/reautorizar nos Ajustes.
5. Associar build à versão 1.0.169 e enviar à revisão da App Store. Não declarar entrega real validada antes do teste no aparelho.

Notas para a loja: “Agora o Tâmo On permite receber notificações no iPhone mesmo com o aplicativo fechado. Esta atualização também melhora a apresentação do app e a organização da Administração.”
