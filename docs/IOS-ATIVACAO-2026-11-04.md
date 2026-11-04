# Ativação Apple e preparação iOS — 3/11/2026 (BRT)

## Confirmado na Apple

- Organização TAMO ON TECNOLOGIA E INTERMEDIACAO LTDA ativa; renovação em 4/11/2027; Team ID `4T892ZTN46`.
- App ID explícito `br.app.tamoon`, descrição `Tamo On`, registrado com Sign in with Apple como primário.
- Services ID `br.app.tamoon.web`, descrição `Tamo On Web`, associado ao mesmo App ID. Domínios `app.tamoon.app.br` e `xvwgrpnioaqyijhzqxqh.supabase.co`; retorno `https://xvwgrpnioaqyijhzqxqh.supabase.co/auth/v1/callback`.
- Chave Sign in with Apple criada após autorização expressa, restrita ao App ID do Tâmo On e ao Services ID associado. Armazenada no Supabase; cópias temporárias e área de transferência removidas. Nenhum certificado de distribuição ou perfil foi criado.
- [App criado na App Store Connect](https://appstoreconnect.apple.com/apps/6830420681/distribution/info): ID Apple `6830420681`, iOS, Tâmo On, Português (Brasil), Bundle ID `br.app.tamoon`, SKU `tamoon-ios`. Nome público de desenvolvedor autorizado: `TAMO ON TECNOLOGIA E INTERMEDIACAO LTDA`.
- Ficha alinhada à versão `1.0.167`, categoria Esportes, copyright 2026 e lançamento manual. Estado: Preparar para envio. Nenhum build foi enviado à Apple.

## Código preparado

A branch histórica `ios-build-165` foi atualizada com a main `094d2f16c40272c88cd0b1cc49112d0b8ea23a3b` (build 167), preservando o histórico iOS `b54161489fc7cd8387602e6d14a220e3ae58d1c2`. O nome da branch não representa a versão atual do binário.

- Versão nativa `1.0.167`, build `167`, assinatura automática vinculada ao Team ID correto.
- Preservados Keychain, login nativo, retorno Google por PKCE, revogação Apple, compartilhamento, exclusão dentro do app e perfil sem grupo.
- Pacote local inclui o Marketplace atual, sua navegação de restituições e o bundle versionado existente. Scripts e estilos são locais; os dois projetos Supabase têm origens explícitas na política de conteúdo.
- A entrada nativa do Marketplace usa o SDK empacotado e a sessão da Comunidade no Keychain. A sessão do Marketplace continua temporária e sujeita à lista privada de autorização.
- Origem `capacitor://localhost` implantada nas duas funções de ponte. A comparação com o código remoto confirmou que essa era a única diferença. Origens arbitrárias de localhost continuam rejeitadas.
- Workflow de simulador dispara ao atualizar esta branch e também manualmente, com acesso somente de leitura e limite de 25 minutos. Não assina nem envia à Apple.
- Flags públicas de interface para Apple e vinculação continuam desativadas. A main e a Play Store não foram alteradas. As alterações de servidor estão registradas abaixo.

## Validação

`npm ci --prefix mobile`, `npm run sync --prefix mobile` e `npm run check --prefix mobile` concluídos. São verificados versão, Team ID, recursos locais e separação de segredos do servidor.

153 testes automatizados de autorização, integração e vinculação e 20 verificações de interface passaram, incluindo a entrada nativa do Marketplace. Os testes usam contas simuladas e não substituem login Apple real, assinatura, testes em iPhone ou revisão Apple.

A [execução 41752518492](https://github.com/edolbf-collab/tamo-on/actions/runs/41752518492), sobre o commit `e62dae42aeb86a2e59563426f388178786a047d0`, passou em todas as etapas: Xcode **26.6**, 153 testes (6 de autenticação nativa + 147 de integração), empacotamento e compilação Swift para simulador, concluída com `BUILD SUCCEEDED`. É uma compilação sem assinatura; não foi gerado IPA de distribuição nem enviado build ao TestFlight.

## Configuração de servidor concluída

- Projeto Comunidade `xvwgrpnioaqyijhzqxqh`: provedor Apple habilitado, IDs na ordem `br.app.tamoon.web,br.app.tamoon`, segredo OAuth salvo, vinculação manual habilitada. Google preservado; acesso anônimo desativado e confirmação de e-mail mantida.
- URL padrão de autenticação atualizada para `https://app.tamoon.app.br/`; retorno exato `br.app.tamoon://auth/callback` adicionado. Os quatro retornos anteriores foram preservados.
- Segredos `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_CLIENT_ID`, `APPLE_PRIVATE_KEY` e `APPLE_TOKEN_ENCRYPTION_KEY` salvos no servidor. Os hashes exibidos pelo painel coincidiram com os valores preparados. Nenhum segredo foi incluído no repositório, frontend ou IPA.
- Segredo OAuth web válido até **2/5/2027, 22h32 BRT**. Renovar antes dessa data. A chave de assinatura `.p8` não tem essa expiração; o servidor nativo gera segredos assinados com validade de cinco minutos. Não foi criado lembrete automático nesta etapa.
- Migração `20261104014342_apple_auth_grants_activation`: somente a tabela `apple_auth_grants` da preparação anterior, com tokens cifrados, RLS e acesso exclusivo do serviço. Arquivo criado pelo CLI e alinhado à versão efetivamente aplicada. Verificado: `anon` e `authenticated` sem leitura/inserção; serviço com acesso; zero credenciais de usuários armazenadas durante a preparação.
- Função `apple-sign-in` versão 1 publicada. A autenticação é feita pela própria função com o código Apple e o nonce; a vinculação exige sessão Supabase válida e preserva o UUID. O portão JWT do gateway não é usado neste endpoint de entrada.
- Ponte Comunidade `marketplace-group-pilot` versão 4 e ponte Marketplace `community-marketplace-session` versão 5 publicadas, mantendo as autorizações e a lista privada do piloto.
- **12 verificações HTTP aprovadas**: quatro na função Apple (preflight, método, pedido inválido e vínculo sem sessão) e quatro em cada ponte (origem nativa, origem web, origem externa e falta de sessão).
- **6 testes Deno de cifragem/revogação aprovados** com credenciais fictícias: AES-GCM, assinatura e validade do segredo, falha do provedor, ausência de concessão, conta Google, idempotência e adulteração do token. O workflow passou a executar essa suíte junto aos 153 testes anteriores.
- Advisors: nenhuma nova advertência de segurança. A nova tabela tem aviso informativo de RLS sem políticas, intencional porque é exclusiva do serviço. As advertências preexistentes ficaram registradas para revisão separada; não foram alteradas permissões de outras funções.
- A checagem HTTP extra do início do OAuth web não concluiu por timeout de conexão neste ambiente. A configuração foi confirmada no painel; login Apple real, e-mail oculto e retorno completo ainda dependem da validação em aparelho.

## Ordem até TestFlight

1. **Exclusão de contas:** reconciliar o incremento de 27/10 com os dados e obrigações atuais do Marketplace antes de aplicá-lo. `account_deletion_requests` e a nova versão de `delete-beta-user` continuam pendentes; a migração antiga completa não foi implantada.
2. **Privacidade e e-mail oculto:** revisar a minuta para Apple, revogação/exclusão e Marketplace, definir versão/vigência e configurar as fontes de e-mail no Private Email Relay conforme os remetentes efetivamente usados.
3. **Assinatura:** gerar a distribuição para aparelho em Mac autorizado ou serviço de build autorizado. A compilação de simulador já passou; ainda não há IPA assinado nem build no TestFlight.
4. **Ficha Apple:** completar App Privacy, classificação etária, criptografia, descrição, instruções de revisão, acesso de demonstração e capturas reais. Conferir a distribuição inicial no Brasil antes de qualquer declaração territorial.
5. **Teste real:** Apple com e-mail oculto, vínculo Google/Apple mantendo UUID, exclusão/revogação, lista privada, bloqueios, papéis, Pix simulado, volta à Comunidade, perda de sessão, grupos, presença, caixa, convites, reservas e vouchers.
6. **Liberação:** ativar os botões Apple apenas após validar o fluxo completo e a privacidade. TestFlight primeiro; revisão e publicação na App Store depois.

APNs segue fora da implementação atual. Os avisos são consultáveis no app; não anunciar push em segundo plano antes de implementar e testar.

## Referências oficiais

- [App ID](https://developer.apple.com/help/account/identifiers/register-an-app-id/)
- [Login Apple web](https://developer.apple.com/help/account/capabilities/configure-sign-in-with-apple-for-the-web/)
- [Nome de desenvolvedor](https://developer.apple.com/help/app-store-connect/create-an-app-record/set-your-developer-name/)
- [Novo app](https://developer.apple.com/help/app-store-connect/create-an-app-record/add-a-new-app/)
- [Upload de builds](https://developer.apple.com/help/app-store-connect/manage-builds/upload-builds/)
- [Supabase Apple](https://supabase.com/docs/guides/auth/social-sign-in/auth-apple)

O changelog Supabase de 12/10 anuncia retirada de cifras TLS antigas a partir de 10/11/2026. Manter TLS moderno e incluir conectividade no teste real do iPhone, sem relaxar validação TLS.
