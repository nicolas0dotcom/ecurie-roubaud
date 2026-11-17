// Démarrage de la page : connexion, chargement des données, navigation.
//
// Adresses (après le #) :
//   #chevaux                 liste des chevaux
//   #cheval/<id>             fiche d'un cheval
//   #cheval/<id>/modifier    modification de la fiche
//   #nouveau-cheval          ajout d'un cheval
//   #planning                planning (étape 3)
//   #seances[/<cheval>]      historique des séances (filtré sur un cheval)
//   #seance/<id>             compte rendu d'une séance
(function () {
  'use strict';
  const { $, esc, toast } = window.Outils;

  let ready = false;

  function showLogin(message = '') {
    document.body.classList.remove('connected');
    $('#main').innerHTML = `
      <form id="login" class="form login">
        <img src="icon.png" alt="" width="84" height="84">
        <h1>Écurie Roubaud</h1>
        <p class="muted">Connectez-vous avec l’identifiant commun de l’écurie.</p>
        <label>Adresse e-mail<input id="l-email" type="email" autocomplete="username" required></label>
        <label>Mot de passe<input id="l-password" type="password" autocomplete="current-password" required></label>
        <p class="error-text" role="alert">${esc(message)}</p>
        <button class="button primary" id="l-submit">Se connecter</button>
      </form>`;
    $('#login').onsubmit = async e => {
      e.preventDefault();
      const button = $('#l-submit');
      button.disabled = true; button.textContent = 'Connexion…';
      try {
        await Api.signIn($('#l-email').value, $('#l-password').value);
        await start();
      } catch (error) {
        showLogin(error.message);
      }
    };
  }

  async function start() {
    document.body.classList.add('connected');
    $('#main').innerHTML = '<p class="loading">Chargement des données de l’écurie…</p>';
    await Api.pull();
    ready = true;
    if (!location.hash || location.hash === '#') location.hash = '#chevaux';
    render();
  }

  function setTab(name) {
    for (const link of document.querySelectorAll('.tabs a')) link.classList.toggle('active', link.dataset.tab === name);
  }

  function render() {
    if (!ready) return;
    const main = $('#main');
    const parts = location.hash.replace(/^#/, '').split('/').map(decodeURIComponent);
    const [page, id, action] = parts;
    window.scrollTo(0, 0);
    if (page === 'cheval' && id && action === 'modifier') { setTab('chevaux'); Chevaux.renderForm(main, id); }
    else if (page === 'cheval' && id) { setTab('chevaux'); Chevaux.renderSheet(main, id); }
    else if (page === 'nouveau-cheval') { setTab('chevaux'); Chevaux.renderForm(main, null); }
    else if (page === 'planning') { setTab('planning'); Planning.render(main).catch(error => toast(error.message, true)); }
    else if (page === 'seances') { setTab('seances'); Seances.renderList(main, id || ''); }
    else if (page === 'seance' && id) { setTab('seances'); Seances.renderReport(main, id).catch(error => toast(error.message, true)); }
    else { setTab('chevaux'); Chevaux.renderList(main); }
  }

  // Recharge les données quand on revient sur la page (téléphone sorti de veille…).
  async function refresh() {
    if (!ready) return;
    try {
      await Api.pull();
      // Ne pas effacer un formulaire ou un panneau en cours d'utilisation.
      if (!document.querySelector('form') && !document.querySelector('.panel')) render();
    } catch (error) { toast(error.message, true); }
  }

  window.App = { render };

  window.addEventListener('hashchange', render);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh(); });
  $('#logout').onclick = async () => {
    if (!confirm('Se déconnecter de cet appareil ?')) return;
    ready = false;
    await Api.signOut();
    showLogin();
  };

  (async () => {
    try {
      const session = await Api.currentSession();
      if (!session) { showLogin(); return; }
      await Api.admitDevice(session);
      await start();
    } catch (error) {
      showLogin(error.message);
    }
  })();
})();
