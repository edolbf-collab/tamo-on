# Build 166-R10 — remarcação de eventos manuais

Administrador e organizador podem alterar data e horário em **Editar evento** quando o evento manual está agendado e ainda não começou. O servidor impede alterações em eventos iniciados, encerrados, cancelados ou vinculados a reservas do Marketplace. Em uma série semanal, somente a ocorrência escolhida muda.

A gravação usa a identidade autenticada do organizador, verifica acesso ao grupo e aceite legal e compara a data carregada com a atual para evitar sobrescrever uma remarcação concorrente. Data e demais ajustes são gravados em uma transação. Presenças, churrasco e identificação da série permanecem; o prazo de confirmação acompanha o deslocamento da data. A regra existente para redistribuição de times quando muda a capacidade continua válida.

Depois da gravação, `publish-announcement` registra o aviso na central e envia push aos demais membros habilitados, respeitando os bloqueios existentes. O texto informa a data anterior e a nova, no horário de Brasília, e abre o evento. Falha de entrega é informada separadamente da gravação; não desfaz a remarcação. Não há disparo se a data não mudou.

## Implantação

- Migração aditiva `20261029113922_manual_match_rescheduling.sql`, com versão gerada pelo Supabase. Mantém o RPC antigo compatível.
- Edge `publish-announcement`, código Build 116, versão implantada 31. Inclui `match-reschedule.mjs`; mantém a autenticação interna e `verify_jwt=false` da versão anterior.
- Interface e cache `166-R10`; bundle do Marketplace preservado.
- Configuração de conexão preservada.

## Validação

- 90 testes Node aprovados (75 existentes e 15 de remarcação).
- Teste SQL transacional aprovado, com rollback integral dos dados de teste: data, configurações atômicas, presenças, times, prazo, recorrência, concorrência, eventos fechados, vínculos Marketplace, permissões e API anterior.
- Sintaxe JavaScript e TypeScript verificada; conteúdo publicado da Edge conferido com os arquivos locais.
- Não foram enviados pushes reais de teste. Validação visual e recebimento em aparelhos físicos ficam pendentes; o ambiente local não possui navegador instalado.

## Validação no celular

1. Abrir um evento manual futuro como administrador/organizador e escolher **Editar evento**.
2. Alterar a data ou horário, salvar e conferir a nova posição na lista e as presenças mantidas.
3. Em outra conta do grupo com push habilitado, conferir o aviso e abrir o evento pelo link.
4. Conferir que um evento vinculado ao Marketplace não oferece edição de data.
