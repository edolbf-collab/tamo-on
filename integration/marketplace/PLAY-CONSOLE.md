# Texto preparado para o Google Play — não enviado

## Acesso ao app

Manter a indicação de que parte das funcionalidades exige acesso autorizado. Atualizar as instruções em inglês e fornecer uma conta de revisão dedicada, reutilizável e com dados fictícios. A conta pessoal do administrador não deve ser compartilhada.

O piloto atual autoriza apenas o titular. Portanto, as instruções abaixo são um rascunho: a conta e o caminho de revisão do Marketplace precisam estar configurados e testados antes de enviar uma versão com essa funcionalidade à análise. Não declarar que os revisores já têm acesso.

### Suggested review notes

Tâmo On organizes sports groups, attendance, teams, announcements and manually recorded group finances.

This update adds an explicitly restricted Marketplace pilot for booking physical sports venues. The pilot runs in a separate staging environment and is initially available only to the platform operator. Payments are simulated; no real charges or transfers are enabled. The pilot synchronizes sandbox reservations only with the explicitly configured test group (Teste FC). New games are published there after simulated confirmation and are clearly labeled as tests. Other groups are excluded; simulated amounts never become real Community cash entries.

Access path: sign in to the Community, open Home, then “Onde jogar”. Authorized users see “Teste privado”. The Marketplace displays a permanent private-test and simulated-payments banner. Other users cannot open its data or operations, including through direct URLs.

The review account and its access instructions must be supplied in the App access section before this feature is submitted for review. Do not use the operator's personal Google account. Access for reviewers must cover the functionality under review without granting access to live customer data.

### Notas de lançamento propostas (pt-BR)

```text
<pt-BR>
Preparação do marketplace para testes privados com a conta autorizada.
Integração com o login da Comunidade e navegação em Onde jogar.
Reservas e financeiro em ambiente de teste, com pagamentos simulados.
O marketplace ainda não está liberado ao público.
</pt-BR>
```

## Antes do envio

- Conferir Acesso ao app e a disponibilidade real da conta de revisão.
- Conferir se a política de privacidade e Segurança dos dados descrevem os dados realmente coletados por reservas, conversas e documentos. Não responder “não coleta” por ser um piloto.
- Explicar a restrição por conta e o uso de homologação nas notas de revisão. Não ativar funcionalidades omitidas da análise.
- Usar teste interno restrito para as primeiras validações. A publicação em teste aberto permite adesão pública à faixa, embora o acesso ao Marketplace continue restrito pelo servidor.
- Antes de pagamentos reais ou abertura pública, revisar fluxos, permissões, declarações, políticas e dados de produção.

Referências oficiais consultadas: [acesso para revisão](https://support.google.com/googleplay/android-developer/answer/15748846) e [comportamento enganoso](https://support.google.com/googleplay/android-developer/answer/9888077).
