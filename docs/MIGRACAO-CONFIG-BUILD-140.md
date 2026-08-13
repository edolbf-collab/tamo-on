# Migração do supabase-config.js — Build 140

O arquivo publicado contém valores específicos do ambiente e não deve ser substituído pelo modelo vazio do pacote completo.

Procedimento recomendado:
1. Faça backup do `supabase-config.js` atual.
2. Na pasta do repositório, execute `migrar-config-build-140.ps1`.
3. O script preserva URL, chave pública, Google Client ID, VAPID e redirect URL; apenas padroniza o objeto público para `window.TAMOON_CONFIG` e o nome do aplicativo para `Tâmo On`.
4. Confirme que nenhuma Secret key ou service role existe no frontend.
5. Publique o arquivo já migrado junto com a Build 140.

O frontend possui fallback temporário para reconhecer um objeto de configuração compatível, evitando indisponibilidade durante a transição.
