> Atualização de autenticação 166-R18 (30/10/2026): esta branch conserva a preparação nativa 165 e recebeu o mesmo módulo de login/vinculação da base integrada. Apple e vinculação permanecem desativadas até a configuração real. Para web/Android, agora é necessário Services ID associado ao App ID nativo. Consulte `PREPARACAO-LOGIN-APPLE-R18.md`; ela atualiza as instruções de login abaixo. As demais pendências da preparação iOS continuam aplicáveis.

# Tâmo On — preparação para iPhone / Build 165

Preparado em 27/10/2026 sobre o commit `704a625b1e297599b64dee61c6c544099a700a52` do repositório `edolbf-collab/tamo-on`.

**Este é um pacote de preparação, sem IPA assinado.** O aplicativo Android build 164 continua em revisão no Google. Nenhuma mudança deste pacote foi implantada no banco, nas Edge Functions ou no site em produção.

## O que foi preparado

| Parte | Entrega |
|---|---|
| iPhone | Projeto Xcode em `mobile/ios/App/App.xcodeproj`, Capacitor 8.5.3, iOS 15+, foco inicial em iPhone |
| Identificação | `br.app.tamoon`, versão `1.0.165`, build `165`; Team de assinatura ainda não definido |
| Arquivos do app | HTML, estilos, scripts e SDK Supabase incluídos no pacote local; sem depender de carregar o site para executar a interface |
| Apple | Botão, autorização nativa, nonce e state, troca de código no servidor, credencial cifrada e revogação na exclusão |
| Google | Sessão de autenticação do iOS, retorno por URL própria e PKCE; o fluxo web existente permanece |
| Sessão | Armazenamento nativo no Keychain; acompanhamento de revogação da credencial Apple |
| Recursos nativos | Compartilhamento de convites, cópia e exportação de JSON para a folha de compartilhamento do iOS |
| Exclusão | Pedido autenticado no app, confirmação, prazo de 30 dias, fila administrativa e protocolo de acompanhamento sem login |
| Documentos e aparência | Ícone 1024 × 1024 com fundo branco; manifesto de privacidade inicial; documentos 1.2 preservados |

O botão de exclusão também aparece para pessoas sem grupo, bloqueadas ou ainda na tela de aceite. O servidor identifica o titular pela sessão; o cliente não escolhe qual conta será excluída. A conclusão continua sob responsabilidade da equipe, pelo fluxo administrativo existente, agora com revogação Apple e remoção de comunicados de autoria do usuário.

## O que ainda impede enviar uma versão final

1. Confirmar associação ativa no **Apple Developer Program** e obter o **Team ID**. Ter apenas um Apple ID ou acesso ao cadastro não confirma a associação.
2. Configurar os identificadores e a chave de Sign in with Apple; habilitar o provedor no Supabase.
3. Compilar o código Swift e testar em iPhone usando **Mac com Xcode 26 ou superior**. Esta etapa não foi executada neste ambiente.
4. Revisar e ativar uma nova versão da política de privacidade que descreva Apple e o novo fluxo de exclusão. O material para essa revisão está em `docs/IOS-PRIVACIDADE-E-REVISAO-165.md`.
5. Implementar/configurar **APNs** e testar notificações nativas se elas fizerem parte da primeira versão. O Web Push atual não passa a funcionar automaticamente dentro do aplicativo iOS. Nesta preparação, os avisos continuam na central do app e a tela informa que push com o app fechado ainda não está disponível.
6. Validar em aparelho login, conta com e-mail oculto, retorno Google, exclusão completa, entrada em grupos, presença, sorteio, caixa, moderação, exportação e funcionamento ao sair/voltar do app.

O pacote não declara que a Apple aprovará o aplicativo. O projeto deve ser validado primeiro em TestFlight, com todas as funcionalidades anunciadas funcionando.

## Primeiro passo no portal Apple

