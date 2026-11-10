# iOS 1.0.170 — correção do diagnóstico de push

O usuário autorizou integrar os PRs 12/13, publicar a correção web e enviar a nova compilação somente ao TestFlight em 07/11/2026.

A web 168-R5 foi confirmada no domínio app.tamoon.app.br. O build Apple 173 / versão 1.0.169 compilou, mas o upload foi recusado porque a Apple já aprovou 1.0.169 e fechou essa versão para novos envios (execução 42413231115).

Versão 1.0.170, integração 170-R1, build Apple 174, fonte 120cfcd91eeaa5e17708e53cffa439ab0698eed0. A execução https://github.com/edolbf-collab/tamo-on/actions/runs/42413934031 terminou com sucesso; upload concluído em 07/11/2026 às 21:09 UTC. Build processado e associado ao grupo existente Piloto interno, com status Testing confirmado. Sem nova submissão à revisão pública da App Store.

PR 12 integrado ao main (dc0e656d2df273f6b148edc6101796de796eb01f) e PR 13 ao ios-build-165 (1cf7d7702c01454e744158a21390423a9a760e1c). Testes automatizados de push, integração e empacotamento passaram. Android: atualizar para 168-R5, testar exibição local e depois envio remoto; se o remoto não aparecer, renovar vínculo e repetir. O aceite do provedor não confirma exibição no aparelho. Nenhum disparo de push em produção foi feito nesta etapa.

Teste esperado: diagnóstico reconhece o registro APNs ativo, sem depender de Web Push; confirmar recebimento e abertura das notificações no iPhone. Não declarar validação física antes do teste do usuário.
