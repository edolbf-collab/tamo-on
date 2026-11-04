# Ativação Apple e preparação iOS — 4/11/2026

## Confirmado na Apple

- Organização TAMO ON TECNOLOGIA E INTERMEDIACAO LTDA ativa; renovação em 4/11/2027; Team ID `4T892ZTN46`.
- App ID explícito `br.app.tamoon`, descrição `Tamo On`, registrado com Sign in with Apple como primário.
- Services ID `br.app.tamoon.web`, descrição `Tamo On Web`, associado ao mesmo App ID. Domínios `app.tamoon.app.br` e `xvwgrpnioaqyijhzqxqh.supabase.co`; retorno `https://xvwgrpnioaqyijhzqxqh.supabase.co/auth/v1/callback`.
- Nenhuma chave privada Apple, certificado de distribuição ou perfil foi criado.
- App Store Connect acessível e sem apps. Formulário inicial preparado: iOS, Tâmo On, Português (Brasil), Bundle ID `br.app.tamoon`, SKU `tamoon-ios`. A criação aguarda escolha do nome público de desenvolvedor.

## Código preparado

A branch histórica `ios-build-165` foi atualizada com a main `094d2f16c40272c88cd0b1cc49112d0b8ea23a3b` (build 167), preservando o histórico iOS `b54161489fc7cd8387602e6d14a220e3ae58d1c2`. O nome da branch não representa a versão atual do binário.

- Versão nativa `1.0.167`, build `167`, assinatura automática vinculada ao Team ID correto.
- Preservados Keychain, login nativo, retorno Google por PKCE, revogação Apple, compartilhamento, exclusão dentro do app e perfil sem grupo.
- Pacote local inclui o Marketplace atual, sua navegação de restituições e o bundle versionado existente. Scripts e estilos são locais; os dois projetos Supabase têm origens explícitas na política de conteúdo.
- A entrada nativa do Marketplace usa o SDK empacotado e a sessão da Comunidade no Keychain. A sessão do Marketplace continua temporária e sujeita à lista privada de autorização.
- Origem `capacitor://localhost` preparada nas duas funções de ponte. Origens arbitrárias de localhost continuam rejeitadas. Alterações de servidor ainda não implantadas.
- Workflow de simulador dispara ao atualizar esta branch e também manualmente, com acesso somente de leitura e limite de 25 minutos. Não assina nem envia à Apple.
- Flags Apple e vinculação desativadas. Nenhuma alteração desta preparação foi enviada à main, à Play Store ou ao banco em produção.

## Validação

`npm ci --prefix mobile`, `npm run sync --prefix mobile` e `npm run check --prefix mobile` concluídos. São verificados versão, Team ID, recursos locais e separação de segredos do servidor.

153 testes automatizados de autorização, integração e vinculação e 20 verificações de interface passaram, incluindo a entrada nativa do Marketplace. Os testes usam contas simuladas e não substituem login Apple real, assinatura, testes em iPhone ou revisão Apple.

A [execução 41752518492](https://github.com/edolbf-collab/tamo-on/actions/runs/41752518492), sobre o commit `e62dae42aeb86a2e59563426f388178786a047d0`, passou em todas as etapas: Xcode **26.6**, 153 testes (6 de autenticação nativa + 147 de integração), empacotamento e compilação Swift para simulador, concluída com `BUILD SUCCEEDED`. É uma compilação sem assinatura; não foi gerado IPA de distribuição nem enviado build ao TestFlight.

## Ordem até TestFlight

1. **Nome público do desenvolvedor:** a Apple permite defini-lo no primeiro app e informa que não poderá ser editado depois. Um nome comercial alternativo precisa ser registrado; a razão social já está validada.
2. **Chave Sign in with Apple:** gerar para `br.app.tamoon`, após autorização específica para criar a credencial persistente. Manter o `.p8` privado, somente nos serviços necessários, nunca no Git, frontend ou IPA.
3. **Auth da Comunidade:** Services ID primeiro e Bundle ID adicional; segredo OAuth, manual identity linking e retorno `br.app.tamoon://auth/callback`. Preservar Google e os retornos existentes. O conector disponível não expõe edição de Auth/secrets; requer painel autorizado ou outro canal seguro.
4. **Servidor Apple e exclusão:** consulta ao projeto Comunidade confirmou que `apple_auth_grants` não existe e `apple-sign-in` não foi publicada. Reconciliar o incremento de exclusão de 27/10 com os dados e obrigações do piloto Marketplace antes de aplicá-lo. A preparação antiga antecede esse piloto e não deve ser implantada sem revisão.
5. **Ponte nativa:** validar e publicar as funções preparadas. Testar lista privada, bloqueios, papéis, Pix simulado, volta à Comunidade e perda de sessão em aparelho.
6. **Privacidade:** atualizar a minuta para Apple, e-mail privado, revogação/exclusão e dados do Marketplace. Definir/revisar a nova versão e vigência antes de ativar as flags, sem reescrever silenciosamente documentos já aceitos.
7. **Compilação e assinatura:** Xcode 26+ em Mac autorizado na equipe, ou integração Apple de build autorizada. Linux empacota os arquivos, mas não gera IPA. Executar testes em iPhone.
8. **Ficha Apple:** App Privacy, classificação etária, criptografia, instruções de revisão, acesso de demonstração sem credenciais pessoais e capturas reais. Definir distribuição geográfica antes das declarações territoriais, como status de comerciante na UE.
9. **TestFlight primeiro:** validar Apple com e-mail oculto, vínculo Google/Apple mantendo UUID, exclusão/revogação, grupos, presença, caixa, convites, reservas e vouchers. Revisão/publicação App Store vem após essa validação.

APNs segue fora da implementação atual. Os avisos são consultáveis no app; não anunciar push em segundo plano antes de implementar e testar.

## Referências oficiais

- [App ID](https://developer.apple.com/help/account/identifiers/register-an-app-id/)
- [Login Apple web](https://developer.apple.com/help/account/capabilities/configure-sign-in-with-apple-for-the-web/)
- [Nome de desenvolvedor](https://developer.apple.com/help/app-store-connect/create-an-app-record/set-your-developer-name/)
- [Novo app](https://developer.apple.com/help/app-store-connect/create-an-app-record/add-a-new-app/)
- [Upload de builds](https://developer.apple.com/help/app-store-connect/manage-builds/upload-builds/)
- [Supabase Apple](https://supabase.com/docs/guides/auth/social-sign-in/auth-apple)

O changelog Supabase de 12/10 anuncia retirada de cifras TLS antigas a partir de 10/11/2026. Manter TLS moderno e incluir conectividade no teste real do iPhone, sem relaxar validação TLS.
