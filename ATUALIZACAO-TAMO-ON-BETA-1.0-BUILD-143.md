# Tâmo On Beta 1.0 — Build 143

## Versões

- Aplicativo: Build 143
- HTML: Build 143
- Service Worker: Build 143
- Banco: Build 140 (sem alteração)
- Edge Function `publish-announcement`: Build 111

## Alterações

1. Quando o próprio membro estava confirmado e muda sua resposta de **Vou** para **Não vou**, os demais membros do grupo recebem um push informando a alteração. O aparelho do membro que realizou a mudança não recebe o próprio alerta.
2. Nas movimentações do caixa, toda entrada vinculada a um membro mostra o nome dele no mesmo bloco visual do valor. Para registros antigos, o app também tenta recuperar o membro pela cobrança associada.
3. Os 20 escudos clássicos da Build 142 foram preservados sem alterações.

## Ordem de publicação

### 1. Atualizar a Edge Function no Supabase

1. Abra o projeto no Supabase Dashboard.
2. Entre em **Edge Functions** e abra `publish-announcement`.
3. Substitua o conteúdo do editor pelo arquivo `publish-announcement-edge-build-111.ts` deste pacote.
4. Clique em **Deploy function** e aguarde a confirmação.

O arquivo acima é idêntico a `supabase/functions/publish-announcement/index.ts`. A atualização não exige alterar as chaves VAPID nem os demais secrets já configurados.

### 2. Publicar a Build 143 no GitHub

1. Extraia o ZIP no computador.
2. No repositório `edolbf-collab/tamo-on`, use **Add file > Upload files**.
3. Envie os arquivos e a pasta `supabase` para a raiz do repositório, permitindo a substituição dos arquivos existentes.
4. Confirme que `app.js`, `index.html`, `service-worker.js` e `version.json` ficaram na raiz, e não dentro de uma nova pasta Build 143.
5. Faça o commit na branch `main` e aguarde o deploy da Cloudflare concluir.

## Validação depois do deploy

- Em **Mais > Sobre e diagnóstico**, confirmar: aplicativo 143, HTML 143, Service Worker 143 e banco 140.
- Com dois aparelhos vinculados ao push, confirmar um membro em uma pelada e depois mudar para **Não vou**. O outro aparelho deve receber: `Alteração de presença`.
- Como administrador ou tesoureiro, registrar um pagamento para um membro com cobrança pendente. Em **Caixa > Movimentações**, o bloco do valor deve mostrar `Membro: Nome`.

## Arquivos alterados

- `app.js`
- `styles.css`
- `group-avatars-data.js`
- `index.html`
- `pwa-bootstrap.js`
- `service-worker.js`
- `version.json`
- `supabase/functions/publish-announcement/index.ts`
- `publish-announcement-edge-build-111.ts`