1. Em [Apple Developer — Membership](https://developer.apple.com/account/), confira se a associação está ativa e anote o Team ID.
2. Em **Certificates, Identifiers & Profiles → Identifiers**, cadastre ou selecione um App ID explícito com Bundle ID `br.app.tamoon` e habilite **Sign in with Apple**.
3. Em **Keys**, crie uma chave com Sign in with Apple vinculada a esse App ID. Guarde o `.p8`, o Key ID e o Team ID em local privado. O `.p8` é disponibilizado uma vez; não o coloque no repositório, ZIP público ou pasta do Cloudflare.
4. No App Store Connect, crie o registro iOS do Tâmo On usando esse Bundle ID. Idioma inicial: Português (Brasil). A versão pode começar pelo TestFlight.

Este fluxo usa autenticação Apple nativa. Não é necessário criar Services ID de OAuth web para este pacote. Se o login Apple for oferecido futuramente no navegador/Android, será outra configuração, incluindo a gestão do segredo OAuth web.

## Supabase — configuração após a preparação

Projeto Comunidade: `xvwgrpnioaqyijhzqxqh`. Não usar o projeto do marketplace.

1. Em **Authentication → Providers → Apple**, habilite o provedor e inclua `br.app.tamoon` em Client IDs, conforme a configuração nativa documentada pelo Supabase.
2. Em **Authentication → URL Configuration → Redirect URLs**, acrescente exatamente `br.app.tamoon://auth/callback`. Preserve os endereços web existentes. Essa URL é o retorno do Google no iOS, protegido por PKCE.
3. Configure estes secrets nas Edge Functions:

| Secret | Valor |
|---|---|
| `APPLE_TEAM_ID` | Team ID da associação Apple |
| `APPLE_KEY_ID` | ID da chave Sign in with Apple |
| `APPLE_CLIENT_ID` | `br.app.tamoon` |
| `APPLE_PRIVATE_KEY` | Conteúdo PEM completo do arquivo `.p8` |
| `APPLE_TOKEN_ENCRYPTION_KEY` | 32 bytes aleatórios em Base64; pode ser gerado com `openssl rand -base64 32` |

As chaves de serviço do Supabase são lidas do ambiente das funções e nunca do cliente. Guarde backup privado da chave de cifragem: trocá-la sem recifrar os registros existentes impede recuperar as credenciais Apple.

4. Aplique **somente** `supabase/migrations/20261027200626_ios_account_deletion_build_165.sql` no ambiente a validar. O arquivo é incremental e foi testado para reaplicação. Não execute o schema consolidado nem reset/repair/migration de versões antigas.
5. Publique as funções `apple-sign-in` e `delete-beta-user`, incluindo `supabase/functions/_shared/apple.ts`. A função de avisos não mudou. As configurações `verify_jwt=false` estão em `supabase/config.toml`: o login valida o código Apple e a exclusão administrativa mantém sua verificação de usuário/permissão no código.
6. Publique a página `legal/protocolo-exclusao.html` e `legal/receipt.js` junto com os arquivos web 165 somente depois de validar o conjunto. O protocolo é aleatório, permite apenas consultar datas/status e deve ser guardado como um link privado.

Não execute `supabase db push` às cegas: o repositório histórico contém arquivos de várias versões. Aplique o incremento indicado à instância correta e confira o resultado antes do cliente novo.

## Abrir e compilar no Mac

Instale Node.js 22+ e Xcode 26+, abra o Xcode uma vez e instale a plataforma iOS. No Terminal, dentro da pasta `mobile`:

```bash
npm ci
npm run sync
npm run check
npm run open
```

No Xcode, selecione o target **App → Signing & Capabilities**, marque assinatura automática e selecione a equipe correta. O entitlement Sign in with Apple já está no projeto. Confira `br.app.tamoon`, versão `1.0.165` e build `165`.

Conecte um iPhone e execute o aplicativo. Depois dos testes, selecione um destino iOS genérico, use **Product → Archive → Distribute App → App Store Connect**. Não foi gerado IPA nem feito envio nesta preparação.

O workflow `.github/workflows/ios-preparation.yml` permite executar manualmente uma compilação de simulador no GitHub Actions quando o pacote estiver em uma branch. Ele não assina, não publica e ainda não foi executado. O runner precisa ter Xcode 26+.

## Operar os pedidos de exclusão

O usuário abre **Mais → Excluir minha conta**, lê as consequências, confirma e recebe um protocolo. Repetir o envio devolve o mesmo pedido, sem alterar a data original nem prolongar o prazo.

Um administrador da plataforma abre **Mais → Pedidos de exclusão**, confere o pedido e conclui a exclusão permanente. Consultar essa fila diariamente é responsabilidade operacional; este pacote não agenda nem envia lembretes. O protocolo confirma a conclusão após a remoção do usuário no Auth. Dados mínimos com retenção justificada continuam sujeitos à política vigente.

O fluxo existente protege contas de administradores da própria plataforma contra exclusão pela ferramenta. Se uma dessas contas pedir exclusão, transfira a responsabilidade para outro operador, remova o privilégio administrativo da conta solicitante e processe o pedido por outra conta autorizada. Isso não deve impedir o atendimento do titular dentro do prazo.

Se houver uma credencial Apple, a função a revoga antes de concluir. Uma falha temporária da Apple exige nova tentativa. Se a credencial estiver ausente, a conta ainda é excluída e o protocolo explica como remover o vínculo remanescente nos ajustes Apple. Não exigir que o usuário envie e-mail para confirmar o pedido iniciado no app.

Use somente contas fictícias em testes destrutivos. Não teste exclusão com sua conta administrativa ou com participantes reais.

## Validações realizadas

- 28 verificações locais de banco: confirmação, idempotência, prazo, isolamento entre usuários, bloqueio de acesso direto às tabelas, conta/sessão inválida, exceção limitada do bloqueio jurídico, conclusão e limpeza de dados.
- 20 verificações de navegador: pedido/erro/reenvio/protocolo, acesso por conta bloqueada, Google web preservado, presença do botão Apple no cliente nativo simulado, callback Google e PKCE.
- 6 testes de credenciais Apple com provedor simulado: cifragem autenticada, segredo assinado de cinco minutos, revogação, falha do provedor, ausência de credencial e adulteração do conteúdo cifrado.
- JavaScript e tipos das Edge Functions verificados; pacote local do iOS gerado e sincronizado; versão, referências Xcode, entitlement, manifesto e ausência de secrets no cliente conferidos.

Não realizados: compilação Swift/Xcode, assinatura, instalação iPhone, login real Apple, revogação real Apple, push APNs, envio TestFlight e revisão App Store. Os testes locais não substituem essas verificações.

Os testes estão em `tests/ios-preparation`. Para verificar as funções localmente, execute `npm ci` em `supabase/functions` e use Deno 2.9.6 com `--node-modules-dir=manual`. As dependências estão fixadas em `package-lock.json`; a resolução do deploy deve ser conferida no Supabase antes da liberação.

## Referências oficiais consultadas

- [Exclusão da conta na App Store](https://developer.apple.com/help/app-review/guideline-reference/5-1-1-account-deletion/)
- [Diretrizes de revisão — login e funcionalidade](https://developer.apple.com/app-store/review/guidelines/)
- [Sign in with Apple no Supabase](https://supabase.com/docs/guides/auth/social-login/auth-apple)
- [Ambiente de desenvolvimento Capacitor](https://capacitorjs.com/docs/getting-started/environment-setup)
- [TestFlight](https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview/)
