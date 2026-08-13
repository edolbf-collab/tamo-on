# Planejamento mestre do Tâmo On

**Backup atualizado na Beta 1.0 Build 137 — 04/08/2026**

Este arquivo deve acompanhar todas as novas builds do projeto. Ele registra decisões consolidadas para permitir continuidade mesmo quando o desenvolvimento migrar para outra conversa.

## 1. Linhas de desenvolvimento

### Linha Beta 1.0

Aplicativo principal utilizado nos testes reais com grupos. Deve permanecer estável e isolado das funcionalidades experimentais de parceiros.

Linha principal atual: **Beta 1.0 Build 137**, Banco 136 r1 e Edge Functions 108.

### Linha Partners Preview

Ambiente separado destinado a telas, fluxos, banco de homologação e futura integração Asaas Sandbox. Não deve usar dinheiro real nem interferir no beta principal.

Linha inicial: **Partners Preview 0.1**.

## 2. Fase 1 — validação do aplicativo principal

O beta fechado e o beta aberto terão duração total não inferior a 90 dias. A meta é validar:

- estabilidade, desempenho e compatibilidade;
- erros e dificuldades operacionais;
- compreensão das telas e fluxos;
- aceitação social e resistência a mudanças;
- sugestões, comportamento e retenção dos usuários;
- efetividade das funcionalidades de grupos, eventos, confirmações, espera, times, churrasco, caixa e notificações.

## 3. Fase preparatória empresarial

Antes da operação comercial:

1. definir modelo de receita e comissão;
2. obter avaliação jurídica e contábil sobre MEI;
3. confirmar atividade permitida, CNAE e emissão fiscal;
4. validar que a receita própria do Tâmo On seja apenas a comissão, quando juridicamente aplicável;
5. estruturar contratos e fluxo de split;
6. abrir o CNPJ na natureza recomendada;
7. abrir conta Asaas PJ;
8. preparar Sandbox e homologação.

Alternativa empresarial caso o MEI seja inviável: LTDA unipessoal enquadrada como Microempresa.

## 4. Fase 2.1 — quadras parceiras sem pagamento integrado

Objetivos:

- cadastrar e aprovar quadras e canchas;
- modernizar agenda, reservas e processos internos;
- validar operação com poucos parceiros;
- ampliar a base de usuários;
- identificar necessidades reais do setor;
- operar inicialmente com pagamento externo.

### Área administrativa

- cadastro, análise, aprovação, suspensão e exclusão de parceiros;
- gestão de estabelecimentos, espaços e funcionários;
- reservas, cancelamentos, ocorrências e no-show;
- comissão futura, auditoria e relatórios;
- cobertura geográfica, ocupação e suporte.

### Portal do parceiro

- dados do estabelecimento;
- espaços, fotos, estrutura, modalidade, piso e capacidade;
- horários de funcionamento;
- agenda, bloqueios e manutenção;
- preços e regras por horário;
- reservas avulsas e recorrentes;
- clientes, mensalistas e histórico;
- funcionários e permissões;
- relatórios de ocupação e comunicação.

### Área do usuário

- busca por modalidade, localização, preço e horário;
- perfil do estabelecimento;
- disponibilidade;
- reserva e cancelamento;
- histórico;
- vínculo da reserva com evento do grupo;
- avaliação posterior.

## 5. Fase 2.2 — Asaas Sandbox e pagamentos

A implementação financeira ocorrerá após a agenda e as reservas estarem confiáveis.

### Sequência técnica

1. criar e configurar conta Sandbox;
2. definir regras comerciais, comissão, tarifas e cancelamento;
3. criar projeto/ambiente Supabase separado;
4. implementar tabelas financeiras;
5. armazenar chaves apenas em segredos de Edge Functions;
6. criar clientes e cobranças;
7. usar Checkout hospedado para Pix e cartão;
8. receber e validar webhooks;
9. garantir idempotência;
10. confirmar, expirar e cancelar reservas;
11. implementar reembolso integral e parcial;
12. homologar subcontas e `walletId`;
13. configurar split;
14. conciliar cobranças, comissões e repasses;
15. testar falhas, duplicidades, atrasos e recuperação manual;
16. migrar de forma controlada para produção.

### Edge Functions previstas

- `asaas-create-customer`;
- `asaas-create-checkout`;
- `asaas-payment-status`;
- `asaas-cancel-checkout`;
- `asaas-refund-payment`;
- `asaas-webhook`;
- `asaas-create-partner-account`;
- `asaas-configure-split`.

### Regras de segurança

- nunca colocar chave Asaas no frontend ou GitHub;
- frontend envia apenas o identificador da reserva;
- backend recalcula preço, comissão e recebedores;
- webhook é a fonte de confirmação financeira;
- cada evento de webhook deve ser processado uma única vez;
- Sandbox e produção usam chaves, URLs e dados separados;
- pagamentos reais permanecem bloqueados até homologação.

## 6. Ordem de desenvolvimento da Partners Preview

### Ciclo A — especificação

- mapa de telas;
- perfis e permissões;
- estados da reserva;
- políticas de cancelamento;
- entrevistas com quadras.

### Ciclo B — administração e parceiro

- cadastro e aprovação;
- estabelecimentos e espaços;
- agenda e preços;
- funcionários e permissões.

### Ciclo C — usuário e reservas

- pesquisa e filtros;
- disponibilidade;
- reserva, cancelamento e histórico;
- vínculo com evento.

### Ciclo D — Asaas Sandbox básico

- clientes;
- checkout;
- Pix e cartão;
- webhooks;
- confirmação, expiração, cancelamento e reembolso.

