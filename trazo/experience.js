/* TrazoJV / real interface controls. Works alongside the original signing engine. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const landing = $('landing');
  const editor = $('editor');
  const docButton = $('newDocBtn');
  const homeButton = $('homeBtn');
  const continueButton = $('continueEditBtn');
  const closeButton = $('topCloseBtn');
  const downloadButton = $('topDownloadBtn');
  const openButton = $('topOpenBtn');
  const fileName = $('fileName');
  let visitingHome = false;
  let openDocument = false;
  let cachedName = '';

  function sync() {
    const hasEditor = !editor.classList.contains('hidden');
    if (hasEditor) openDocument = true;
    if (!openDocument && !hasEditor) visitingHome = false;
    closeButton.classList.toggle('hidden', !openDocument);
    downloadButton.classList.toggle('hidden', !hasEditor);
    continueButton.classList.toggle('hidden', !openDocument || !visitingHome);
    docButton.classList.remove('hidden');
    const homeActive = !hasEditor;
    homeButton.classList.toggle('is-current', homeActive);
    homeButton.setAttribute('aria-current', homeActive ? 'page' : 'false');
    if ($('editorFileLabel')) $('editorFileLabel').textContent = fileName?.textContent || 'Tu documento';
    document.title = hasEditor ? `${fileName?.textContent || 'Editor'} · TrazoJV` : 'TrazoJV — Firmar PDF';
  }
  $('brandHomeLink').addEventListener('click', event => { event.preventDefault(); homeButton.click(); });
  homeButton.addEventListener('click', () => {
    if (editor.classList.contains('hidden') && !openDocument) return;
    visitingHome = true;
    editor.classList.add('hidden');
    landing.classList.remove('hidden');
    window.scrollTo({top:0,behavior:'smooth'});
    sync();
  });
  continueButton.addEventListener('click', () => {
    if (!openDocument) return;
    visitingHome = false;
    landing.classList.add('hidden');
    editor.classList.remove('hidden');
    sync();
  });
  openButton.addEventListener('click', () => docButton.click());
  // Returning to Inicio must never silently replace an unsigned draft.
  $('dropzone').addEventListener('click', event => {
    if (!openDocument || !visitingHome) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    docButton.click(); // Original engine prompts about unsaved signatures.
  }, true);
  $('dropzone').addEventListener('drop', event => {
    if (!openDocument || !visitingHome) return;
    if (confirm('Al cargar otro PDF se perderán las firmas que no hayas descargado. ¿Continuar?')) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);

  closeButton.addEventListener('click', () => {
    if (!confirm('¿Cerrar este documento? Las firmas que no hayas descargado se perderán.')) return;
    // Completely reset in-memory PDF, password and signature data.
    window.location.reload();
  });
  downloadButton.addEventListener('click', () => $('downloadBtn').click());
  $('prevPageBtn').addEventListener('click', () => navigate(-1));
  $('nextPageBtn').addEventListener('click', () => navigate(1));
  function navigate(direction) {
    const pages = [...document.querySelectorAll('#pdfPages .page-wrapper')];
    if (!pages.length) return;
    const text = $('pageIndicator').textContent || '';
    const current = Math.min(pages.length-1,Math.max(0,(parseInt(text.match(/Página\s+(\d+)/i)?.[1] || '1',10)-1)));
    const target = pages[Math.min(pages.length - 1, Math.max(0, current + direction))];
    const workspace = $('workspace');
    const distance = target.getBoundingClientRect().top - workspace.getBoundingClientRect().top;
    // Solo desplazar el visor, no toda la página ni la barra superior.
    workspace.scrollTo({ top: workspace.scrollTop + distance - 12, behavior: 'smooth' });
  }
  function updatePagination() {
    const total = document.querySelectorAll('#pdfPages .page-wrapper').length;
    const match = ($('pageIndicator').textContent || '').match(/Página\s+(\d+)/i);
    const current = match ? Number(match[1]) : 1;
    $('prevPageBtn').disabled = !total || current <= 1;
    $('nextPageBtn').disabled = !total || current >= total;
  }
  const pageObserver = new MutationObserver(updatePagination);
  pageObserver.observe($('pdfPages'), { childList: true });
  pageObserver.observe($('pageIndicator'), { childList: true, characterData: true, subtree: true });
  const levels=[.5,.75,.9,1,1.25,1.5];
  function zoomBy(delta){
    const sel=$('zoomSelect');
    const current=levels.indexOf(Number(sel.value));
    const ix=current === -1 ? 2 : current;
    const next=levels[Math.max(0,Math.min(levels.length-1,ix+delta))];
    if(Number(sel.value)===next)return;
    sel.value=String(next);
    sel.dispatchEvent(new Event('change',{bubbles:true}));
  }
  $('zoomMinusBtn').addEventListener('click',()=>zoomBy(-1));
  $('zoomPlusBtn').addEventListener('click',()=>zoomBy(1));
  // Observe visibility changes from the PDF engine (upload, open failures).
  const observer=new MutationObserver(() => {
    const displayed = !editor.classList.contains('hidden');
    const name = fileName?.textContent || '';
    if (displayed) visitingHome = false;
    if (displayed && name !== cachedName) { cachedName = name; openDocument = true; }
    sync();
  });
  observer.observe(editor,{attributes:true,attributeFilter:['class']});
  observer.observe(fileName,{childList:true,characterData:true,subtree:true});
  sync();
  updatePagination();
})();