# Login e vinculação Google/Apple — preparação 166-R18

O código web/Android está na `main`. A preparação nativa foi atualizada em `ios-build-165`, sobre a preparação iOS já existente, sem substituir a base integrada 166. `auth-config.js`, `auth-access.js` e `auth-access.css` são idênticos nas duas branches. Ao preparar o próximo iOS com a build integrada mais recente, preservar o adaptador `mobile/src/native.js`, o plugin Swift e as funcionalidades nativas anteriores. Não distribuir a antiga interface 165 como se fosse a última build 166.

## Estado desta entrega

- `appleEnabled: false` e `linkingEnabled: false`. Login Google continua disponível; Apple não aparece na entrada pública enquanto não estiver configurada. Em Meu perfil → Formas de acesso, Google aparece vinculado e Apple disponível em breve.
- Quando habilitada: web (inclusive navegador Android) e iOS mostram Google e Apple. Android instalado/TWA agrupa Apple em **Outras formas de entrar**. A identificação de plataforma só controla apresentação; não concede acesso.
- Vinculação só parte de uma sessão autenticada, usando `linkIdentity`. A identidade interna permanece a mesma. O fluxo não altera e-mail principal, perfis, permissões, reservas, vouchers ou pagamentos.
- A tentativa local guarda apenas provedor, UUID de origem e horário, por até 20 minutos; nunca guarda tokens do provedor. O retorno é conferido com `getUser` no servidor. Conta diferente encerra a sessão local e não é anunciada como vinculação bem-sucedida.
- Identidade já vinculada a outro usuário mostra orientação para entrar na conta original/suporte. Não há fusão administrativa automática nem desvinculação nesta entrega.
- O SDK web está fixado em 2.110.7, igual ao pacote nativo existente. OAuth usa PKCE; iOS mantém sessão no Keychain.
- Nenhuma conta, sessão ou credencial Apple real foi criada para os testes. Não foram alterados documentos legais, permissões RLS, schema, configuração Auth ou a lista de três contas do Marketplace.

## Ativação depois da liberação Apple

1. Confirmar Apple Developer Program ativo e Team ID. Manter o Bundle ID `br.app.tamoon`, habilitar Sign in with Apple e configurar assinatura no Xcode.
2. Criar **Services ID** para web/Android, associado ao **mesmo App ID primário** do iOS. Esse agrupamento deve ser validado para que a identidade Apple seja reconhecida entre web e aplicativo nativo. Não configurar os dois como aplicações Apple independentes.
3. Configurar domínio e retorno OAuth Apple conforme a documentação: `https://xvwgrpnioaqyijhzqxqh.supabase.co/auth/v1/callback`. Registrar as origens de envio de e-mail para funcionar com o relay Apple. A chave `.p8` fica somente nos serviços autorizados, nunca no frontend, Git ou pacote iOS.
4. No Auth do projeto **Comunidade**, configurar Apple com Services ID e Bundle ID permitidos; gerar o segredo web e controlar sua renovação (máximo de seis meses). Preservar Google, URLs e demais configurações existentes.
5. Habilitar manual identity linking no Auth. Conferir os retornos web exatos já usados (`https://app.tamoon.app.br/` e, enquanto suportado, o domínio legado) e `br.app.tamoon://auth/callback` para iOS. Não usar curingas amplos.
6. Para o iOS, cumprir a preparação anterior da branch: secrets Apple, migração incremental de grants/exclusão e publicação das funções Apple/exclusão. A nova `apple-sign-in` recebe `action: 'login'` ou `'link'`. No vínculo, verifica bearer e UUID antes de gravar a credencial cifrada. A ação de login preserva o acesso de usuários novos. Não aplicar schema consolidado, reset ou repair.
7. Confirmar política de privacidade e fluxo de exclusão/revogação Apple antes da ativação pública. O pacote nativo anterior já contém esse fluxo; ele continua pendente de ativação/validação real e não foi transplantado para a produção web nesta entrega. Validar também contas Apple criadas pela web, cuja credencial de revogação não é capturada pelo endpoint nativo.
8. Em ambiente de validação, ativar as duas opções de `auth-config.js`, testar os cenários abaixo e só então publicar as flags na produção. Atualizar o cache/versionamento na mesma entrega. O backend precisa estar pronto antes do frontend.

## Validação necessária com Apple real

- Google existente → vincular Apple com e-mail compartilhado e com **Ocultar meu e-mail**; conferir mesmo UUID, grupos, reservas e permissões.
- Apple nova → vincular Google; depois entrar pelos dois botões em web, Android e iOS. Conta Apple nova funciona sem exigir Google.
- Conta já vinculada, dois cadastros existentes, cancelamento no provedor, sessão expirada, troca de conta em outra aba e retorno após suspensão do aparelho.
- TWA instalado: alternativa inicialmente recolhida; navegador Android: ambas as opções visíveis. iPhone/iPad: duas opções visíveis. Formas de acesso disponível em todas as plataformas, inclusive sem grupo.
- Marketplace: mesmo UUID e perfil; autorização do piloto continua obrigatória. Não substituir o e-mail principal pelo relay nem aprovar outro cadastro só porque há coincidência de nome/telefone/CPF.
- Conta bloqueada continua bloqueada; mudança de login não contorna autorização ou aceite legal.
- Validar o tratamento do nome na primeira conta Apple web (Apple pode não fornecer nome): completar em Meu perfil. Nome é dado de apresentação, nunca prova de identidade.
- Testar exclusão/revogação, recuperação, privacidade e retorno de e-mail pelo relay. Compilar Swift/assinar e validar no iPhone/TestFlight; a preparação não equivale a um IPA testado ou aprovação na loja.

## Testes reproduzíveis

```sh
node --test integration/auth/tests/*.test.mjs
node --test integration/marketplace/tests/*.test.mjs integration/community/tests/*.test.mjs
# Forneça o SDK 2.110.7 baixado da URL fixada em app.js:
AUTH_TEST_SDK=/caminho/supabase.min.js node integration/auth/tests/browser.cjs
# Na branch ios-build-165:
npm ci --prefix mobile
npm run test:auth --prefix mobile
npm run build --prefix mobile
npm run check --prefix mobile
```

Os testes de interface usam WebKit e respostas simuladas de Auth. Cobrem apresentação em 320/390 px, PKCE Google, conflito de identidade e retorno Apple mantendo UUID. Não substituem a autenticação real nos provedores.

Referências: [Supabase — identity linking](https://supabase.com/docs/guides/auth/auth-identity-linking), [Supabase — Apple](https://supabase.com/docs/guides/auth/social-login/auth-apple), [Apple — login services](https://developer.apple.com/app-store/review/guidelines/#login-services).
