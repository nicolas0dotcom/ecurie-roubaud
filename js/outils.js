// Petits outils partagés par les écrans.
(function () {
  'use strict';

  const $ = (selector, root = document) => root.querySelector(selector);

  // Échappe un texte avant de l'insérer dans le HTML.
  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // Compare des noms sans tenir compte des accents, majuscules, espaces et tirets.
  function nameKey(value) {
    return String(value ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  let toastTimer = null;
  function toast(message, isError = false) {
    const box = $('#toast');
    box.textContent = message;
    box.className = 'toast visible' + (isError ? ' error' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { box.className = 'toast'; }, isError ? 6000 : 3000);
  }

  // Réduit une photo comme le fait la tablette (700 px, JPEG).
  function resizeImage(file, max = 700) {
    if (file.size > 25 * 1024 * 1024) return Promise.reject(new Error('Image trop volumineuse.'));
    return new Promise((resolve, reject) => {
      const image = new Image();
      const url = URL.createObjectURL(file);
      image.onload = () => {
        const ratio = Math.min(1, max / Math.max(image.width, image.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(image.width * ratio);
        canvas.height = Math.round(image.height * ratio);
        canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Image illisible.')); };
      image.src = url;
    });
  }

  // N'accepte que les photos enregistrées par les applis (data:image/...).
  function safePhoto(value) {
    return typeof value === 'string' && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(value) ? value : null;
  }

  // Dates du planning : "AAAA-MM-JJ", à l'heure de Paris comme la tablette.
  function parisDay(offsetDays = 0) {
    const today = new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    return addDays(today, offsetDays);
  }
  function addDays(day, n) {
    const [y, m, d] = day.split('-').map(Number);
    const date = new Date(Date.UTC(y, m - 1, d + n));
    return date.toISOString().slice(0, 10);
  }
  function validDay(day) {
    return /^\d{4}-\d{2}-\d{2}$/.test(day) && addDays(day, 0) === day;
  }
  function longDay(day) {
    const [y, m, d] = day.split('-').map(Number);
    const text = new Intl.DateTimeFormat('fr-FR', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(Date.UTC(y, m - 1, d)));
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  // "kevin" -> "Kevin", "jean marie" -> "Jean Marie".
  function niceName(value) {
    return String(value ?? '').trim().replace(/(^|[\s-])(\p{L})/gu, (all, sep, letter) => sep + letter.toUpperCase());
  }

  window.Outils = { $, esc, nameKey, toast, resizeImage, safePhoto, parisDay, addDays, validDay, longDay, niceName };
})();
