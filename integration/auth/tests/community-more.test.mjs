import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../../../app.js', import.meta.url), 'utf8');
const personal = ['profile', 'notification-settings', 'community-safety', 'legal-documents',
  'report-problem', 'about-diagnostics', 'account-delete', 'sign-out'];
const member = ['announcement-center', 'invite'];
const organizer = ['announcement', 'players'];
const admin = ['group-settings', 'manage-roles'];

function community(role = null, platformAdmin = false) {
  const nodes = new Map();
  const listeners = new Map();
  const document = {
    baseURI: "https://app.test/",
    addEventListener(type, fn) { listeners.set(type, fn); },
    querySelectorAll() { return []; },
    querySelector(selector) {
      if (!nodes.has(selector)) nodes.set(selector, {
        dataset: {}, classList: { toggle() {} }, addEventListener() {}, removeAttribute() {}, setAttribute() {}
      });
      return nodes.get(selector);
    }
  };
  const window = { addEventListener() {}, scrollTo() {} };
  vm.runInNewContext(source, { window, document, navigator: {}, URL, URLSearchParams, console, location: { href:'https://app.test/', search:'' } });
  const app = window.App;
  app.state.profile = { id:'example', name:'Pessoa' };
  app.state.is_platform_admin = platformAdmin;
  if (role) {
    app.state.currentGroupId = 'test';
    app.state.groups = [{ id:'test', name:'Grupo', role, invite_code:'GRUPO' }];
  }
  app.ready = true;
  app.bindGlobal();
  return {
    app,
    open(route) {
      listeners.get('click')({ target: { closest: selector => selector === '[data-route]' ? {dataset:{route}} : null } });
      return document.querySelector('#mainContent').innerHTML;
    }
  };
}

for (const [label, role, platformAdmin, extra] of [
  ['active account without a group', null, false, []],
  ['platform admin without a group', null, true, ['platform-admin', 'deletion-admin']],
  ['member', 'member', false, member],
  ['treasurer', 'treasurer', false, member],
  ['organizer', 'organizer', false, [...member, ...organizer]],
  ['group admin', 'admin', false, [...member, ...organizer, ...admin]],
  ['group owner and platform admin', 'owner', true, [...member, ...organizer, ...admin, 'platform-admin', 'deletion-admin', 'export']]
]) {
  test('More navigation shows the permitted actions for ' + label, () => {
    const {open} = community(role, platformAdmin);
    const html = open('more');
    assert.match(html, /<h1>Mais<\/h1>/);
    assert.deepEqual([...html.matchAll(/data-action="([^"]+)"/g)].map(m=>m[1]).sort(), [...personal, ...extra].sort());
    assert.equal(html.includes('Código GRUPO'), Boolean(role));
  });
}

test('an account can return to More from an empty group screen; its profile has no group role', () => {
  const {app, open} = community();
  assert.match(open('matches'), /data-action="join-group"/);
  assert.match(open('more'), /<strong>Meu perfil<\/strong>/);
  let profile;
  app.modal = (_, html) => { profile = html; };
  app.openProfileModal();
  assert.match(profile, /profileAccessButton/);
  assert.doesNotMatch(profile, /class="role-pill|name="nickname"/);
});
