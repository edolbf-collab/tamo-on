/* Alertas pessoais: dados oficiais, deduplicacao e audio mediante gesto do usuario. */
(() => {
  "use strict";
  window.createMarketplaceAlerts = function ({storage, audioFactory, now = Date.now, onVisual = () => {}}) {
    let profile = "", primed = false, seen = new Set(), enabled = false, context = null, lastSound = -Infinity;
    const read = (key) => { try { return storage?.getItem(key); } catch (_) { return null; } };
    const write = (key, value) => { try { storage?.setItem(key, value); } catch (_) {} };
    function setProfile(id) {
      if (id === profile) return;
      profile = id || ""; primed = false; seen.clear(); lastSound = -Infinity;
      enabled = Boolean(profile && read(`tamo-alert-sound:${profile}`) !== "off");
    }
    async function arm() {
      if (!enabled || !profile) return false;
      try { context ||= audioFactory(); await context?.resume(); return context?.state === "running"; }
      catch (_) { return false; }
    }
    async function setEnabled(value) {
      enabled = Boolean(value && profile);
      write(`tamo-alert-sound:${profile}`, enabled ? "on" : "off");
      if (!enabled) return true;
      return arm();
    }
    function sound(id) {
      if (!enabled || context?.state !== "running" || now() - lastSound < 2500) return;
      const key = `tamo-alert-played:${profile}`;
      try {
        const previous = JSON.parse(read(key) || "null");
        if (previous && (previous.id === id || now() - previous.at < 2500)) return;
      } catch (_) {}
      write(key, JSON.stringify({id, at:now()})); lastSound = now();
      try {
        const oscillator = context.createOscillator(), gain = context.createGain(), start = context.currentTime;
        oscillator.type = "sine"; oscillator.frequency.setValueAtTime(660, start);
        oscillator.frequency.setValueAtTime(880, start + 0.12);
        gain.gain.setValueAtTime(0, start); gain.gain.linearRampToValueAtTime(0.055, start + 0.025);
        gain.gain.exponentialRampToValueAtTime(0.001, start + 0.32);
        oscillator.connect(gain); gain.connect(context.destination); oscillator.start(start); oscillator.stop(start + 0.34);
        oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
      } catch (_) { /* O aviso visual permanece mesmo quando o audio falha. */ }
    }
    function ingest(rows, {initial = false} = {}) {
      const fresh = [];
      for (const row of rows || []) {
        if (!profile || row.profile_id !== profile || !row.id || seen.has(row.id)) continue;
        seen.add(row.id);
        if (!(initial || !primed) && row.status === "unread") fresh.push(row);
      }
      primed = true;
      if (fresh.length) { onVisual(fresh); sound(fresh[0].id); }
      return fresh;
    }
    return {setProfile, ingest, arm, setEnabled, isEnabled:() => enabled};
  };
})();
