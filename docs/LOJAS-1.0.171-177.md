# Envio às lojas — 1.0.171 (177)

Data: 2026-11-09. Envio autorizado pelo responsável pelo Tâmo On.

## Escopo
Convites de grupos pelo endereço https://tamoon.app.br/baixar?invite=CODE, mantendo o código e os links das lojas; abertura nativa pelo esquema br.app.tamoon://invite?code=CODE. Preservadas as melhorias de push já validadas no Android e no iOS e a retirada das informações Beta da interface.

## Estado confirmado nos consoles
- Apple: versão pública 1.0.171, build 177, Waiting for Review. Submissão 93426f26-031e-4909-ad4d-101c88ca4f92, enviada em 09/11/2026 às 18:20 (UTC-3). Publicação automática após aprovação.
- Google Play: produção, versão 1.0.171, versionCode 177. Console confirmou "Alterações em revisão", com verificações rápidas iniciais ainda em execução. Nome: "Tâmo On 1.0.171 (177) – Convites e notificações". Implementação 100% nos países já selecionados (Brasil), publicação gerida desativada.
- O envio não representa aprovação nem disponibilidade imediata nas lojas.

## Fonte e validação
PR #16 contém os convites; PR #17 prepara a versão. Merge de release: 19ffa40a3f3b1945e5a8443d31968f5465802399.
- 242 testes locais de lógica/integração passaram.
- Validações finais Android package/mobile-layout: Actions 42699992563, sucesso.
- Validação nativa Android/emulador: Actions 42699992524, sucesso.
- iOS assinado e enviado: Actions 42699781920, sucesso. Fonte 9e1eec8b37b7c5451a53f0c432009eb8c00cc338; a correção posterior f2ecd3bc86e15b8d1fb3a757c5021e7be69a7281 altera somente metadados do service worker, excluído dos pacotes nativos.
- Arquivo Android: Tamo-On-Android-1.0.171-177.aab, 20.868.148 bytes.
- SHA-256: 1089f6c0025a18a6315d6c0889936509747cda4b8b5c8e2fb5d5200af6e3ad42.
- Assinatura validada e certificado conferido com a chave de upload existente.
- Google aceitou o pacote; único aviso não impeditivo: ausência de símbolos nativos de depuração. Mapeamento R8 incluído.

## Pendências
- Aguardar análise e aprovação de ambas as lojas.
- Confirmar publicação manual do pacote Tamo-On-Site-Convites-20261109-Completo.zip, já entregue ao usuário. O site não foi publicado nesta etapa.
- Validar o fluxo completo dos convites em aparelhos físicos após site e versões aprovadas. Não confundir com a validação física anterior de push, já concluída pelo usuário.
