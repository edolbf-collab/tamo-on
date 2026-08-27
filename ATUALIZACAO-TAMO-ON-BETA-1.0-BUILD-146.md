# Tâmo On — Beta 1.0 Build 146

Linha de base: Aplicativo/HTML/Service Worker 145, Banco 142 e Edge Functions 111.

Destino: Aplicativo/HTML/Service Worker 146, Banco 143 e Edge Functions 111.

## Alterações

- O atalho `Respostas` da tela inicial foi substituído por `Onde jogar`, com a indicação `Em construção`.
- O atalho redundante `Membros` foi substituído por `Convidados`.
- `Times` foi preservado por ser uma função operacional do evento.
- O novo atalho abre diretamente o gerenciamento de convidados já existente em `Mais`.
- A tela de convidados separa eventos em aberto, reutilização rápida e histórico.
- Registros encerrados ficam somente para consulta e não podem ser alterados ou excluídos.
- Um convidado histórico pode ser incluído novamente em um evento futuro com um clique e uma confirmação.
- Nome, apelido, posição e condição de goleiro são copiados da participação mais recente.
- Cada participação continua sendo um registro independente, preservando o histórico anterior.
- A proteção do histórico é aplicada no frontend e no banco.

## Ordem de atualização

1. Execute `backend/backend-migration-beta-1.0-build-146-community-shortcuts-and-guests.sql` no SQL Editor do Supabase.
2. Execute `backend/backend-healthcheck-beta-1.0-build-146.sql` e confirme que todos os resultados são `true`.
3. Envie os arquivos do pacote incremental para a raiz do repositório, preservando a pasta `backend`.
4. Aguarde o deployment do Cloudflare.
5. Confirme no diagnóstico: Aplicativo 146, HTML 146, Service Worker 146 e Banco 143.

## Observações

- Não execute `backend/supabase-schema.sql` no banco atual. Ele é o esquema consolidado para uma instalação nova e deve apenas ser mantido atualizado no GitHub.
- Não há alteração de Edge Function. A versão permanece 111.
- Não há alteração de ícones, marcas ou outros assets.
