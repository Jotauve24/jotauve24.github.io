/* TrazoJV Motion Controller — transient visual feedback only.
   No cookies, analytics, storage, documents or network requests. */
(() => {
  'use strict';
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const canAnimate = () => !reducedMotion.matches && typeof Element.prototype.animate === 'function';
  const root = document.getElementById('pdfPages');
  const library = document.getElementById('signatureLibrary');
  const documentCard = document.querySelector('.document-info');
  if (!root || !library) return;

  const flash = (element, className, ms) => {
    if (!element || reducedMotion.matches) return;
    element.classList.remove(className);
    // Restart on deliberate repeated actions, not on scroll or hover.
    void element.offsetWidth;
    element.classList.add(className);
    element.addEventListener('animationend', () => element.classList.remove(className), { once: true });
  };

  document.addEventListener('trazo:pdf-opened', () => {
    flash(documentCard, 'motion-doc-loaded');
  });

  document.addEventListener('trazo:signature-created', () => {
    const newest = library.querySelector('.signature-item:last-of-type');
    flash(newest, 'motion-signature-added');
  });

  document.addEventListener('trazo:export-ready', () => {
    if (!canAnimate()) return;
    const button = document.getElementById('topDownloadBtn');
    if (!button || button.classList.contains('hidden')) return;
    button.animate([
      { transform: 'scale(1)' },
      { transform: 'scale(1.025)', offset: .45 },
      { transform: 'scale(1)' }
    ], { duration: 360, easing: 'ease-out' });
  });

  document.addEventListener('trazo:stamp-added', (event) => {
    if (!canAnimate()) return;
    const id = event.detail?.stampId;
    if (!id) return;
    // The application owns signature coordinates; animate a temporary visual cue
    // without changing the actual position, drag handler or exported PDF.
    const el = Array.from(root.querySelectorAll('.sig-stamp'))
      .find(item => item.dataset.id === id);
    if (!el) return;
    el.animate([
      { opacity: .72, filter: 'drop-shadow(0 0 0 rgba(93,101,233,0))' },
      { opacity: 1, filter: 'drop-shadow(0 0 7px rgba(93,101,233,.14))', offset: .50 },
      { opacity: 1, filter: 'drop-shadow(0 0 0 rgba(93,101,233,0))' }
    ], { duration: 390, easing: 'ease-out' });
  });
})();