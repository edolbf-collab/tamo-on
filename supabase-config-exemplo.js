/**
 * Tâmo On — configuração pública do Supabase.
 *
 * Este arquivo do pacote completo é apenas um MODELO sem credenciais.
 * Preserve os valores do arquivo publicado e use window.TAMOON_CONFIG.
 * Nunca coloque Secret key ou service_role no frontend.
 */
window.TAMOON_CONFIG = {
  supabaseUrl: "",
  supabasePublishableKey: "",
  googleClientId: "",
  vapidPublicKey: "",
  authRedirectUrl: new URL(".", window.location.href).href,
  appName: "Tâmo On"
};
