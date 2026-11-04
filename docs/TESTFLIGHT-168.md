# Primeiro TestFlight — Tâmo On 1.0.168

Estado em 4/11/2026. O titular confirmou o fluxo e a vinculação Apple no aplicativo publicado e autorizou avançar ao TestFlight. Isso confirma a experiência web/PWA usada até aqui; o primeiro pacote nativo assinado ainda será validado no iPhone.

## Preparação concluída

- App Store Connect: aplicativo `6830420681`, bundle `br.app.tamoon`, equipe `4T892ZTN46`.
- Grupo interno **Piloto interno**, distribuição manual, criado sem adicionar testers nem enviar convites. Inicialmente zero builds e zero testers.
- Informações de teste: suporte, site, privacidade e notas sobre login Google/Apple, Marketplace restrito/sandbox e exclusão unificada salvos.
- Scheme Xcode compartilhado, arquivo de exportação para TestFlight interno e verificação do archive de iPhone adicionados.
- O workflow de preparação também compila um archive Release/arm64 sem credenciais. O simulador não substitui essa validação nem um teste no aparelho.
- Workflow de envio exclusivamente manual. Exige o SHA completo de um commit da branch iOS e um número de build válido. Sem selecionar `upload`, apenas verifica o archive. Não publica artefatos nem credenciais no repositório público.

## Bloqueio atual da assinatura

Em Usuários e acesso → Integrações → API do App Store Connect, a Apple exige que o titular solicite acesso e aceite os termos específicos. A janela foi aberta para conferência; a caixa de aceite não foi marcada e a solicitação não foi enviada.

O Xcode Cloud desta conta ainda não está configurado; o painel solicita a configuração inicial pelo Xcode. O caminho preparado usa o Mac do GitHub Actions já empregado nas validações. O envio depende de habilitar a API e configurar uma chave autorizada para assinatura automática e upload. A chave de Sign in with Apple é diferente e não deve ser reaproveitada.

## Antes de habilitar o envio

1. Obter a confirmação do titular para aceitar os termos de uso interno da API e enviar a solicitação da organização. A Apple pode analisar o pedido.
2. Após aprovação, escolher o menor nível de acesso que permita provisionamento e assinatura automática. Chaves individuais não permitem provisionamento; chaves de equipe abrangem todos os apps da conta, conforme sua função. Conferir o alcance real antes de criar a chave e obter a autorização para essa credencial e seu armazenamento no GitHub.
3. Criar o ambiente GitHub `testflight`, restrito à branch `main`, com aprovação do responsável. Armazenar somente ali `ASC_KEY_ID`, `ASC_ISSUER_ID` e `ASC_PRIVATE_KEY`. Não usar secrets de repositório para contornar a revisão do ambiente.
4. O executor usa um Keychain temporário e apaga o arquivo da chave ao terminar. A assinatura de distribuição é gerenciada pela Apple. Se a Apple recusar a função selecionada, parar e revisar o acesso; não elevar a função automaticamente nem revogar certificados existentes para tentar corrigir.

## Primeiro envio

No workflow **Preparar ou enviar iOS ao TestFlight**, executar a versão da `main`, informar o SHA revisado da `ios-build-165`, `build_number=168` se ainda estiver disponível e `upload=true`. O fluxo instala as dependências fixadas, recompõe os recursos locais, executa os testes, arquiva para iPhone e pede ao Xcode que assine e envie à Apple.

O arquivo de exportação define `testFlightInternalTestingOnly=true`; esse primeiro build não poderá ser usado para revisão externa nem publicação na App Store. Uma distribuição externa posterior exigirá outro build e a preparação específica de revisão.

Só anunciar instalação disponível depois que a Apple processar o build, ele aparecer no TestFlight e for adicionado ao grupo. Convites a terceiros exigem identificação dos testers e instrução de envio. A ficha de distribuição da App Store ainda precisa ser alinhada da versão 1.0.167 para 1.0.168 antes de uma submissão à loja; isso não impede o upload beta com a versão correta no binário.

## Verificação no iPhone nativo

Conferir login Apple, Google, retorno após suspensão, vínculo na mesma conta, entrada/volta do Marketplace, bloqueios e lista do piloto, abertura do checkout de teste, compartilhamento, notificações no app e pedido de exclusão com protocolo. A análise operacional de revogação Apple e tratamento do Marketplace permanece necessária antes da revisão externa; não instalar o incremento destrutivo antigo de exclusão.

Referências: [Upload de builds](https://developer.apple.com/help/app-store-connect/manage-builds/upload-builds), [API e funções de acesso](https://developer.apple.com/help/app-store-connect/get-started/app-store-connect-api/), [Assinatura gerenciada](https://developer.apple.com/help/account/certificates/cloud-managed-certificates/), [Distribuição interna](https://developer.apple.com/documentation/xcode/distributing-your-app-for-beta-testing-and-releases).
