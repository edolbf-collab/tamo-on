# iOS 1.0.170 — correção do diagnóstico de push

O usuário autorizou integrar os PRs 12/13, publicar a correção web e enviar a nova compilação somente ao TestFlight em 07/11/2026.

A web 168-R5 foi confirmada no domínio app.tamoon.app.br. O build Apple 173 / versão 1.0.169 compilou, mas o upload foi recusado porque a Apple já aprovou 1.0.169 e fechou essa versão para novos envios (execução 42413231115).

Esta alteração avança a versão para 1.0.170, integração 170-R1. Próximo envio: build Apple 174. Sem nova submissão à revisão pública da App Store.

Teste esperado: diagnóstico reconhece o registro APNs ativo, sem depender de Web Push; confirmar recebimento e abertura das notificações no iPhone. Não declarar validação física antes do teste do usuário.
