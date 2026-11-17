// Accès à la base : connexion, admission de cet appareil, synchronisation.
//
// La page utilise exactement les mêmes fonctions que les tablettes :
//  - er_device_access : enregistre ce navigateur comme appareil de l'écurie
//    (accepté automatiquement quand on est connecté au compte de l'écurie) ;
//  - er_mobile_sync   : lit et envoie les chevaux, le planning et les séances ;
//  - er_mobile_session: lit les mesures détaillées d'une séance.
// Aucune table n'est lue ou écrite directement.
(function () {
  'use strict';

  // --- Identité de ce navigateur -----------------------------------------
  // Un identifiant et un secret tirés au hasard, gardés dans le navigateur.
  // La base exige le secret à chaque appel, pour qu'un jeton volé ne suffise pas.
  function deviceIdentity() {
    try {
      const saved = JSON.parse(localStorage.getItem('rg-appareil') || 'null');
      if (saved && /^web-[a-f0-9-]{36}$/.test(saved.id) && /^[a-f0-9]{64}$/.test(saved.secret)) return saved;
    } catch (e) { /* stockage indisponible : nouvel appareil */ }
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    const created = {
      id: 'web-' + crypto.randomUUID(),
      secret: Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
    };
    try { localStorage.setItem('rg-appareil', JSON.stringify(created)); } catch (e) { /* tant pis */ }
    return created;
  }
  const device = deviceIdentity();

  // Les en-têtes de l'appareil ne sont ajoutés qu'aux appels de la base
  // (/rest/v1/), pas à la connexion.
  function fetchWithDevice(input, init = {}) {
    const url = typeof input === 'string' ? input : input.url;
    if (url.includes('/rest/v1/')) {
      const headers = new Headers(init.headers || {});
      headers.set('x-roubaud-device', device.id);
      headers.set('x-roubaud-device-secret', device.secret);
      init = { ...init, headers };
    }
    return fetch(input, init);
  }

  const client = window.supabase.createClient(CONFIG.url, CONFIG.key, {
    auth: { persistSession: true, autoRefreshToken: true, storageKey: 'rg-connexion' },
    global: { fetch: fetchWithDevice }
  });

  // --- Données en mémoire ---------------------------------------------------
  // records : "kind:id" -> { kind, id, revision, payload, deleted }
  const store = { records: new Map(), cursor: 0, workspace: null };

  function friendly(error) {
    const text = (error && (error.message || error.code || String(error))) || 'Erreur inconnue';
    if (/ROUBAUD_DEVICE_LOCKED/.test(text)) return new Error('Cet appareil a été bloqué depuis la gestion des appareils. Demandez à Nicolas de le réautoriser.');
    if (/Wrong account|Access denied/.test(text)) return new Error('Ce compte n’est pas le compte de l’écurie. Connectez-vous avec l’identifiant commun.');
    if (/Rate limit/.test(text)) return new Error('Trop de demandes en une minute. Patientez un instant.');
    if (/Failed to fetch|NetworkError|Load failed/.test(text)) return new Error('Pas de connexion Internet. Réessayez quand le réseau revient.');
    if (/Invalid login credentials/.test(text)) return new Error('Identifiant ou mot de passe incorrect.');
    return new Error(text);
  }

  async function rpc(name, args) {
    const { data, error } = await client.rpc(name, args);
    if (error) throw friendly(error);
    if (data && data.code === 'ROUBAUD_DEVICE_LOCKED') throw friendly({ message: data.code });
    return data;
  }

  // Nom affiché dans la liste des appareils de l'écurie.
  function deviceName() {
    const ua = navigator.userAgent;
    const kind = /iPhone/.test(ua) ? 'iPhone' : /iPad|Macintosh.*Mobile/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : 'PC';
    return 'Page web · ' + kind;
  }

  // Après connexion (ou à l'ouverture si déjà connecté) : se présenter à la base.
  async function admitDevice(session) {
    store.workspace = session.user.id;
    const result = await rpc('er_device_access', {
      p_workspace: store.workspace,
      p_device: device.id,
      p_info: { name: deviceName(), platform: 'web', version: 'web-gestion' }
    });
    if (result && result.state && !['approved', 'legacy'].includes(result.state)) {
      throw new Error('Cet appareil est en attente ou bloqué (' + result.state + ').');
    }
  }

  async function currentSession() {
    const { data } = await client.auth.getSession();
    return data.session;
  }

  async function signIn(email, password) {
    const { data, error } = await client.auth.signInWithPassword({ email: email.trim(), password });
    if (error) throw friendly(error);
    await admitDevice(data.session);
    return data.session;
  }

  async function signOut() {
    await client.auth.signOut();
    store.records.clear();
    store.cursor = 0;
    store.workspace = null;
  }

  // Un aller-retour avec la base : envoie les opérations, reçoit les changements.
  async function exchange(ops) {
    const data = await rpc('er_mobile_sync', {
      p_workspace: store.workspace, p_ops: ops, p_after: store.cursor, p_status: {}, p_device: null
    });
    for (const record of data.records || []) store.records.set(record.kind + ':' + record.id, record);
    store.cursor = data.cursor;
    return data;
  }

  // Récupère tout ce qui a changé depuis le dernier appel.
  async function pull() {
    let data;
    do { data = await exchange([]); } while (data.more);
  }

  // Enregistre plusieurs fiches en un seul envoi (50 au plus).
  // changes : [{ kind, id, payload, deleted }]
  // "base" = la version connue : si quelqu'un a modifié la même fiche
  // entre-temps, la base refuse cette fiche et on recharge la sienne.
  async function saveMany(changes) {
    if (!changes.length) return;
    if (changes.length > 50) throw new Error('Trop de modifications en une fois.');
    const ops = changes.map(c => {
      const known = store.records.get(c.kind + ':' + c.id);
      return { opId: crypto.randomUUID(), kind: c.kind, id: c.id, base: known ? known.revision : 0, payload: c.payload, deleted: !!c.deleted };
    });
    const data = await exchange(ops);
    const results = data.results || [];
    if (data.more) await pull();
    if (results.length !== ops.length) throw new Error('La base n’a pas confirmé l’enregistrement.');
    let conflict = false;
    results.forEach((ack, i) => {
      if (!ack.conflict) return;
      conflict = true;
      if (ack.remote) store.records.set(ops[i].kind + ':' + ops[i].id, ack.remote);
    });
    if (conflict) throw new Error('Une fiche vient d’être modifiée sur un autre appareil. Vérifiez puis recommencez.');
  }

  async function save(kind, id, payload, deleted = false) {
    await saveMany([{ kind, id, payload, deleted }]);
    return store.records.get(kind + ':' + id);
  }

  // Drivers de l'écurie : noms rangés avec les comptes des drivers.
  async function drivers() {
    const rows = await rpc('er_user_accounts', { p_workspace: store.workspace, p_action: 'list', p_body: {} });
    return (rows || []).filter(r => r.role === 'driver' && !r.revoked && r.driver).map(r => r.driver);
  }

  // Mesures détaillées d'une séance (paquets de 1 000), gardées en mémoire.
  const samplesCache = new Map();
  async function sessionSamples(id) {
    if (samplesCache.has(id)) return samplesCache.get(id);
    const chunks = await rpc('er_mobile_session', { p_workspace: store.workspace, p_id: id });
    const samples = (Array.isArray(chunks) ? chunks : [])
      .slice().sort((a, b) => (a.index || 0) - (b.index || 0))
      .flatMap(c => Array.isArray(c.samples) ? c.samples : [])
      .filter(s => s && Number.isFinite(s.t))
      .sort((a, b) => a.t - b.t);
    samplesCache.set(id, samples);
    return samples;
  }

  // Liste des fiches visibles d'un type.
  function list(kind) {
    const out = [];
    for (const r of store.records.values()) if (r.kind === kind && !r.deleted) out.push(r);
    return out;
  }
  function get(kind, id) {
    const r = store.records.get(kind + ':' + id);
    return r && !r.deleted ? r : null;
  }

  window.Api = { currentSession, admitDevice, signIn, signOut, pull, save, saveMany, drivers, sessionSamples, list, get, device };
})();
