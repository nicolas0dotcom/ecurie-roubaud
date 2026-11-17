// Calculs du compte rendu de séance.
//
// pace, recoveryThresholds, recoveryColor et recoveryReport sont repris
// tels quels de l'appli de la tablette (public/core.js) pour donner
// exactement les mêmes résultats. recoveryReport accepte en plus un
// rappel « onSample » qui indique la phase (échauffement, travail,
// récupération) de chaque mesure : il sert au tableau « Travail par phase ».
//
// Une mesure (échantillon) ressemble à :
//   { t: secondes depuis le début, speed, speedSource: "wheel" | "gps",
//     wheelSpeed, gpsSpeed, hr, hrAge, distance: mètres cumulés }
(function () {
  'use strict';

  // Réduction kilométrique : temps pour 1 km, ex. 1′16″5.
  function pace(kmh) {
    if (!Number.isFinite(kmh) || kmh <= 0) return '—';
    const tenths = Math.round(36000 / kmh);
    return `${Math.floor(tenths / 600)}′${String(Math.floor(tenths % 600 / 10)).padStart(2, '0')}″${tenths % 10}`;
  }

  function recoveryThresholds(value = {}) {
    const read = (key, fallback) => Number.isFinite(value[key]) ? value[key] : fallback;
    const twoMax = read('twoMax', 120), fiveMax = read('fiveMax', 90);
    const workKmh = Math.max(10, Math.min(60, read('workKmh', 25))), restartKmh = Math.max(10, Math.min(60, read('restartKmh', workKmh)));
    const recoveryValue = read('recoveryStartKmh', 15), recoveryStartKmh = Math.max(1, recoveryValue < Math.min(workKmh, restartKmh) ? recoveryValue : Math.min(workKmh, restartKmh) - 1), restartSeconds = Math.max(10, Math.min(600, read('restartSeconds', 60)));
    const warmupKmh = Math.max(0, Math.min(workKmh - .1, read('warmupKmh', 1.5))), recoveryConfirmSeconds = Math.max(1, Math.min(60, read('recoveryConfirmSeconds', 5)));
    return { twoMax, fiveMax, twoRed: Math.max(twoMax, read('twoRed', 140)), fiveRed: Math.max(fiveMax, read('fiveRed', 110)), warmupKmh, workKmh, recoveryStartKmh, recoveryConfirmSeconds, restartKmh, restartSeconds };
  }

  function recoveryColor(hr, seconds, thresholds) {
    if (!Number.isFinite(hr) || hr <= 0 || hr > 250) return 'gray';
    const max = seconds === 120 ? thresholds.twoMax : thresholds.fiveMax, red = seconds === 120 ? thresholds.twoRed : thresholds.fiveRed;
    if (hr > red) return 'red'; if (hr > max) return 'orange';
    return hr < (seconds === 120 ? 80 : 60) ? 'below' : 'green';
  }

  const RECOVERY_READINGS = [['two', 120], ['five', 300]];

  function recoveryReport(session, config = {}, onSample = null) {
    const initialThresholds = recoveryThresholds(session.recoveryInitialThresholds || config.thresholds || config), phases = [];
    const changes = (session.recoveryChanges || []).filter(x => x && Number.isFinite(x.at) && x.at >= 0 && x.thresholds).map(x => ({ at: x.at, thresholds: recoveryThresholds(x.thresholds) })).sort((a, b) => a.at - b.at);
    let thresholds = initialThresholds, changeIndex = 0, lastSpeed = null;
    let status = 'warmup', candidate = null, restart = null, current = null, previous = null;
    for (const sample of session.samples || []) {
      const t = sample.t; if (!Number.isFinite(t) || t < 0) continue;
      const gap = previous === null || t - previous > 3 || t <= previous; previous = t;
      while (changeIndex < changes.length && t > changes[changeIndex].at) { const next = changes[changeIndex++].thresholds; if (next.recoveryStartKmh !== thresholds.recoveryStartKmh || next.recoveryConfirmSeconds !== thresholds.recoveryConfirmSeconds) candidate = null; if (next.restartKmh !== thresholds.restartKmh || next.restartSeconds !== thresholds.restartSeconds) restart = null; thresholds = next; }
      const speed = sample.speed, valid = Number.isFinite(speed) && speed >= 0 && speed <= 100;
      lastSpeed = valid ? speed : null;
      if (gap || !valid) { candidate = null; restart = null; }
      if (valid) {
        if (status === 'warmup' && speed >= thresholds.workKmh) status = 'work';
        if (status === 'work') {
          if (speed < thresholds.recoveryStartKmh) {
            if (candidate === null) candidate = t;
            if (t - candidate >= thresholds.recoveryConfirmSeconds) { current = { start: candidate, confirmedAt: t, two: null, five: null }; phases.push(current); status = 'recovery'; candidate = null; }
          } else candidate = null;
        } else if (status === 'recovery') {
          if (speed >= thresholds.restartKmh) {
            if (restart === null) restart = t;
            if (t - restart >= thresholds.restartSeconds) { current.endedAt = t; current.interrupted = t < current.start + 300; current = null; status = 'work'; restart = null; }
          } else restart = null;
        }
      }
      if (onSample) onSample(sample, status);
      if (current) {
        for (const [key, delay] of RECOVERY_READINGS) {
          const age = t - (current.start + delay);
          if (!current[key] && age >= 0 && age <= 2 && Number.isFinite(sample.hr) && sample.hr > 0 && sample.hr <= 250 && (!Number.isFinite(sample.hrAge) || sample.hrAge <= 2)) {
            current[key] = { hr: Math.round(sample.hr), at: t, color: recoveryColor(sample.hr, delay, thresholds) };
          }
        }
      }
    }
    const elapsed = Number.isFinite(session.elapsed) ? session.elapsed : (previous || 0);
    for (const phase of phases) {
      for (const [key, delay] of RECOVERY_READINGS) if (!phase[key]) phase[key] = { hr: null, color: 'gray', status: phase.interrupted || session.finished || session.ended || elapsed > phase.start + delay + 2 ? 'missing' : 'pending' };
      phase.alertShown = !!config.alerts?.[String(phase.start)];
    }
    return { version: 5, initialThresholds, changes, thresholds, phases, status, displayStatus: status === 'warmup' && lastSpeed !== null && lastSpeed < thresholds.warmupKmh ? 'idle' : status };
  }

  // Vitesse d'un capteur précis pour une mesure (repris de speed-comparison.js).
  function channelSpeed(sample, channel) {
    const field = channel === 'wheel' ? 'wheelSpeed' : 'gpsSpeed';
    if (Object.prototype.hasOwnProperty.call(sample, field)) return Number.isFinite(sample[field]) ? sample[field] : null;
    return sample.speedSource === channel && Number.isFinite(sample.speed) ? sample.speed : null;
  }

  // Cardio et vitesse du capteur de roue. Les moyennes sont pondérées par
  // le temps ; un trou de plus de 3 secondes n'est pas compté.
  function measures(samples) {
    let hrSum = 0, hrTime = 0, maxHr = null, wheelSum = 0, wheelTime = 0, maxWheel = null, hasGps = false, previous = null;
    for (const s of samples) {
      if (!Number.isFinite(s.t)) continue;
      const dt = previous !== null && s.t > previous && s.t - previous <= 3 ? s.t - previous : 0;
      previous = s.t;
      if (Number.isFinite(s.hr) && s.hr > 0 && s.hr <= 250) {
        if (maxHr === null || s.hr > maxHr) maxHr = s.hr;
        hrSum += s.hr * dt; hrTime += dt;
      }
      const wheel = channelSpeed(s, 'wheel');
      if (wheel !== null && wheel >= 0 && wheel <= 100) {
        if (maxWheel === null || wheel > maxWheel) maxWheel = wheel;
        wheelSum += wheel * dt; wheelTime += dt;
      }
      if (channelSpeed(s, 'gps') !== null) hasGps = true;
    }
    return {
      avgHr: hrTime > 0 ? Math.round(hrSum / hrTime) : null,
      maxHr: maxHr === null ? null : Math.round(maxHr),
      avgWheel: wheelTime > 0 ? wheelSum / wheelTime : null,
      maxWheel, wheelSeconds: wheelTime, hasGps
    };
  }

  // Durée, distance et réduction de chaque phase (échauffement, travail,
  // récupération), selon les mêmes seuils que les récupérations.
  function phaseTable(session, samples, config) {
    const rows = { warmup: { seconds: 0, distance: 0 }, work: { seconds: 0, distance: 0 }, recovery: { seconds: 0, distance: 0 } };
    let previous = null;
    recoveryReport({ ...session, samples }, config, (sample, status) => {
      if (previous && sample.t > previous.t && sample.t - previous.t <= 3) {
        const row = rows[status];
        row.seconds += sample.t - previous.t;
        const step = Number.isFinite(sample.distance) && Number.isFinite(previous.distance) ? sample.distance - previous.distance : null;
        if (step !== null && step >= 0) row.distance += step;
      }
      previous = sample;
    });
    return [['warmup', 'Échauffement'], ['work', 'Travail'], ['recovery', 'Récupération']].map(([key, label]) => {
      const r = rows[key];
      return { key, label, seconds: r.seconds, distance: r.distance, kmh: r.seconds > 0 && r.distance > 0 ? r.distance / r.seconds * 3.6 : null };
    });
  }

  function duration(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return '—';
    const s = Math.round(seconds), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), r = s % 60;
    return h ? `${h} h ${String(m).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
  }

  window.Calculs = { pace, recoveryThresholds, recoveryColor, recoveryReport, channelSpeed, measures, phaseTable, duration };
})();
