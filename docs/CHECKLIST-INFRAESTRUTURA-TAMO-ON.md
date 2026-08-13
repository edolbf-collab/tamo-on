# Checklist externo da identidade Tâmo On

A Build 140 limpa o estado atual do aplicativo e do pacote de código. Para eliminar referências antigas também fora do código, revisar antes da abertura pública:

- [ ] nome do repositório GitHub e descrição do projeto;
- [ ] nome do projeto Cloudflare Pages e URL pública;
- [ ] domínio oficial e redirects;
- [ ] nome do aplicativo na tela de consentimento Google;
- [ ] origens e redirect URLs do Google OAuth após mudança de domínio;
- [ ] Site URL e Redirect URLs do Supabase Auth;
- [ ] nome/descrição do projeto no painel Supabase quando aplicável;
- [ ] URLs em QR codes, convites, documentos e materiais de teste;
- [ ] nome e ícone nos PWAs já instalados após a atualização;
- [ ] metadados sociais e materiais institucionais.

Alterações de URL devem ser coordenadas com OAuth, Supabase Auth e PWA para não interromper login nem instalações existentes.
