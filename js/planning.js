// Écran du planning : pour un jour et un driver, la liste ordonnée des lots
// (lot 1, lot 2, lot 3… avec un cheval par lot), et la vue de toute la journée
// (tous les drivers). Sur téléphone, on passe de l'une à l'autre avec les
// pastilles ; sur grand écran, les deux sont côte à côte.
//
// Chaque ligne est enregistrée exactement comme le fait la tablette :
//   { id, date: "AAAA-MM-JJ", horseId, driver, work: "T" | "P", lot, order }
// La tablette affiche les lignes du jour triées par numéro de lot.
// Elle n'affiche que le planning de Jean-Marie (comparaison sans tiret ni
// espace : « Jean-Marie » et « Jean Marie » conviennent tous les deux).
(function () {
  'use strict';
  const { $, esc, nameKey, toast, parisDay, addDays, validDay, longDay, niceName, workLabel } = window.Outils;

  let day = parisDay(1); // demain par défaut
  let driver = null;     // nom affiché du driver choisi
  let drivers = null;    // liste chargée une fois depuis la base
  let mode = 'driver';   // téléphone : 'driver' (modifier) ou 'journee' (vue d'ensemble)
  let busy = false;

  const remember = value => { try { localStorage.setItem('rg-driver', value); } catch (e) { /* rien */ } };
  const remembered = () => { try { return localStorage.getItem('rg-driver'); } catch (e) { return null; } };

  // Liste des drivers : la liste de l'écurie, plus ceux déjà présents dans le
  // planning (pour ne rien cacher), sans doublon d'écriture.
  async function loadDrivers() {
    const names = [];
    const add = name => { if (name && !names.some(n => nameKey(n) === nameKey(name))) names.push(niceName(name)); };
    try { (await Api.drivers()).forEach(add); } catch (error) { toast('Liste des drivers indisponible : ' + error.message, true); }
    Api.list('plan').map(p => p.payload.driver).forEach(add);
    return names.sort((a, b) => a.localeCompare(b, 'fr'));
  }

  const byLot = (a, b) => (a.payload.lot - b.payload.lot) || ((a.payload.order || 0) - (b.payload.order || 0)) || a.id.localeCompare(b.id);
  const dayRows = date => Api.list('plan').filter(p => p.payload.date === date);

  // Lignes du jour et du driver choisis, dans l'ordre des lots.
  function rowsFor(date, name) {
    return dayRows(date).filter(p => nameKey(p.payload.driver) === nameKey(name)).sort(byLot);
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
  // presetDay / presetDriver : ouverture depuis une fiche cheval (#planning/<jour>/<driver>).
  async function render(main, presetDay, presetDriver) {
    main.innerHTML = '<p class="loading">Chargement des drivers…</p>';
    if (!drivers) drivers = await loadDrivers();
    if (presetDay && validDay(presetDay)) day = presetDay;
    if (presetDriver) {
      const found = drivers.find(d => nameKey(d) === nameKey(presetDriver));
      if (found) { driver = found; mode = 'driver'; }
    }
    if (!driver) {
      const saved = remembered();
      driver = drivers.find(d => nameKey(d) === nameKey(saved)) || drivers.find(d => nameKey(d) === 'jeanmarie') || drivers[0] || null;
    }
    main.innerHTML = `
      <h1>Planning</h1>
      <div class="day-bar">
        <button type="button" class="button square" data-shift="-1" aria-label="Jour précédent">‹</button>
        <input type="date" id="p-day" value="${esc(day)}" required aria-label="Jour">
        <button type="button" class="button square" data-shift="1" aria-label="Jour suivant">›</button>
      </div>
      <div class="chips">
        <button type="button" class="chip" data-day="0">Aujourd’hui</button>
        <button type="button" class="chip" data-day="1">Demain</button>
      </div>
      <div class="chips scroll" id="driver-chips" role="group" aria-label="Driver"></div>
      <div class="planning-layout" id="planning-layout">
        <section id="planning-body" aria-label="Lots du driver"></section>
        <aside id="planning-day" aria-label="Toute la journée"></aside>
      </div>`;
    const setDay = value => { day = value; $('#p-day').value = day; draw(); };
    $('#p-day').onchange = e => { if (validDay(e.target.value)) setDay(e.target.value); };
    for (const b of main.querySelectorAll('[data-shift]')) b.onclick = () => setDay(addDays(day, Number(b.dataset.shift)));
    for (const b of main.querySelectorAll('[data-day]')) b.onclick = () => setDay(parisDay(Number(b.dataset.day)));
    draw();
  }

  function selectDriver(name) {
    driver = name; mode = 'driver'; remember(driver); draw();
    if (!Outils.isWide()) $('#planning-body')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  function draw() {
    const body = $('#planning-body');
    if (!body) return;
    const all = dayRows(day);
    const count = name => all.filter(p => nameKey(p.payload.driver) === nameKey(name)).length;

    // Pastilles : jours rapides et drivers (avec le nombre de lots du jour).
    for (const b of document.querySelectorAll('[data-day]')) b.classList.toggle('active', parisDay(Number(b.dataset.day)) === day);
    $('#driver-chips').innerHTML = `
      <button type="button" class="chip only-narrow ${mode === 'journee' ? 'active' : ''}" data-mode="journee">Toute la journée <b>${all.length}</b></button>
      ${(drivers || []).map(d => `<button type="button" class="chip ${mode === 'driver' && d === driver ? 'active' : ''}" data-driver="${esc(d)}">${esc(d)}${count(d) ? ` <b>${count(d)}</b>` : ''}</button>`).join('')}`;
    for (const b of document.querySelectorAll('[data-driver]')) b.onclick = () => selectDriver(b.dataset.driver);
    const activeChip = $('#driver-chips .chip.active');
    if (activeChip) $('#driver-chips').scrollLeft = Math.max(0, activeChip.offsetLeft - $('#driver-chips').offsetLeft - 40);
    $('[data-mode="journee"]').onclick = () => { mode = 'journee'; draw(); };
    $('#planning-layout').dataset.mode = mode;

    drawOverview(all);

    if (!driver) { body.innerHTML = '<p class="empty-list">Aucun driver trouvé dans la base.</p>'; return; }
    const rows = rowsFor(day, driver);
    const allPlans = rows.map(r => r.payload); // pour reconnaître le travail en Heat
    const tabletNote = nameKey(driver) === 'jeanmarie' ? '' :
      '<p class="note">Les tablettes affichent seulement le planning de Jean-Marie. Ce planning est enregistré et consultable ici.</p>';
    body.innerHTML = `
      <h2 class="day-title">${esc(longDay(day))} · ${esc(driver)}</h2>
      ${tabletNote}
      ${rows.length ? `<ol class="lots">${rows.map((row, i) => {
        const p = row.payload;
        const name = horseName(p.horseId);
        const archived = Api.get('horse', p.horseId)?.payload.active === false;
        return `<li class="lot">
          <span class="lot-number" aria-label="Lot ${i + 1}">${i + 1}</span>
          <span class="lot-horse"><strong>${esc(name)}</strong>
            <small>${esc(workLabel(p, allPlans))}${archived ? ' · archivé' : ''}${done(row.id) ? ' · <span class="ok">séance faite</span>' : ''}</small></span>
          <span class="lot-buttons">
            <button type="button" class="mini" data-move="${i}" data-dir="-1" ${i === 0 ? 'disabled' : ''} aria-label="Monter ${esc(name)}" title="Monter">▲</button>
            <button type="button" class="mini" data-move="${i}" data-dir="1" ${i === rows.length - 1 ? 'disabled' : ''} aria-label="Descendre ${esc(name)}" title="Descendre">▼</button>
            <button type="button" class="mini work ${p.work === 'P' ? 'walk' : ''}" data-work="${i}" aria-label="Changer le travail de ${esc(name)} (T ou P)" title="T = Trotter · P = Promenade">${p.work === 'P' ? 'P' : 'T'}</button>
            <button type="button" class="mini danger" data-remove="${i}" aria-label="Enlever ${esc(name)}" title="Enlever">✕</button>
          </span>
        </li>`;
      }).join('')}</ol>` : '<p class="empty-list">Aucun cheval prévu.</p>'}
      <div class="actions">
        <button type="button" class="button primary" id="add-horse">+ Ajouter un cheval</button>
        ${rows.length ? '<button type="button" class="button" id="copy-day">Recopier ce planning sur un autre jour</button>' : ''}
      </div>
      <p class="muted small-text">T = Trotter (travail) · P = Promenade. Touchez T ou P pour changer.<br>
      Un même cheval mis deux fois en T : la 1re sortie devient « Heat », la suivante « Travail H ».</p>`;

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

  // Vue de toute la journée : chaque driver avec ses lots, en lecture.
  // Toucher un driver ouvre son planning pour le modifier.
  function drawOverview(all) {
    const box = $('#planning-day');
    const groups = new Map();
    for (const row of all.slice().sort(byLot)) {
      const key = nameKey(row.payload.driver);
      if (!groups.has(key)) groups.set(key, { name: niceName(row.payload.driver), rows: [] });
      groups.get(key).rows.push(row);
    }
    const list = [...groups.values()].sort((a, b) => a.name.localeCompare(b.name, 'fr'));
    const horses = new Set(all.map(r => r.payload.horseId)).size;
    box.innerHTML = `
      <h2 class="day-title">${esc(longDay(day))} · toute la journée</h2>
      <p class="muted">${all.length ? `${all.length} sortie${all.length > 1 ? 's' : ''} · ${horses} cheva${horses > 1 ? 'ux' : 'l'} · ${list.length} driver${list.length > 1 ? 's' : ''}` : 'Aucune sortie prévue ce jour-là.'}</p>
      ${list.map(g => {
        const plans = g.rows.map(r => r.payload);
        const match = (drivers || []).find(d => nameKey(d) === nameKey(g.name)) || g.name;
        return `<section class="day-group">
          <button type="button" class="day-group-head" data-open="${esc(match)}"><strong>${esc(match)}</strong><span>${g.rows.length} lot${g.rows.length > 1 ? 's' : ''} · modifier ›</span></button>
          <ol class="day-lots">${g.rows.map((r, i) => `<li><span class="n">${i + 1}</span><span class="h">${esc(horseName(r.payload.horseId))}</span><small>${esc(workLabel(r.payload, plans))}${done(r.id) ? ' · <span class="ok">faite</span>' : ''}</small></li>`).join('')}</ol>
        </section>`;
      }).join('')}`;
    for (const b of box.querySelectorAll('[data-open]')) b.onclick = () => selectDriver(b.dataset.open);
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
      const elsewhere = new Map(dayRows(day).filter(r => nameKey(r.payload.driver) !== nameKey(driver)).map(r => [r.payload.horseId, niceName(r.payload.driver)]));
      const shown = horses.filter(h => nameKey(h.payload.name).includes(key));
      list.innerHTML = shown.length ? shown.map(h => `<li><button type="button" class="row pick" data-horse="${esc(h.id)}">
        <span class="row-text"><strong>${esc(h.payload.name)}</strong>${planned.has(h.id) ? '<small class="tag">Déjà au planning</small>' : elsewhere.has(h.id) ? `<small class="tag soft">Prévu avec ${esc(elsewhere.get(h.id))}</small>` : ''}</span><span class="plus" aria-hidden="true">+</span></button></li>`).join('')
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
