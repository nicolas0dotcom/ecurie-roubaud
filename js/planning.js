// Écran du planning : pour un jour et un driver, la liste ordonnée des lots
// (lot 1, lot 2, lot 3… avec un cheval par lot).
//
// Chaque ligne est enregistrée exactement comme le fait la tablette :
//   { id, date: "AAAA-MM-JJ", horseId, driver, work: "T" | "P", lot, order }
// La tablette affiche les lignes du jour triées par numéro de lot.
// Elle n'affiche que le planning de Jean-Marie (comparaison sans tiret ni
// espace : « Jean-Marie » et « Jean Marie » conviennent tous les deux).
(function () {
  'use strict';
  const { $, esc, nameKey, toast, parisDay, addDays, validDay, longDay, niceName } = window.Outils;

  let day = parisDay(1); // demain par défaut
  let driver = null;     // nom affiché du driver choisi
  let drivers = null;    // liste chargée une fois depuis la base
  let busy = false;

  const remember = value => { try { localStorage.setItem('rg-driver', value); } catch (e) { /* rien */ } };
  const remembered = () => { try { return localStorage.getItem('rg-driver'); } catch (e) { return null; } };

  // Liste des drivers : ceux des comptes, plus ceux déjà présents dans le
  // planning (pour ne rien cacher), sans doublon d'écriture.
  async function loadDrivers() {
    const names = [];
    const add = name => { if (name && !names.some(n => nameKey(n) === nameKey(name))) names.push(niceName(name)); };
    try { (await Api.drivers()).forEach(add); } catch (error) { toast('Liste des drivers indisponible : ' + error.message, true); }
    Api.list('plan').map(p => p.payload.driver).forEach(add);
    return names.sort((a, b) => a.localeCompare(b, 'fr'));
  }

  // Lignes du jour et du driver choisis, dans l'ordre des lots.
  function rowsFor(date, name) {
    return Api.list('plan')
      .filter(p => p.payload.date === date && nameKey(p.payload.driver) === nameKey(name))
      .sort((a, b) => (a.payload.lot - b.payload.lot) || ((a.payload.order || 0) - (b.payload.order || 0)) || a.id.localeCompare(b.id));
  }

  // Après un ajout, un retrait ou un déplacement : lots renumérotés 1, 2, 3…
  // Seules les lignes qui changent sont envoyées.
  function renumber(rows) {
    const changes = [];
    rows.forEach((row, i) => {
      if (row.payload.lot !== i + 1 || (row.payload.order || 0) !== 0) {
        changes.push({ kind: 'plan', id: row.id, payload: { ...row.payload, lot: i + 1, order: 0 } });
      }
    });
    return changes;
  }

  async function apply(changes, message) {
    if (busy || !changes.length) return;
    busy = true;
    document.body.classList.add('busy');
    try {
      await Api.saveMany(changes);
      if (message) toast(message);
    } catch (error) {
      toast(error.message, true);
    } finally {
      busy = false;
      document.body.classList.remove('busy');
      draw();
    }
  }

  const horseName = id => { const h = Api.get('horse', id); return h ? h.payload.name : 'Cheval supprimé'; };
  const done = planId => Api.list('session').some(s => s.payload.planId === planId && !s.payload.demo);

  // --- Écran -------------------------------------------------------------------
  async function render(main) {
    main.innerHTML = '<p class="loading">Chargement des drivers…</p>';
    if (!drivers) drivers = await loadDrivers();
    if (!driver) {
      const saved = remembered();
      driver = drivers.find(d => nameKey(d) === nameKey(saved)) || drivers.find(d => nameKey(d) === 'jeanmarie') || drivers[0] || null;
    }
    main.innerHTML = `
      <h1>Planning</h1>
      <div class="planning-choice">
        <label>Jour<input type="date" id="p-day" value="${esc(day)}" required></label>
        <div class="quick-days">
          <button type="button" class="button small" data-day="0">Aujourd’hui</button>
          <button type="button" class="button small" data-day="1">Demain</button>
        </div>
        <label>Driver<select id="p-driver">${drivers.map(d => `<option ${d === driver ? 'selected' : ''}>${esc(d)}</option>`).join('')}</select></label>
      </div>
      <div id="planning-body"></div>`;
    $('#p-day').onchange = e => { if (validDay(e.target.value)) { day = e.target.value; draw(); } };
    for (const b of main.querySelectorAll('[data-day]')) b.onclick = () => { day = parisDay(Number(b.dataset.day)); $('#p-day').value = day; draw(); };
    $('#p-driver').onchange = e => { driver = e.target.value; remember(driver); draw(); };
    draw();
  }

  function draw() {
    const body = $('#planning-body');
    if (!body) return;
    if (!driver) { body.innerHTML = '<p class="empty-list">Aucun driver trouvé dans la base.</p>'; return; }
    const rows = rowsFor(day, driver);
    const tabletNote = nameKey(driver) === 'jeanmarie' ? '' :
      '<p class="note">Les tablettes affichent seulement le planning de Jean-Marie. Ce planning est enregistré et consultable ici.</p>';
    body.innerHTML = `
      <h2 class="day-title">${esc(longDay(day))} · ${esc(driver)}</h2>
      ${tabletNote}
      ${rows.length ? `<ol class="lots">${rows.map((row, i) => {
        const p = row.payload;
        const archived = Api.get('horse', p.horseId)?.payload.active === false;
        return `<li class="lot">
          <div class="lot-line">
            <span class="lot-number">Lot ${i + 1}</span>
            <span class="lot-horse"><strong>${esc(horseName(p.horseId))}</strong>
              <small>${p.work === 'P' ? 'Promenade' : 'Trotter'}${archived ? ' · archivé' : ''}${done(row.id) ? ' · séance faite' : ''}</small></span>
          </div>
          <div class="lot-buttons">
            <button type="button" class="button icon" data-move="${i}" data-dir="-1" ${i === 0 ? 'disabled' : ''} aria-label="Monter ${esc(horseName(p.horseId))}">▲</button>
            <button type="button" class="button icon" data-move="${i}" data-dir="1" ${i === rows.length - 1 ? 'disabled' : ''} aria-label="Descendre ${esc(horseName(p.horseId))}">▼</button>
            <button type="button" class="button icon" data-work="${i}" aria-label="Changer le travail (T ou P)">${p.work === 'P' ? 'P' : 'T'}</button>
            <button type="button" class="button icon danger" data-remove="${i}" aria-label="Enlever ${esc(horseName(p.horseId))}">✕</button>
          </div>
        </li>`;
      }).join('')}</ol>` : '<p class="empty-list">Aucun cheval prévu.</p>'}
      <div class="actions">
        <button type="button" class="button primary" id="add-horse">+ Ajouter un cheval</button>
        ${rows.length ? '<button type="button" class="button" id="copy-day">Recopier ce planning sur un autre jour</button>' : ''}
      </div>
      <p class="muted small-text">T = Trotter (travail) · P = Promenade. Touchez T ou P pour changer.</p>`;

    for (const b of body.querySelectorAll('[data-move]')) b.onclick = () => {
      const i = Number(b.dataset.move), j = i + Number(b.dataset.dir);
      const next = rows.slice();
      [next[i], next[j]] = [next[j], next[i]];
      apply(renumber(next));
    };
    for (const b of body.querySelectorAll('[data-work]')) b.onclick = () => {
      const row = rows[Number(b.dataset.work)];
      apply([{ kind: 'plan', id: row.id, payload: { ...row.payload, work: row.payload.work === 'P' ? 'T' : 'P' } }]);
    };
    for (const b of body.querySelectorAll('[data-remove]')) b.onclick = () => {
      const i = Number(b.dataset.remove);
      const row = rows[i];
      if (!confirm(`Enlever ${horseName(row.payload.horseId)} du lot ${i + 1} ?`)) return;
      const rest = rows.filter((_, k) => k !== i);
      apply([{ kind: 'plan', id: row.id, payload: row.payload, deleted: true }, ...renumber(rest)], 'Cheval enlevé.');
    };
    $('#add-horse').onclick = () => openPicker();
    if ($('#copy-day')) $('#copy-day').onclick = () => openCopy(rows);
  }

  // --- Panneau plein écran (choix d'un cheval, recopie) -----------------------
  function panel(title, content) {
    const box = document.createElement('div');
    box.className = 'panel';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-label', title);
    box.innerHTML = `<div class="panel-head"><h2>${esc(title)}</h2><button type="button" class="button small" data-close>Terminé</button></div><div class="panel-body">${content}</div>`;
    document.body.append(box);
    document.body.classList.add('panel-open');
    const close = () => { box.remove(); document.body.classList.remove('panel-open'); draw(); };
    box.querySelector('[data-close]').onclick = close;
    return { box, close };
  }

  function openPicker() {
    const { box } = panel('Ajouter un cheval', `
      <p class="muted">Pour ${esc(driver)}, ${esc(longDay(day).toLowerCase())}. Touchez un cheval pour l’ajouter au lot suivant.</p>
      <input class="search" type="search" placeholder="Rechercher un cheval…" aria-label="Rechercher un cheval" autocomplete="off">
      <ul class="rows picker"></ul>`);
    const horses = Api.list('horse').filter(h => h.payload.active !== false).sort((a, b) => String(a.payload.name).localeCompare(String(b.payload.name), 'fr'));
    const input = box.querySelector('input');
    const list = box.querySelector('ul');
    const show = () => {
      const key = nameKey(input.value);
      const planned = new Set(rowsFor(day, driver).map(r => r.payload.horseId));
      const shown = horses.filter(h => nameKey(h.payload.name).includes(key));
      list.innerHTML = shown.length ? shown.map(h => `<li><button type="button" class="row pick" data-horse="${esc(h.id)}">
        <span class="row-text"><strong>${esc(h.payload.name)}</strong>${planned.has(h.id) ? '<small class="tag">Déjà au planning</small>' : ''}</span><span class="plus" aria-hidden="true">+</span></button></li>`).join('')
        : '<li class="empty-list">Aucun cheval trouvé. Ajoutez-le d’abord dans Chevaux.</li>';
      for (const b of list.querySelectorAll('[data-horse]')) b.onclick = async () => {
        if (busy) return;
        const rows = rowsFor(day, driver);
        if (rows.length >= 50) { toast('50 lots au maximum.', true); return; }
        const id = crypto.randomUUID();
        const name = Api.get('horse', b.dataset.horse).payload.name;
        await apply([{ kind: 'plan', id, payload: { id, date: day, horseId: b.dataset.horse, driver, work: 'T', lot: rows.length + 1, order: 0 } }],
          `${name} ajouté au lot ${rows.length + 1}.`);
        show();
      };
    };
    input.oninput = show;
    show();
  }

  function openCopy(sourceRows) {
    const { box, close } = panel('Recopier le planning', `
      <p>Recopier les ${sourceRows.length} lots de ${esc(driver)} du ${esc(longDay(day).toLowerCase())} sur :</p>
      <label class="form-label">Jour<input type="date" id="copy-target" value="${esc(addDays(day, 1))}"></label>
      <button type="button" class="button primary" id="copy-go">Recopier</button>`);
    box.querySelector('#copy-go').onclick = async () => {
      const target = box.querySelector('#copy-target').value;
      if (!validDay(target)) { toast('Choisissez un jour.', true); return; }
      if (target === day) { toast('Choisissez un autre jour que celui affiché.', true); return; }
      const existing = rowsFor(target, driver);
      if (existing.length && !confirm(`${driver} a déjà ${existing.length} lot(s) le ${longDay(target).toLowerCase()}. Les remplacer ?`)) return;
      if (existing.length + sourceRows.length > 50) { toast('Trop de lignes à envoyer en une fois.', true); return; }
      const changes = existing.map(r => ({ kind: 'plan', id: r.id, payload: r.payload, deleted: true }));
      sourceRows.forEach((row, i) => {
        const id = crypto.randomUUID();
        changes.push({ kind: 'plan', id, payload: { id, date: target, horseId: row.payload.horseId, driver, work: row.payload.work === 'P' ? 'P' : 'T', lot: i + 1, order: 0 } });
      });
      day = target;
      close();
      const dayInput = $('#p-day');
      if (dayInput) dayInput.value = day;
      await apply(changes, `Planning recopié sur le ${longDay(target).toLowerCase()}.`);
    };
  }

  window.Planning = { render };
})();