### Ciclo E — marketplace financeiro

- subcontas;
- `walletId`;
- split;
- comissão;
- repasse;
- conciliação;
- painel financeiro.

### Ciclo F — homologação

- concorrência de agenda;
- segurança e permissões;
- webhooks duplicados e atrasados;
- pagamentos recusados;
- reembolsos;
- falhas de split;
- auditoria e recuperação manual.

## 7. Ambientes

- **Beta principal:** testes reais dos grupos;
- **Partners Preview:** desenvolvimento funcional da área de parceiros;
- **Asaas Sandbox:** pagamentos fictícios;
- **Produção futura:** somente após homologação e formalização empresarial.

## 8. Política de backup

Toda nova build deverá conter:

- este arquivo atualizado;
- resumo da versão;
- decisões novas;
- pendências;
- versões da linha Beta, banco e Edge Functions;
- versão da linha Partners Preview;
- próximos passos sugeridos.

O arquivo não deve conter chaves, senhas, tokens ou dados pessoais sensíveis.

## 11. Atualização da linha principal — Build 135

A Build 135 acrescenta ferramentas essenciais para o período de testes:

- saúde persistente das assinaturas push;
- registro individual de cada tentativa de entrega, sucesso, falha, código, motivo, duração e contexto;
- invalidação sem apagar o histórico quando o serviço responde 404 ou 410;
- teste de notificação pelo próprio aparelho;
- painel administrativo com assinaturas saudáveis, não testadas, com falha, expiradas e sem aparelho;
- exportação integral do grupo exclusivamente para o administrador da plataforma, com validação também no banco;
- criação de cobranças em lote para vários membros, mantendo uma cobrança individual por pessoa e push individual apenas ao destinatário.

Versões: Frontend 135, Banco 135 e Edge Functions 107.


## Beta 1.0 Build 136 — 04/08/2026
- Diagnóstico real: 9 endpoints Apple falharam simultaneamente por erro de transporte sem código HTTP; Android e navegador tiveram sucesso.
- Edge 108: retry exponencial para erros transitórios, sem desativar assinatura em falha de rede.
- Métricas: status parcial, tentativas sanitizadas no backup e auditoria por plataforma.
- Caixa: cobrança em lote com formulário compacto, botão informativo, lista rolável e rodapé fixo.


## Beta 1.0 Build 137 — inicialização resiliente

- estado inicial do frontend passa a ser seguro e preenchido com coleções vazias;
- nenhuma tela pode acessar grupos ou demais dados antes da conclusão da inicialização;
- carregamento visual aparece somente quando o processo ultrapassa 240 ms e não possui duração mínima;
- abertura por notificações aguarda sessão, perfil e grupos;
- divergências entre HTML, JavaScript e service worker passam a ser detectadas e registradas;
- erros do frontend passam a armazenar contexto técnico suficiente para identificar mistura de builds e falha de sincronização.

Versões: Frontend 137, Banco 136 r1 e Edge Functions 108.

## Diretriz empresarial consolidada pelo parecer contábil — 04/08/2026

- não utilizar MEI;
- natureza recomendada: Sociedade Limitada Unipessoal;
- regime recomendado: Simples Nacional;
- CNAE principal indicado: 7490-1/04, sujeito à confirmação no objeto social definitivo;
- CNAE secundário indicado: 6319-4/00;
- receita própria do Tâmo On limitada à comissão e demais receitas efetivamente próprias;
- valores das quadras devem permanecer segregados por subcontas ou split automático;
- quadra emite nota ao usuário pelo serviço esportivo;
- Tâmo On emite NFS-e para a quadra pela intermediação e uso da plataforma;
- contratos, conciliação, cancelamentos, estornos e chargebacks devem refletir essa separação econômica.


## Atualização — Beta 1.0 Build 138 (04/08/2026)

- A identidade visível da linha principal passa a usar **Tâmo On**.
- A tela de carregamento usa wordmark textual resiliente e a mensagem **Ficando ON…**, sem depender de imagem externa.
- A Build do banco permanece **136**; `136-r1` é somente a revisão corretiva da exportação JSON.
- Identificadores técnicos legados podem permanecer internamente até migração segura, desde que não apareçam para o usuário.


## Atualização — Beta 1.0 Build 139 (05/08/2026)

- O diagnóstico de push passa a separar uma notificação lógica de suas tentativas técnicas.
- Cada envio/aparelho recebe `delivery_id` e registra tentativa, resultado intermediário/final, duração, provedor e categoria.
- Falha intermediária não altera o estado operacional da assinatura enquanto houver retry pendente.
- Estados atuais: saudável, recuperado, instável, atenção, reativação recomendada, parcial, expirada, não testada e falha de configuração.
- O painel e os backups não exibem endpoint, IPv6, porta ou chaves; utilizam hash sanitizado.
- Versões: Frontend 139, Banco 139 e Edge Functions 109.


## Build 140 — consolidação definitiva da identidade

- Nome público e técnico da linha atual: **Tâmo On** / `tamoon`.
- Frontend 140, Banco 140, Edge Functions 110.
- Ativos visuais substituídos pelo pacote oficial v1.1.
- Manifestos, PWA, ícones Android/iOS, tela offline, login, convites, backups e notificações usam a identidade atual.
- Globais, chaves locais e mensagens internas novas usam prefixo `TAMOON` / `tamoon`.
- O banco não renomeia tabelas, RPCs, RLS, IDs ou dados funcionais apenas por estética.
- Repositórios, URLs externas, OAuth e projetos de infraestrutura devem ser verificados separadamente conforme o checklist externo.
