# Marketplace privado — Build 166

Integração da Comunidade com o Marketplace 0.2.0, base consolidada 22BB-C39-R1. O piloto permite ao administrador testar reservas, mensalidades, parceiros e financeiro no ambiente de homologação. Não cria reservas nem eventos nos grupos reais da Comunidade.

## Ambientes e acesso

| Componente | Destino |
| --- | --- |
| Comunidade e identidade Google | Projeto existente `xvwgrpnioaqyijhzqxqh`, somente validação de identidade/permissões pela ponte |
| Dados do marketplace | Staging `owybghlwcohfyapvsfdo` |
| Interface | `/marketplace/`, na mesma origem da Comunidade |
| Entrada | Início → Onde jogar → Teste privado, somente para a conta autorizada |
| Conta autorizada | Mapeamento único provisionado no schema privado; nenhuma credencial no frontend |
| Pagamentos e e-mails automáticos | Desativados no servidor durante o piloto |

`supabase-config.js` foi preservado byte a byte. Não há migração da Comunidade nesta entrega. A branch iOS 165 é independente.

## Proteções

- A Edge Function `community-marketplace-session` valida o token da Comunidade via `auth.getUser`, identidade Google, e-mail confirmado, administrador e aceite legal. O cliente não escolhe a conta de destino.
- O mapeamento no servidor exige o ID da conta autorizada nas duas aplicações. Uma sessão do Marketplace é criada sem enviar e-mail e fica somente em memória no navegador. A chave de serviço é lida apenas no ambiente da Edge Function.
- A configuração `verify_jwt=false` na função é intencional: o token pertence ao outro projeto. A própria função faz a autenticação completa; tokens inválidos recebem 401.
- Um filtro de requisições protege a API REST e as RPCs. Políticas RLS restritivas protegem tabelas e Storage, preservando as regras C39. A verificação exige uma sessão ativa do Marketplace.
- Fotos de estabelecimentos deixam de ser públicas e usam URLs assinadas por dez minutos. Uma URL já emitida continua válida até vencer.
- A interface revalida a autorização a cada minuto. A revogação da sessão da Comunidade é detectada pela interface nessa checagem; a sessão própria do Marketplace deve ser revogada também em caso de incidente.
- `/marketplace/` não entra no cache offline. Dados transitórios da tela usam sessionStorage e são limpos na entrada e na saída.
- Sem integração de escrita com grupos, presenças, caixa ou eventos da Comunidade nesta fase. Os grupos exibidos no Marketplace são os grupos de teste já existentes no staging.

## Implantação

1. A migração em `supabase/migrations/` e a nova Edge Function foram aplicadas somente ao Marketplace staging em 28/10/2026. Não reaplicar as migrações históricas C39.
2. Publicar o frontend revisado no mesmo domínio da Comunidade para reutilizar sua sessão Google. Uma prévia Cloudflare em outro domínio não herda esse login e pode exigir configuração adicional de OAuth.
3. Validar com a conta autorizada em celular. O wrapper Android existente carrega o site hospedado; publicar somente um AAB não publica estes arquivos web.
4. Preparar os dados de acesso para a equipe de revisão antes de enviar uma versão com o Marketplace ao Google Play. Não fornecer a conta pessoal do administrador.

Nenhuma alteração no Play Console é realizada por estes arquivos. As instruções propostas estão em `PLAY-CONSOLE.md`.

## Validação executada

- 12 testes da ponte: autenticação, identidade, conta não autorizada, origem, limite de solicitações, aceite legal, emissão de sessão e ausência de envio de e-mail.
- Teste transacional no banco: conta autorizada, outra conta, anônimo, sessão revogada, serviço interno, fotos privadas e bloqueio de dinheiro real. Sem dados de teste persistidos.
- Chamadas HTTP reais: API anônima 403; ponte sem token/invalidada 401; origem não autorizada 403.
- Bootstrap real no banco: administrador ativo e dois estabelecimentos disponíveis sob as novas políticas.
- Navegador a 390 × 844: visitante e conta negada não carregam o aplicativo; conta autorizada simulada carrega a área administrativa, sem persistir a sessão do Marketplace e sem service worker próprio. Integrações remotas são simuladas nesse teste de interface.

O login Google real e os fluxos comerciais no telefone ainda precisam ser validados pelo titular. Não foram efetuadas reservas, cobranças, reembolsos ou mensagens reais durante a implementação.

Para repetir os testes: na pasta `integration/marketplace`, executar `npm install`, `npx playwright install chromium`, `npm test` e `npm run test:browser`. O teste de navegador carrega o SDK público fixado na versão 2.57.4 e simula as APIs; opcionalmente usar `PILOT_TEST_SDK` para um arquivo local e `CHROMIUM_PATH` para um navegador já instalado. `tests/access.sql` é exclusivo do banco staging e reverte a transação ao terminar.

## Roteiro no celular

1. Confirmar que a Comunidade continua abrindo grupos, presença, times e caixa.
2. Abrir Onde jogar com a conta autorizada. Conferir a faixa Teste privado / Pagamentos simulados.
3. Navegar por Usuário, Parceiro (quando houver vínculo) e Administração. A prévia de parceiro continua somente leitura.
4. Usar exclusivamente grupos, estabelecimentos e clientes de teste: reserva avulsa; mensalidade; parcelamento entre participantes; confirmação de pagamento simulado; cancelamento e voucher.
5. Conferir datas, disponibilidade, valores, saldo, histórico e atualização em outro aparelho.
6. Testar upload/visualização de fotos e documentos, avisos e conversas do staging.
7. Sair, trocar de conta, testar link direto, fechar/reabrir o app e perder a conexão. Outra conta deve permanecer bloqueada.
8. Registrar resultado, aparelho, horário, passos e evidência, sem tokens ou dados pessoais de participantes reais.

## Suspender o piloto

No banco **Marketplace staging**: `update private.community_marketplace_pilot set enabled=false where singleton;`. Isso bloqueia o acesso, inclusive do titular. Manter tabelas e histórico. Para reativar apenas o mesmo titular, definir `enabled=true`.

Para retirar a integração web, reverter o commit do frontend. Não liberar o marketplace removendo indiscriminadamente as políticas RLS. A abertura pública exige uma migração específica, revisão de permissões, revisão nas lojas e validações de pagamento.
