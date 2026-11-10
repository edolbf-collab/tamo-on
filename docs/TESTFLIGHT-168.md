# Primeiro TestFlight — Tâmo On 1.0.168

Estado em 4/11/2026. O titular confirmou o fluxo e a vinculação Apple no aplicativo publicado e autorizou avançar ao TestFlight. Isso confirma a experiência web/PWA usada até aqui; o primeiro pacote nativo assinado ainda será validado no iPhone.

## Preparação concluída

- App Store Connect: aplicativo `6830420681`, bundle `br.app.tamoon`, equipe `4T892ZTN46`.
- Grupo interno **Piloto interno**, distribuição manual, criado sem adicionar testers nem enviar convites. Inicialmente zero builds e zero testers.
- Informações de teste: suporte, site, privacidade e notas sobre login Google/Apple, Marketplace restrito/sandbox e exclusão unificada salvos.
- Scheme Xcode compartilhado, arquivo de exportação para TestFlight interno e verificação do archive de iPhone adicionados.
- O workflow de preparação também compila um archive Release/arm64 sem credenciais. O simulador não substitui essa validação nem um teste no aparelho.
- Workflow de envio exclusivamente manual. Exige o SHA completo de um commit da branch iOS e um número de build válido. Sem selecionar `upload`, apenas verifica o archive. Não publica artefatos nem credenciais no repositório público.

## Credenciais e proteções configuradas

O titular autorizou o aceite dos termos da API e a solicitação da organização. A Apple aprovou o acesso imediatamente em 4/11/2026. Em autorização separada, o titular aprovou gerar a chave de equipe **Tamo On TestFlight**, com função Administrador, e armazená-la no GitHub para assinatura e envio. Chaves de equipe abrangem todos os apps da conta, conforme sua função; essa credencial não é restrita a um único aplicativo.

O ambiente GitHub `testflight` está criado, permite apenas a branch `main`, exige aprovação de `edolbf-collab` e não permite ignorar suas proteções. `ASC_KEY_ID`, `ASC_ISSUER_ID` e `ASC_PRIVATE_KEY` foram cadastrados somente como segredos desse ambiente. A cópia temporária da chave baixada foi removida após o armazenamento. A chave de Sign in with Apple é diferente e não foi reaproveitada.

## Assinatura e envio

O fluxo usa o Mac do GitHub Actions já empregado nas validações. O archive recebe assinatura local ad hoc (`CODE_SIGN_IDENTITY=-`, `AD_HOC_CODE_SIGNING_ALLOWED=YES`), preservando os entitlements sem exigir um iPhone registrado para um perfil de desenvolvimento. Antes da exportação, o fluxo confere a presença de `com.apple.developer.applesignin = [Default]`. A exportação usa assinatura automática de distribuição gerenciada pela Apple e a chave de API autorizada.

O executor usa um Keychain temporário e apaga o arquivo da chave ao terminar. Não usar segredos de repositório para contornar a revisão do ambiente. Se a Apple recusar a função selecionada, revisar o acesso; não elevar a função automaticamente nem revogar certificados existentes para tentar corrigir.

## Primeiro envio

O upload de **1.0.168 (168)** foi concluído em **4/11/2026 às 13:09 UTC (10:09 BRT)**. A [execução de envio](https://github.com/edolbf-collab/tamo-on/actions/runs/41834822087) terminou com sucesso, incluindo archive Release/arm64, testes de autenticação e integração, conferência dos recursos e do entitlement Apple Sign In, exportação e upload. Código do app: `60989efb69820d8f1edb9052d45b4833d3d3678e`; workflow utilizado: `c5e59d5603cb73858c9cc3b23c30bcdd736e425e`.

A Apple concluiu o processamento e exibiu o build como **Pronto para testar**. O build foi associado ao grupo **Piloto interno**. Nenhum tester foi convidado; a inclusão do destinatário está pendente de autorização explícita do titular. A instalação no iPhone ainda não foi validada.

Para um novo envio, no workflow **Preparar ou enviar iOS ao TestFlight**, executar a versão da `main`, informar um SHA revisado já integrado à `main`, um número de build Apple ainda não utilizado e `upload=true`. Desde a consolidação de branches em 10/11/2026, não há dependência da antiga `ios-build-165`. O build 168 já foi enviado e não deve ser reutilizado. O fluxo instala as dependências fixadas, recompõe os recursos locais, executa os testes, arquiva para iPhone e pede ao Xcode que assine e envie à Apple.

O arquivo de exportação define `testFlightInternalTestingOnly=true`; esse primeiro build não poderá ser usado para revisão externa nem publicação na App Store. Uma distribuição externa posterior exigirá outro build e a preparação específica de revisão.

Só anunciar instalação disponível depois que a Apple processar o build, ele aparecer no TestFlight e for adicionado ao grupo. Convites a terceiros exigem identificação dos testers e instrução de envio. A ficha de distribuição da App Store ainda precisa ser alinhada da versão 1.0.167 para 1.0.168 antes de uma submissão à loja; isso não impede o upload beta com a versão correta no binário.

## Verificação no iPhone nativo

Conferir login Apple, Google, retorno após suspensão, vínculo na mesma conta, entrada/volta do Marketplace, bloqueios e lista do piloto, abertura do checkout de teste, compartilhamento, notificações no app e pedido de exclusão com protocolo. A análise operacional de revogação Apple e tratamento do Marketplace permanece necessária antes da revisão externa; não instalar o incremento destrutivo antigo de exclusão.

Referências: [Upload de builds](https://developer.apple.com/help/app-store-connect/manage-builds/upload-builds), [API e funções de acesso](https://developer.apple.com/help/app-store-connect/get-started/app-store-connect-api/), [Assinatura gerenciada](https://developer.apple.com/help/account/certificates/cloud-managed-certificates/), [Distribuição interna](https://developer.apple.com/documentation/xcode/distributing-your-app-for-beta-testing-and-releases).
