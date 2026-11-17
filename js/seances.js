// Séances terminées : historique avec filtres, et compte rendu d'une séance.
//
// On n'affiche ni les séances du mode démonstration, ni les sorties sans
// cheval attribué. La vitesse affichée est celle du capteur de roue ; la
// comparaison avec le GPS reste possible quand la séance en contient,
// comme sur la tablette.
(function () {
  'use strict';
  const { $, esc, nameKey, toast, niceName, workLabel } = window.Outils;
  const { pace, recoveryReport, measures, phaseTable, channelSpeed, duration } = window.Calculs;

  const filters = { horse: '', driver: '', from: '', to: '' };
  let limit = 50;

  const parisDayOf = ms => new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
  const timeText = ms => new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' }).format(new Date(ms));
  const longDate = ms => { const t = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(ms)); return t.charAt(0).toUpperCase() + t.slice(1); };
  const meters = m => Number.isFinite(m) ? (m >= 1000 ? (m / 1000).toFixed(2).replace('.', ',') + ' km' : Math.round(m) + ' m') : '—';
  const kmh = v => Number.isFinite(v) ? v.toFixed(1).replace('.', ',') + ' km/h' : '—';

  const horseName = s => Api.get('horse', s.payload.horseId)?.payload.name || s.payload.horseName || 'Cheval inconnu';

  // Type de travail d'une séance : Promenade, Trotter, ou Heat / Travail H
  // d'après la sortie du planning à laquelle elle correspond.
  function sessionWork(s) {
    if (s.payload.work === 'P') return 'Promenade';
    const plan = s.payload.planId ? Api.get('plan', s.payload.planId) : null;
    if (!plan) return 'Trotter';
    return workLabel(plan.payload, Api.list('plan').map(p => p.payload));
  }

  // Séances à montrer : terminées, avec un cheval, hors démonstration.
  function finishedSessions() {
    return Api.list('session')
      .filter(s => s.payload.horseId && !s.payload.demo && !s.payload.unassigned && Number.isFinite(s.payload.started))
      .sort((a, b) => b.payload.started - a.payload.started);
  }

  // --- Historique --------------------------------------------------------------
  // presetHorse : filtre venant de l'adresse (#seances/<cheval>) ; undefined = garder les filtres.
  // activeId : séance ouverte à droite sur grand écran (ligne mise en valeur).
  let periodOpen = false;
  function renderList(main, presetHorse, activeId) {
    if (presetHorse !== undefined) { filters.horse = presetHorse; limit = 50; }
    const all = finishedSessions();
    const horses = [...new Map(all.map(s => [s.payload.horseId, horseName(s)])).entries()].sort((a, b) => a[1].localeCompare(b[1], 'fr'));
    const drivers = [...new Map(all.filter(s => s.payload.driver).map(s => [nameKey(s.payload.driver), niceName(s.payload.driver)])).entries()].sort((a, b) => a[1].localeCompare(b[1], 'fr'));
    periodOpen = periodOpen || !!(filters.from || filters.to);
    main.innerHTML = `
      <div class="page-head"><h1>Séances</h1><span class="muted" id="count"></span></div>
      <div class="filter-bar">
        <select id="f-horse" aria-label="Cheval"><option value="">Tous les chevaux</option>${horses.map(([id, name]) => `<option value="${esc(id)}" ${id === filters.horse ? 'selected' : ''}>${esc(name)}</option>`).join('')}</select>
        <select id="f-driver" aria-label="Driver"><option value="">Tous les drivers</option>${drivers.map(([key, name]) => `<option value="${esc(key)}" ${key === filters.driver ? 'selected' : ''}>${esc(name)}</option>`).join('')}</select>
      </div>
      <div class="chips">
        <button type="button" class="chip ${periodOpen ? 'active' : ''}" id="f-period" aria-expanded="${periodOpen}">Période${filters.from || filters.to ? ' •' : ''}</button>
        <button type="button" class="chip" id="f-reset" ${filters.horse || filters.driver || filters.from || filters.to ? '' : 'hidden'}>✕ Effacer les filtres</button>
      </div>
      <div class="period" id="period" ${periodOpen ? '' : 'hidden'}>
        <label>Du<input type="date" id="f-from" value="${esc(filters.from)}"></label>
        <label>Au<input type="date" id="f-to" value="${esc(filters.to)}"></label>
      </div>
      <div id="session-list"></div>
      <div id="more"></div>`;
    const draw = () => {
      const rows = all.filter(s =>
        (!filters.horse || s.payload.horseId === filters.horse) &&
        (!filters.driver || nameKey(s.payload.driver) === filters.driver) &&
        (!filters.from || parisDayOf(s.payload.started) >= filters.from) &&
        (!filters.to || parisDayOf(s.payload.started) <= filters.to));
      $('#count').textContent = rows.length + (rows.length > 1 ? ' séances' : ' séance');
      $('#f-reset').hidden = !(filters.horse || filters.driver || filters.from || filters.to);
      // Regroupées par jour, du plus récent au plus ancien.
      const groups = [];
      for (const s of rows.slice(0, limit)) {
        const d = parisDayOf(s.payload.started);
        if (!groups.length || groups[groups.length - 1].day !== d) groups.push({ day: d, items: [] });
        groups[groups.length - 1].items.push(s);
      }
      $('#session-list').innerHTML = rows.length ? groups.map(g => `
        <h3 class="group-day">${esc(longDate(g.items[0].payload.started))} <small>${g.items.length > 1 ? g.items.length + ' séances' : ''}</small></h3>
        <ul class="rows compact">${g.items.map(s => `
          <li><a class="row${s.id === activeId ? ' current' : ''}" href="#seance/${encodeURIComponent(s.id)}"${s.id === activeId ? ' aria-current="page"' : ''}>
            <span class="row-text">
              <strong>${esc(horseName(s))}</strong>
              <small>${esc(timeText(s.payload.started))}${s.payload.driver ? ' · ' + esc(niceName(s.payload.driver)) : ''} · ${esc(sessionWork(s))}</small>
            </span>
            <span class="row-side"><b>${esc(duration(s.payload.elapsed))}</b><small>${esc(meters(s.payload.distance))}</small></span>
          </a></li>`).join('')}</ul>`).join('') : '<p class="empty-list">Aucune séance pour ces filtres.</p>';
      $('#more').innerHTML = rows.length > limit ? '<button type="button" class="button" id="show-more">Voir les séances plus anciennes</button>' : '';
      if ($('#show-more')) $('#show-more').onclick = () => { limit += 50; draw(); };
    };
    $('#f-horse').onchange = e => { filters.horse = e.target.value; limit = 50; draw(); };
    $('#f-driver').onchange = e => { filters.driver = e.target.value; limit = 50; draw(); };
    $('#f-from').onchange = e => { filters.from = e.target.value; limit = 50; draw(); };
    $('#f-to').onchange = e => { filters.to = e.target.value; limit = 50; draw(); };
    $('#f-period').onclick = () => {
      periodOpen = !periodOpen;
      $('#period').hidden = !periodOpen;
      $('#f-period').classList.toggle('active', periodOpen);
      $('#f-period').setAttribute('aria-expanded', periodOpen);
    };
    $('#f-reset').onclick = () => {
      Object.assign(filters, { horse: '', driver: '', from: '', to: '' });
      periodOpen = false; limit = 50;
      if (location.hash.startsWith('#seances/')) location.hash = '#seances'; else renderList(main, undefined, activeId);
    };
    draw();
  }

  // --- Courbe ------------------------------------------------------------------
  // series : [{ color, read: mesure -> nombre ou null }]. Un trou de plus de
  // 3 secondes n'est pas relié.
  function drawChart(canvas, samples, series, elapsed, unit) {
    const width = canvas.clientWidth || 320, height = 190, left = 34, bottom = 22, top = 10;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = width * ratio; canvas.height = height * ratio;
    const ctx = canvas.getContext('2d');
    ctx.scale(ratio, ratio);
    let min = Infinity, max = -Infinity;
    for (const line of series) for (const s of samples) { const v = line.read(s); if (v !== null) { min = Math.min(min, v); max = Math.max(max, v); } }
    if (!Number.isFinite(max)) return false;
    // Graduations rondes : 4 intervalles de 5, 10, 20, 25 ou 50.
    if (unit === 'km/h') min = 0;
    const step = [5, 10, 20, 25, 50, 100].find(st => Math.ceil(max / st) * st - Math.floor(min / st) * st <= 4 * st) || 100;
    min = Math.floor(min / step) * step;
    max = min + 4 * step;
    const total = Math.max(elapsed || 0, samples.length ? samples[samples.length - 1].t : 0, 1);
    const x = t => left + t / total * (width - left - 6);
    const y = v => top + (1 - (v - min) / (max - min)) * (height - top - bottom);
    ctx.font = '11px system-ui, sans-serif';
    ctx.fillStyle = themeColor('--chart-text', '#5b5b5b'); ctx.strokeStyle = themeColor('--chart-grid', '#e1e1dc'); ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const v = min + (max - min) * i / 4, yy = y(v);
      ctx.beginPath(); ctx.moveTo(left, yy); ctx.lineTo(width - 6, yy); ctx.stroke();
      ctx.fillText(String(Math.round(v)), 2, yy + 4);
    }
    ctx.fillText('0:00', left, height - 6);
    const end = duration(total); ctx.fillText(end, width - 6 - ctx.measureText(end).width, height - 6);
    for (const line of series) {
      ctx.strokeStyle = line.color; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.beginPath();
      let pen = false, previous = null;
      for (const s of samples) {
        const v = line.read(s);
        if (v === null) { pen = false; continue; }
        if (!pen || s.t - previous > 3) ctx.moveTo(x(s.t), y(v)); else ctx.lineTo(x(s.t), y(v));
        pen = true; previous = s.t;
      }
      ctx.stroke();
    }
    return true;
  }

  // Couleur définie par le thème (themes/*.css).
  function themeColor(name, fallback) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
  }

  // --- Compte rendu --------------------------------------------------------------
  const READING_TEXT = { green: 'Dans la plage de référence', orange: 'Au-dessus du repère', red: 'Seuil rouge dépassé', below: 'Sous la plage de référence' };
  function reading(r, minutes) {
    const label = r && r.hr != null ? r.hr + ' bpm' : r && r.status === 'pending' ? 'En attente' : 'Non mesuré';
    const color = r && r.color || 'gray';
    const meaning = READING_TEXT[color] || label;
    return `<div class="reading"><span>À ${minutes} min</span><strong${r && r.hr != null ? '' : ' class="none"'}>${esc(label)}</strong><i class="dot ${esc(color)}" role="img" aria-label="${esc(meaning)}" title="${esc(meaning)}"></i>${color !== 'gray' ? `<small>${esc(meaning)}</small>` : ''}</div>`;
  }

  async function renderReport(main, id) {
    const record = Api.get('session', id);
    if (!record || record.payload.demo || record.payload.unassigned || !record.payload.horseId) {
      main.innerHTML = '<p class="empty-list">Séance introuvable.</p><a class="button" href="#seances">Toutes les séances</a>'; return;
    }
    const s = record.payload;
    const back = filters.horse ? '#seances/' + encodeURIComponent(filters.horse) : '#seances';
    main.innerHTML = `
      <a class="back" href="${back}">‹ Séances</a>
      <h1>${esc(horseName(record))}</h1>
      <p class="muted">${esc(longDate(s.started))} · ${esc(timeText(s.started))}</p>
      <p class="loading">Chargement des mesures…</p>`;
    let samples = [];
    try { samples = await Api.sessionSamples(id); } catch (error) { toast(error.message, true); }
    if (location.hash !== '#seance/' + encodeURIComponent(id)) return; // on a changé d'écran entre-temps

    const saved = s.recovery && Array.isArray(s.recovery.phases) ? s.recovery : null;
    const config = { thresholds: saved ? saved.initialThresholds : undefined };
    const recovery = saved || recoveryReport({ ...s, samples, finished: true }, config);
    // Les anciennes séances n'enregistraient pas tous les seuils : on complète avec les valeurs par défaut.
    const limits = Calculs.recoveryThresholds(s.recoveryInitialThresholds || recovery.thresholds || {});
    const m = measures(samples);
    const maxHr = m.maxHr ?? s.summary?.maxHr ?? null;
    const avgHr = m.avgHr ?? s.summary?.avgHr ?? null;
    const phases = samples.length ? phaseTable(s, samples, config) : null;
    const hasHr = samples.some(x => Number.isFinite(x.hr) && x.hr > 0);
    const hasWheel = m.maxWheel !== null;

    main.querySelector('.loading').remove();
    main.insertAdjacentHTML('beforeend', `
      <section class="card">
        <h2>1. Récupération</h2>
        ${recovery.phases.length ? recovery.phases.map((p, i) => `
          <article class="recovery">
            <h3>Récupération ${i + 1} · début à ${esc(duration(p.start))}</h3>
            <div class="readings">${reading(p.two, 2)}${reading(p.five, 5)}</div>
            ${p.interrupted ? '<small class="muted">Nouvel effort avant la fin de la récupération.</small>' : ''}
          </article>`).join('') : '<p>Aucune récupération détectée (pas de passage confirmé du travail à la récupération).</p>'}
        <p class="muted small-text">Repères : à 2 min, orange au-dessus de ${limits.twoMax} bpm, rouge au-dessus de ${limits.twoRed} bpm ; à 5 min, orange au-dessus de ${limits.fiveMax} bpm, rouge au-dessus de ${limits.fiveRed} bpm.${saved ? '' : ' Calculé à partir des mesures enregistrées.'}</p>
      </section>

      <section class="card">
        <h2>2. Fréquence cardiaque</h2>
        <div class="stats">
          <div><strong>${maxHr ?? '—'}</strong><span>bpm maximum</span></div>
          <div><strong>${avgHr ?? '—'}</strong><span>bpm en moyenne</span></div>
        </div>
        ${hasHr ? '<canvas class="chart" id="hr-chart" role="img" aria-label="Courbe de fréquence cardiaque"></canvas><small class="muted">bpm · les coupures du signal sont laissées vides.</small>' : '<p class="muted">Pas de mesure cardiaque enregistrée.</p>'}
      </section>

      <section class="card">
        <h2>3. Vitesse <small class="muted">(capteur de roue)</small></h2>
        ${hasWheel ? `
          <div class="stats">
            <div><strong>${esc(pace(m.maxWheel))}</strong><span>meilleure réduction</span></div>
            <div><strong>${esc(kmh(m.avgWheel))}</strong><span>vitesse moyenne</span></div>
          </div>
          ${m.hasGps ? '<label class="check"><input type="checkbox" id="compare-gps"> Comparer avec le GPS</label><p class="legend" id="legend" hidden><span class="wheel">● Capteur de roue</span> <span class="gps">● GPS</span></p>' : ''}
          <canvas class="chart" id="speed-chart" role="img" aria-label="Courbe de vitesse du capteur de roue"></canvas>
          <small class="muted">km/h · moyenne sur ${esc(duration(m.wheelSeconds))} de mesures continues.</small>`
          : '<p class="muted">Pas de mesure du capteur de roue pour cette séance.</p>'}
      </section>

      <section class="card">
        <h2>4. Travail par phase</h2>
        ${phases ? `<div class="table-wrap"><table class="phases">
          <thead><tr><th>Phase</th><th>Durée</th><th>Distance</th><th>Réduction</th></tr></thead>
          <tbody>${phases.map(r => `<tr><th scope="row">${esc(r.label)}</th><td>${esc(r.seconds ? duration(r.seconds) : '—')}</td><td>${esc(r.seconds ? meters(r.distance) : '—')}</td><td>${esc(pace(r.kmh))}</td></tr>`).join('')}</tbody>
        </table></div>
        <p class="muted small-text">Travail à partir de ${limits.workKmh} km/h ; récupération sous ${limits.recoveryStartKmh} km/h. Calculé sur les mesures continues.</p>`
          : '<p class="muted">Mesures détaillées indisponibles.</p>'}
      </section>

      <section class="card">
        <h2>5. Infos générales</h2>
        <dl class="infos">
          <dt>Date</dt><dd>${esc(longDate(s.started))}</dd>
          <dt>Heure</dt><dd>${esc(timeText(s.started))}${Number.isFinite(s.ended) ? ' – ' + esc(timeText(s.ended)) : ''}</dd>
          <dt>Driver</dt><dd>${esc(s.driver ? niceName(s.driver) : '—')}</dd>
          <dt>Travail</dt><dd>${esc(sessionWork(record))}</dd>
          <dt>Durée totale</dt><dd>${esc(duration(s.elapsed))}</dd>
          <dt>Distance totale</dt><dd>${esc(meters(s.distance))}</dd>
        </dl>
      </section>`);

    const drawAll = () => {
      if ($('#hr-chart')) drawChart($('#hr-chart'), samples, [{ color: themeColor('--chart-hr', '#a3221b'), read: x => Number.isFinite(x.hr) && x.hr > 0 && x.hr <= 250 ? x.hr : null }], s.elapsed, 'bpm');
      if ($('#speed-chart')) {
        const compare = $('#compare-gps')?.checked;
        const series = [{ color: themeColor('--chart-wheel', '#5b1f79'), read: x => channelSpeed(x, 'wheel') }];
        if (compare) series.push({ color: themeColor('--chart-gps', '#16799a'), read: x => channelSpeed(x, 'gps') });
        drawChart($('#speed-chart'), samples, series, s.elapsed, 'km/h');
        if ($('#legend')) $('#legend').hidden = !compare;
      }
    };
    if ($('#compare-gps')) $('#compare-gps').onchange = drawAll;
    drawAll();
    window.onresize = () => { if ($('#speed-chart') || $('#hr-chart')) drawAll(); };
  }

  window.Seances = { renderList, renderReport, finishedSessions };
})();
