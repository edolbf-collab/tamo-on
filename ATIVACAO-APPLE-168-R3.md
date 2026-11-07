# Ativação Apple e vinculação — 168-R3

Atualização: o titular confirmou o fluxo e o vínculo Apple em 4/11/2026 e autorizou avançar ao TestFlight. O primeiro build nativo **1.0.168 (168)** foi assinado e enviado à Apple em 4/11/2026, às 10:09 BRT. Consulte [o registro do TestFlight](docs/TESTFLIGHT-168.md) para o estado de processamento e distribuição. As pendências e a ausência de envio mencionadas abaixo registram a entrega original de ativação; o teste do pacote nativo no iPhone ainda depende de instalação e confirmação do titular.

Data: 4 de novembro de 2026. Escopo autorizado: concluir a preparação e ativar o acesso Apple e a vinculação com a conta existente do Tâmo On.

## Comportamento

- `appleEnabled` e `linkingEnabled` habilitados. Google permanece disponível.
- Web e iOS oferecem Continuar com Apple. No Android instalado, a opção fica em Outras formas de entrar, como definido na preparação.
- Para quem já usa Google: entrar por Google → Meu perfil → Formas de acesso → Vincular Apple. A operação usa a sessão autenticada e `linkIdentity`, verifica o UUID no retorno e mantém o e-mail principal e os dados existentes. Ocultar meu e-mail não cria um cadastro separado durante esse vínculo.
- Uma identidade que pertence a outro cadastro não é mesclada. A interface orienta acesso à conta original/suporte.
- Aviso complementar de autenticação publicado na página de privacidade, com data própria, preservando o texto-base v1.2 e os registros de aceite. Há link para o aviso antes do login e em Formas de acesso.
- Cache e arquivos de entrada atualizados para 168-R3. A versão nativa continua 1.0.168, ainda sem distribuição assinada.

## Servidor verificado

Apple Developer usa App ID `br.app.tamoon` e Services ID `br.app.tamoon.web`, agrupados. O endpoint público de configuração Supabase confirma Apple e Google habilitados. O início do OAuth retorna HTTP 302 para `appleid.apple.com/auth/authorize`, com Services ID correto, escopo `email name`, estado OAuth e retorno para `https://xvwgrpnioaqyijhzqxqh.supabase.co/auth/v1/callback`.

A vinculação manual e os retornos foram habilitados na etapa anterior. A função nativa `apple-sign-in` já está ativa. A tabela privada de concessões Apple tem RLS; usuários autenticados não têm acesso direto. Na conferência anterior à ativação, não havia identidades Apple nem concessões de usuários. Nenhuma conta real foi criada ou vinculada para os testes.

Esta entrega não modifica schema, lista do piloto, permissões, credenciais de usuários ou o backend de exclusão.

## Validação e limites

- 145 testes Node de autenticação, autorização e integração passaram na main; o pacote nativo adiciona seus testes de vinculação.
- O teste WebKit usa as flags reais desta entrega e o SDK fixado em 2.110.7. Abrange telas de 320/390 px, apresentação por plataforma, início PKCE Google/Apple, conflito e retorno de vínculo mantendo UUID e e-mail principal. O provedor e as contas são simulados.
- A compilação de simulador anterior (commit `eba63811698cbfa47d0ace6523997cbae6649dd4`, execução 41767152943) passou. O workflow desta atualização repetirá empacotamento, verificações e compilação sem assinatura.
- A confirmação com uma Conta Apple real, inclusive e-mail oculto, precisa ser feita pelo titular no iPhone. Não anunciar essa validação como concluída antes do retorno real.

## Próximas etapas de distribuição iOS

1. Validar o vínculo real no iPhone mantendo o UUID e o histórico; depois conferir o Marketplace com a mesma autorização do piloto.
2. Validar a entrega de e-mail pelo Private Email Relay com os remetentes realmente usados. A autenticação Apple não depende de e-mail enviado pelo Tâmo On.
3. Concluir o tratamento operacional da revogação Apple antes de submissão à App Store. O pedido de exclusão no app já abrange Comunidade e Marketplace e é revisado pela administração. O backend de exclusão anterior permanece em produção; o antigo incremento destrutivo não deve ser reintroduzido. O helper nativo de revogação não equivale a uma rotina de exclusão implantada. O OAuth web não captura uma concessão na tabela nativa; nesses casos permanece a orientação de revogação manual, sem impedir a exclusão da conta.
4. Gerar build assinado em Mac/serviço autorizado, alinhar a versão da ficha Apple a 1.0.168 e completar privacidade, classificação etária, criptografia, capturas e instruções de revisão.
5. Enviar ao TestFlight, testar em aparelho e só então submeter à revisão. Esta entrega não produz IPA, envio ao TestFlight nem publicação na App Store.

Segredo OAuth web deve ser renovado antes de 2/5/2027, 22h32 BRT. Nenhuma chave privada ou segredo OAuth faz parte desta entrega.

Referências: [Supabase identity linking](https://supabase.com/docs/guides/auth/auth-identity-linking), [Apple — gerenciamento de acesso](https://support.apple.com/pt-br/102571), [Apple — exclusão e revogação](https://developer.apple.com/documentation/technotes/tn3194-handling-account-deletions-and-revoking-tokens-for-sign-in-with-apple).
