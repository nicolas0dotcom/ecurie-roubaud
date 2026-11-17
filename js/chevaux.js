// Écrans des chevaux : liste avec recherche, fiche, ajout, modification, archivage.
//
// Une fiche cheval contient les champs déjà utilisés par les tablettes :
// name (nom), notes, photo (facultative) et active (false = archivé).
// On archive au lieu de supprimer : l'historique du cheval est conservé.
(function () {
  'use strict';
  const { $, esc, nameKey, toast, resizeImage, safePhoto, parisDay, shortDay, dayOf, fromToday, niceName, workLabel } = window.Outils;

  let search = '';
  let showArchived = false;

  const isArchived = horse => horse.payload.active === false;
  const byName = (a, b) => String(a.payload.name).localeCompare(String(b.payload.name), 'fr');

  // Séances terminées d'un cheval, de la plus récente à la plus ancienne.
  const sessionsOf = horseId => Seances.finishedSessions().filter(s => s.payload.horseId === horseId);

  // Sorties prévues à partir d'aujourd'hui, de la plus proche à la plus lointaine.
  function upcomingOf(horseId) {
    const today = parisDay(0);
    return Api.list('plan')
      .filter(p => p.payload.horseId === horseId && p.payload.date >= today)
      .sort((a, b) => a.payload.date.localeCompare(b.payload.date) || (a.payload.lot - b.payload.lot));
  }

  function thumb(horse, size = 'small') {
    const photo = safePhoto(horse.payload.photo);
    if (photo) return `<img class="photo ${size}" src="${photo}" alt="">`;
    const initial = esc(String(horse.payload.name || '?').trim().charAt(0).toUpperCase());
    return `<span class="photo ${size} empty" aria-hidden="true">${initial}</span>`;
  }

  // --- Liste -----------------------------------------------------------------
  // activeId : cheval ouvert à droite sur grand écran (ligne mise en valeur).
  function renderList(main, activeId) {
    const all = Api.list('horse').sort(byName);
    const archivedCount = all.filter(isArchived).length;
    // Dernière séance et prochaine sortie de chaque cheval, calculées une fois.
    const last = new Map();
    for (const s of Seances.finishedSessions()) if (!last.has(s.payload.horseId)) last.set(s.payload.horseId, s.payload.started);
    const today = parisDay(0), next = new Map();
    for (const p of Api.list('plan')) {
      const { horseId, date } = p.payload;
      if (date >= today && (!next.has(horseId) || date < next.get(horseId))) next.set(horseId, date);
    }
    const detail = h => {
      const parts = [];
      if (next.has(h.id)) parts.push(`<span class="soon">Prévu ${esc(fromToday(next.get(h.id)) === 'aujourd’hui' || fromToday(next.get(h.id)) === 'demain' ? fromToday(next.get(h.id)) : shortDay(next.get(h.id)))}</span>`);
      parts.push(last.has(h.id) ? `Dernière séance ${esc(fromToday(dayOf(last.get(h.id))))}` : 'Aucune séance');
      return parts.join(' · ');
    };
    main.innerHTML = `
      <div class="page-head">
        <h1>Chevaux</h1>
        <a class="button primary small" href="#nouveau-cheval">+ Nouveau</a>
      </div>
      <input id="horse-search" class="search" type="search" placeholder="Rechercher un cheval…" aria-label="Rechercher un cheval" value="${esc(search)}" autocomplete="off">
      <label class="check"><input type="checkbox" id="show-archived" ${showArchived ? 'checked' : ''}> Voir les chevaux archivés (${archivedCount})</label>
      <p class="muted small-text" id="horse-count"></p>
      <ul class="rows compact" id="horse-list"></ul>`;
    const draw = () => {
      const key = nameKey(search);
      const rows = all.filter(h => (showArchived || !isArchived(h)) && nameKey(h.payload.name).includes(key));
      $('#horse-count').textContent = rows.length + (rows.length > 1 ? ' chevaux' : ' cheval');
      $('#horse-list').innerHTML = rows.length ? rows.map(h => `
        <li><a class="row${h.id === activeId ? ' current' : ''}" href="#cheval/${encodeURIComponent(h.id)}"${h.id === activeId ? ' aria-current="page"' : ''}>
          ${thumb(h)}
          <span class="row-text"><strong>${esc(h.payload.name)}</strong><small>${isArchived(h) ? '<span class="tag">Archivé</span> ' : ''}${detail(h)}</small></span>
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
    const sessions = sessionsOf(id);
    const upcoming = upcomingOf(id);
    const allPlans = Api.list('plan').map(r => r.payload);
    const lastDay = sessions.length ? dayOf(sessions[0].payload.started) : null;
    const nextPlan = upcoming[0]?.payload;
    const monthAgo = Date.now() - 30 * 86400000;
    const lastMonth = sessions.filter(s => s.payload.started >= monthAgo).length;
    const minutes = seconds => Calculs.duration(seconds);
    const meters = m => Number.isFinite(m) ? (m >= 1000 ? (m / 1000).toFixed(2).replace('.', ',') + ' km' : Math.round(m) + ' m') : '—';
    const time = ms => new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' }).format(new Date(ms));
    const dayMonth = d => shortDay(d).replace(/^\S+\s/, ''); // "jeu. 19 nov." -> "19 nov."
    const planLink = r => `#planning/${encodeURIComponent(r.payload.date)}/${encodeURIComponent(r.payload.driver || '')}`;
    main.innerHTML = `
      <a class="back" href="#chevaux">‹ Chevaux</a>
      <div class="sheet-head">
        ${thumb(horse, 'medium')}
        <div>
          <h1>${esc(p.name)}</h1>
          ${isArchived(horse) ? '<span class="tag big">Archivé</span>' : ''}
        </div>
      </div>
      <div class="stats three">
        <div><em>Séances</em><strong>${sessions.length}</strong><span>${lastMonth} sur 30 jours</span></div>
        <div><em>Dernière</em><strong>${lastDay ? esc(dayMonth(lastDay)) : '—'}</strong><span>${lastDay ? esc(fromToday(lastDay)) : 'aucune séance'}</span></div>
        <div><em>Prochaine</em><strong>${nextPlan ? esc(dayMonth(nextPlan.date)) : '—'}</strong><span>${nextPlan ? esc(fromToday(nextPlan.date)) : 'rien au planning'}</span></div>
      </div>

      <section class="card">
        <h2>Notes</h2>
        ${p.notes ? `<p class="notes">${esc(p.notes)}</p>` : '<p class="muted">Pas de notes. Ajoutez-en avec « Modifier la fiche ».</p>'}
      </section>

      <section class="card">
        <h2>Prochaines sorties</h2>
        ${upcoming.length ? `<ul class="mini-list">${upcoming.slice(0, 5).map(r => `
          <li><a href="${planLink(r)}"><span><strong>${esc(shortDay(r.payload.date))}</strong> · ${esc(niceName(r.payload.driver || ''))}</span>
          <small>Lot ${esc(r.payload.lot)} · ${esc(workLabel(r.payload, allPlans))}</small></a></li>`).join('')}</ul>`
          : '<p class="muted">Rien de prévu au planning.</p>'}
      </section>

      <section class="card">
        <h2>Dernières séances</h2>
        ${sessions.length ? `<ul class="mini-list">${sessions.slice(0, 5).map(s => `
          <li><a href="#seance/${encodeURIComponent(s.id)}"><span><strong>${esc(shortDay(dayOf(s.payload.started)))}</strong> · ${esc(time(s.payload.started))}${s.payload.driver ? ' · ' + esc(niceName(s.payload.driver)) : ''}</span>
          <small>${esc(minutes(s.payload.elapsed))} · ${esc(meters(s.payload.distance))}</small></a></li>`).join('')}</ul>
          ${sessions.length > 5 ? `<a class="button small" href="#seances/${encodeURIComponent(id)}">Voir les ${sessions.length} séances</a>` : ''}`
          : '<p class="muted">Aucune séance enregistrée.</p>'}
      </section>

      <div class="actions two">
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
      <a class="back keep" href="${id ? '#cheval/' + encodeURIComponent(id) : '#chevaux'}">‹ Annuler</a>
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
