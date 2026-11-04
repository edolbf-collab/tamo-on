// Synthetic, in-memory UI state. This file is a test resource, never an app asset.
const source = await fetch('/index.html').then(response => response.text());
const page = new DOMParser().parseFromString(source, 'text/html');
document.body.replaceChildren(...['app', 'modalRoot', 'toastRoot'].map(id => page.getElementById(id)));
App.cancelBootFeedback();
App.pilotAccessMonitor?.dispose();
App.pilotAuthSubscription?.unsubscribe();
Object.assign(App.state, {
  profile: {id:'layout-user', name:'Teste de tela'},
  currentGroupId:'layout-group',
  groups:[{id:'layout-group', name:'Grupo de futebol e amigos', role:'owner', player_id:'layout-player'}],
  players:[{id:'layout-player', user_id:'layout-user', name:'Organizador do grupo'}],
  members:[{user_id:'layout-user', player_id:'layout-player', role:'owner'}],
  matches:[{id:'layout-match', title:'Futebol e churrasco do grupo', starts_at:new Date(Date.now()+86400000).toISOString(), duration_minutes:90, max_players:18, bbq_enabled:true, location:'Quadra de teste'}],
  attendance:[],
  announcements:[{id:'layout-notice', title:'Aviso do grupo', body:'Confirme sua presença no jogo e no churrasco.', created_at:new Date().toISOString()}],
  marketplace_pilot:true
});
App.ready=true;
App.route='home';
App.render();
await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
return true;
