// Écrans des chevaux : liste avec recherche, fiche, ajout, modification, archivage.
//
// Une fiche cheval contient les champs déjà utilisés par les tablettes :
// name (nom), notes, photo (facultative) et active (false = archivé).
// On archive au lieu de supprimer : l'historique du cheval est conservé.
(function () {
  'use strict';
  const { $, esc, nameKey, toast, resizeImage, safePhoto } = window.Outils;

  let search = '';
  let showArchived = false;

  const isArchived = horse => horse.payload.active === false;
  const byName = (a, b) => String(a.payload.name).localeCompare(String(b.payload.name), 'fr');

  function sessionCount(horseId) {
    return Api.list('session').filter(s => s.payload.horseId === horseId && !s.payload.demo).length;
  }

  function thumb(horse, size = 'small') {
    const photo = safePhoto(horse.payload.photo);
    if (photo) return `<img class="photo ${size}" src="${photo}" alt="">`;
    const initial = esc(String(horse.payload.name || '?').trim().charAt(0).toUpperCase());
    return `<span class="photo ${size} empty" aria-hidden="true">${initial}</span>`;
  }

  // --- Liste -----------------------------------------------------------------
  function renderList(main) {
    const all = Api.list('horse').sort(byName);
    const archivedCount = all.filter(isArchived).length;
    main.innerHTML = `
      <div class="page-head">
        <h1>Chevaux</h1>
        <a class="button primary" href="#nouveau-cheval">+ Nouveau cheval</a>
      </div>
      <input id="horse-search" class="search" type="search" placeholder="Rechercher un cheval…" aria-label="Rechercher un cheval" value="${esc(search)}" autocomplete="off">
      <label class="check"><input type="checkbox" id="show-archived" ${showArchived ? 'checked' : ''}> Voir les chevaux archivés (${archivedCount})</label>
      <ul class="rows" id="horse-list"></ul>`;
    const draw = () => {
      const key = nameKey(search);
      const rows = all.filter(h => (showArchived || !isArchived(h)) && nameKey(h.payload.name).includes(key));
      $('#horse-list').innerHTML = rows.length ? rows.map(h => `
        <li><a class="row" href="#cheval/${encodeURIComponent(h.id)}">
          ${thumb(h)}
          <span class="row-text"><strong>${esc(h.payload.name)}</strong>${isArchived(h) ? '<small class="tag">Archivé</small>' : ''}</span>
          <span class="chevron" aria-hidden="true">›</span>
        </a></li>`).join('') : '<li class="empty-list">Aucun cheval trouvé.</li>';
    };
    $('#horse-search').oninput = e => { search = e.target.value; draw(); };
    $('#show-archived').onchange = e => { showArchived = e.target.checked; draw(); };
    draw();
  }

  // --- Fiche -----------------------------------------------------------------
  function renderSheet(main, id) {
    const horse = Api.get('horse', id);
    if (!horse) { main.innerHTML = '<p class="empty-list">Ce cheval n’existe plus.</p><a class="button" href="#chevaux">Retour aux chevaux</a>'; return; }
    const p = horse.payload;
    const count = sessionCount(id);
    main.innerHTML = `
      <a class="back" href="#chevaux">‹ Chevaux</a>
      <div class="sheet">
        ${thumb(horse, 'large')}
        <h1>${esc(p.name)}</h1>
        ${isArchived(horse) ? '<p class="tag big">Archivé</p>' : ''}
        ${p.notes ? `<p class="notes">${esc(p.notes)}</p>` : '<p class="muted">Pas de notes.</p>'}
      </div>
      <div class="actions">
        <a class="button primary" href="#seances/${encodeURIComponent(id)}">Historique des séances (${count})</a>
        <a class="button" href="#cheval/${encodeURIComponent(id)}/modifier">Modifier la fiche</a>
        <button type="button" class="button ${isArchived(horse) ? '' : 'danger'}" id="toggle-archive">${isArchived(horse) ? 'Réactiver ce cheval' : 'Archiver ce cheval'}</button>
      </div>`;
    $('#toggle-archive').onclick = async e => {
      const archiving = !isArchived(horse);
      if (archiving && !confirm(`Archiver ${p.name} ?\n\nIl disparaît de la liste et du planning de la page, mais son historique est conservé. Vous pourrez le réactiver.`)) return;
      e.target.disabled = true;
      try {
        await Api.save('horse', id, { ...p, id, active: !archiving });
        toast(archiving ? 'Cheval archivé.' : 'Cheval réactivé.');
      } catch (error) { toast(error.message, true); }
      App.render();
    };
  }

  // --- Formulaire (nouveau ou modification) ---------------------------------
  function renderForm(main, id) {
    const horse = id ? Api.get('horse', id) : null;
    if (id && !horse) { location.hash = '#chevaux'; return; }
    const p = horse ? horse.payload : { name: '', notes: '' };
    let photo = safePhoto(p.photo);
    main.innerHTML = `
      <a class="back" href="${id ? '#cheval/' + encodeURIComponent(id) : '#chevaux'}">‹ Annuler</a>
      <h1>${id ? 'Modifier la fiche' : 'Nouveau cheval'}</h1>
      <form id="horse-form" class="form" novalidate>
        <label>Nom du cheval
          <input id="f-name" required maxlength="80" value="${esc(p.name)}" autocomplete="off" autocapitalize="characters">
        </label>
        <label>Notes
          <textarea id="f-notes" maxlength="3000" rows="5">${esc(p.notes || '')}</textarea>
        </label>
        <div class="photo-field">
          <span class="label">Photo (facultative)</span>
          <div id="photo-preview"></div>
          <label class="button">Choisir une photo<input id="f-photo" type="file" accept="image/*" hidden></label>
          <button type="button" class="button" id="remove-photo">Retirer la photo</button>
        </div>
        <button class="button primary" id="save">Enregistrer</button>
      </form>`;
    const drawPhoto = () => {
      $('#photo-preview').innerHTML = photo ? `<img class="photo large" src="${photo}" alt="Photo du cheval">` : '<p class="muted">Pas de photo.</p>';
      $('#remove-photo').hidden = !photo;
    };
    drawPhoto();
    $('#f-photo').onchange = async e => {
      const file = e.target.files[0];
      if (!file) return;
      try { photo = await resizeImage(file); drawPhoto(); } catch (error) { toast(error.message, true); }
    };
    $('#remove-photo').onclick = () => { photo = null; drawPhoto(); };
    $('#horse-form').onsubmit = async e => {
      e.preventDefault();
      const name = $('#f-name').value.trim().replace(/\s+/g, ' ');
      if (!name) { toast('Indiquez le nom du cheval.', true); $('#f-name').focus(); return; }
      const twin = Api.list('horse').find(h => h.id !== id && nameKey(h.payload.name) === nameKey(name));
      if (twin) { toast(`Un cheval s’appelle déjà ${twin.payload.name}${isArchived(twin) ? ' (archivé)' : ''}.`, true); return; }
      const newId = id || crypto.randomUUID();
      const payload = { ...p, id: newId, name, notes: $('#f-notes').value.trim(), active: horse ? p.active !== false : true };
      payload.photo = photo || null; // comme les tablettes : null quand il n'y a pas de photo
      const button = $('#save');
      button.disabled = true; button.textContent = 'Enregistrement…';
      try {
        await Api.save('horse', newId, payload);
        toast(id ? 'Fiche enregistrée.' : 'Cheval ajouté.');
        location.hash = '#cheval/' + encodeURIComponent(newId);
      } catch (error) {
        toast(error.message, true);
        button.disabled = false; button.textContent = 'Enregistrer';
      }
    };
  }

  window.Chevaux = { renderList, renderSheet, renderForm };
})();
