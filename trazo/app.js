/* Trazo — editor de firma PDF local. JavaScript sin frameworks.
   PDF.js (Apache-2.0) renderiza; pdf-lib (MIT) incorpora las firmas.
   No hay llamadas de red que envíen el contenido de tus PDFs. */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
  const state = {
    file: null, originalBytes: null, pdf: null, pages: [],
    signatures: [], placements: [], selectedId: null, activePage: 0,
    zoom: 1, mode: 'draw', chosenFont: 'script', uploadedImage: null,
    hasDrawn: false, busy: false, drag: null, renderId: 0,
  };
  const fontStyles = {
    script: '"Brush Script MT", "Segoe Script", "Snell Roundhand", cursive',
    elegant: '"URW Chancery L", "Apple Chancery", "Segoe Script", cursive',
    serif: 'Georgia, "Times New Roman", serif',
  };
  let toastTimer = 0;
  const scriptDependenciesOkay = () => !!(window.pdfjsLib && window.PDFLib);

  function notify(message, error = false) {
    const toast = $('toast');
    clearTimeout(toastTimer);
    toast.textContent = message;
    toast.classList.toggle('error', error);
    toast.classList.add('visible');
    toastTimer = setTimeout(() => toast.classList.remove('visible'), 3500);
  }
  function busy(value, title = '', detail = '') {
    state.busy = value;
    $('loadingOverlay').classList.toggle('hidden', !value);
    if (title) $('loadingTitle').textContent = title;
    if (detail) $('loadingDetail').textContent = detail;
  }
  function formatBytes(bytes) {
    return bytes < 1048576 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1048576).toFixed(1)} MB`;
  }
  const uid = () => String(Date.now()) + '-' + Math.random().toString(36).slice(2, 8);
  function htmlSafe(str) { const div = document.createElement('div'); div.textContent = str; return div.innerHTML; }

  function filePicker() { $('pdfFileInput').click(); }
  $('selectFileBtn').addEventListener('click', (e) => { e.stopPropagation(); filePicker(); });
  $('dropzone').addEventListener('click', (e) => { if (!e.target.closest('#selectFileBtn')) filePicker(); });
  $('dropzone').addEventListener('keydown', (e) => { if (e.target === $('dropzone') && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); filePicker(); }});
  $('newDocBtn').addEventListener('click', () => {
    if (state.placements.length && !confirm('Si cambias de PDF, se perderán las firmas colocadas que aún no hayas descargado. ¿Continuar?')) return;
    filePicker();
  });
  $('pdfFileInput').addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) await openPdf(file);
  });
  ['dragenter','dragover'].forEach(name => $('dropzone').addEventListener(name, (e) => { e.preventDefault(); $('dropzone').classList.add('dragover'); }));
  ['dragleave','drop'].forEach(name => $('dropzone').addEventListener(name, (e) => { e.preventDefault(); $('dropzone').classList.remove('dragover'); }));
  $('dropzone').addEventListener('drop', (e) => { if (e.dataTransfer.files?.length) openPdf(e.dataTransfer.files[0]); });
  document.addEventListener('dragover', (e) => { if ([...e.dataTransfer?.types ?? []].includes('Files')) e.preventDefault(); });
  document.addEventListener('drop', (e) => { if (e.target.closest('#dropzone')) return; e.preventDefault(); });

  // PDF.js abre PDFs cifrados con una contraseña válida. pdf-lib no admite
  // cifrado: QPDF/WASM hace una copia descifrada en memoria para conservar vectores.
  // Si QPDF no está disponible, una copia visual es el último recurso, previo aviso.
  const WASM_QPDF_URL = 'https://cdn.jsdelivr.net/npm/qpdf-wasm-esm-embedded@1.1.1/qpdf.mjs';
  let qpdfPromise = null;
  function pauseLoaderForDialog(showDialog) {
    $('loadingOverlay').classList.toggle('hidden', showDialog);
  }
  function securePrompt(modalId, submitId, cancelId, getValue) {
    return new Promise(resolve => {
      const modal = $(modalId);
      const cancel = $(cancelId);
      const submit = $(submitId);
      const submitEventName = submit.tagName === 'FORM' ? 'submit' : 'click';
      let done = false;
      const finish = value => {
        if (done) return;
        done = true;
        modal.classList.add('hidden');
        pauseLoaderForDialog(false);
        cancel.removeEventListener('click', onCancel);
        submit.removeEventListener(submitEventName, onSubmit);
        modal.removeEventListener('click', onBackdrop);
        document.removeEventListener('keydown', onEscape, true);
        resolve(value);
      };
      const onCancel = () => finish(null);
      const onSubmit = event => {
        event.preventDefault();
        const value = getValue();
        if (value !== null) finish(value);
      };
      const onBackdrop = event => { if (event.target === modal) finish(null); };
      const onEscape = event => { if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); finish(null); } };
      pauseLoaderForDialog(true);
      modal.classList.remove('hidden');
      cancel.addEventListener('click', onCancel);
      submit.addEventListener(submitEventName, onSubmit);
      modal.addEventListener('click', onBackdrop);
      document.addEventListener('keydown', onEscape, true);
      const focusTarget = modal.querySelector('input:not([type=checkbox])') || submit;
      focusTarget.focus();
    });
  }
  async function askPdfPassword(wrongPassword = false) {
    $('pdfPassword').value = '';
    $('pdfPassword').type = 'password';
    $('togglePdfPassword').textContent = 'Mostrar';
    $('passwordAuthorized').checked = false;
    $('passwordError').classList.toggle('hidden', !wrongPassword);
    const response = await securePrompt('passwordModal', 'passwordForm', 'cancelPasswordBtn', () => {
      if (!$('passwordAuthorized').checked || !$('pdfPassword').value) return null;
      return $('pdfPassword').value;
    });
    $('pdfPassword').value = '';
    return response;
  }
  $('togglePdfPassword').addEventListener('click', () => {
    const input = $('pdfPassword');
    input.type = input.type === 'password' ? 'text' : 'password';
    $('togglePdfPassword').textContent = input.type === 'password' ? 'Mostrar' : 'Ocultar';
  });
  async function authorizeVisualCopy() {
    $('fallbackAuthorized').checked = false;
    $('acceptFallbackBtn').disabled = true;
    $('fallbackAuthorized').onchange = () => { $('acceptFallbackBtn').disabled = !$('fallbackAuthorized').checked; };
    const response = await securePrompt('fallbackModal', 'acceptFallbackBtn', 'cancelFallbackBtn', () => $('fallbackAuthorized').checked ? true : null);
    return response === true;
  }
  function isPdfPasswordError(err) {
    return err?.name === 'PasswordException' || (err?.code === 1 || err?.code === 2) && /password|contraseña/i.test(String(err?.message || ''));
  }
  function isPdfEncryptedError(err) {
    return err?.name === 'EncryptedPDFError' || /encrypted|cifrad|password/i.test(String(err?.message || ''));
  }
  async function loadPdfWithPassword(bytes) {
    let password = '';
    let requiredPassword = false;
    let wrong = false;
    for (let attempt = 0; attempt < 6; attempt++) {
      let task = null;
      try {
        task = pdfjsLib.getDocument({ data: bytes.slice(), useSystemFonts: true, ...(password ? {password} : {}) });
        const pdf = await task.promise;
        return { pdf, password, requiredPassword };
      } catch (err) {
        if (task) await task.destroy().catch(() => {});
        if (!isPdfPasswordError(err)) throw err;
        requiredPassword = true;
        const enteredPassword = await askPdfPassword(wrong);
        if (enteredPassword === null) throw new Error('TRAZO_CANCELLED');
        password = enteredPassword;
        wrong = true;
        $('loadingDetail').textContent = 'Desbloqueando el documento';
      } finally {
        // La contraseña de cada intento vive solo en memoria mientras se abre el PDF.
      }
    }
    throw new Error('TRAZO_MAX_PASSWORD_ATTEMPTS');
  }
  async function decryptWithQpdf(sourceBytes, password) {
    if (!qpdfPromise) {
      qpdfPromise = import(WASM_QPDF_URL).then(m => m.default({ print: () => {}, printErr: line => console.debug('[QPDF]', line) }));
    }
    const qpdf = await qpdfPromise;
    const id = `trazo${Date.now()}${Math.random().toString(36).slice(2)}`;
    const input = `/${id}-input.pdf`;
    const output = `/${id}-output.pdf`;
    try {
      qpdf.FS.writeFile(input, sourceBytes);
      const exitCode = qpdf.callMain([`--password=${password}`, '--decrypt', input, output]);
      if (exitCode !== 0) throw new Error(`QPDF falló (${exitCode})`);
      return new Uint8Array(qpdf.FS.readFile(output));
    } finally {
      try { qpdf.FS.unlink(input); } catch (_) {}
      try { qpdf.FS.unlink(output); } catch (_) {}
    }
  }

  async function openPdf(file) {
    if (state.busy) return;
    if (!file.name.toLowerCase().endsWith('.pdf') && file.type !== 'application/pdf') return notify('Selecciona un archivo PDF.', true);
    if (file.size > 50 * 1024 * 1024) return notify('El tamaño máximo es de 50 MB.', true);
    if (!file.size) return notify('El archivo está vacío.', true);
    if (!scriptDependenciesOkay()) return notify('No se pudieron cargar las bibliotecas. Comprueba la conexión a Internet y recarga la página.', true);
    busy(true, 'Abriendo tu PDF…', 'Leyendo el documento');
    let pdf = null;
    let etapa = 'lectura';
    try {
      pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      const bytes = new Uint8Array(await file.arrayBuffer());
      etapa = 'visualización';
      const access = await loadPdfWithPassword(bytes);
      pdf = access.pdf;
      let editableBytes = bytes;
      let exportMode = 'vector';
      let protectedPdf = access.requiredPassword;
      etapa = 'edición';
      try {
        await PDFLib.PDFDocument.load(editableBytes.slice());
      } catch (err) {
        if (!isPdfEncryptedError(err)) throw err;
        protectedPdf = true;
        etapa = 'desbloqueo';
        $('loadingTitle').textContent = 'Preparando PDF protegido…';
        $('loadingDetail').textContent = 'Conservando páginas y calidad original';
        try {
          editableBytes = await decryptWithQpdf(bytes, access.password);
          await PDFLib.PDFDocument.load(editableBytes.slice());
        } catch (wasmError) {
          console.warn('[Trazo] Motor de desbloqueo no disponible:', wasmError);
          const allowed = await authorizeVisualCopy();
          if (!allowed) throw new Error('TRAZO_CANCELLED');
          exportMode = 'visual';
          editableBytes = new Uint8Array(0);
        }
      }
      const previousPdf = state.pdf;
      state.file = file;
      state.originalBytes = editableBytes;
      state.exportMode = exportMode;
      state.pdf = pdf;
      state.pages = [];
      state.placements = [];
      state.selectedId = null;
      state.activePage = 0;
      state.zoom = window.innerWidth <= 640 ? 0.5 : window.innerWidth <= 870 ? 0.75 : 1;
      $('zoomSelect').value = String(state.zoom);
      $('landing').classList.add('hidden');
      $('editor').classList.remove('hidden');
      $('newDocBtn').classList.remove('hidden');
      $('fileName').textContent = file.name;
      $('fileInfo').textContent = `${pdf.numPages} ${pdf.numPages === 1 ? 'página' : 'páginas'} · ${formatBytes(file.size)}`;
      const status = $('protectionStatus');
      status.classList.toggle('hidden', !protectedPdf);
      status.textContent = exportMode === 'visual' ? '🔒 PDF protegido · copia visual sin contraseña al descargar' : '🔓 PDF protegido · descarga sin contraseña original';
      updateSignatureLibrary();
      updateSelectionPanel();
      updateCount();
      etapa = 'renderizado';
      await renderPdf();
      if (previousPdf && previousPdf !== pdf) previousPdf.destroy().catch(() => {});
      notify(exportMode === 'visual' ? 'PDF preparado. Se generará una copia visual cuando lo firmes.' : 'PDF listo. Crea o selecciona una firma para colocarla.');
    } catch (err) {
      if (err?.message === 'TRAZO_CANCELLED') return;
      console.error(`[Trazo] Error en la etapa de ${etapa}:`, err);
      let mensaje = 'No fue posible abrir este PDF. Comprueba que el archivo no esté dañado.';
      if (err?.message === 'TRAZO_MAX_PASSWORD_ATTEMPTS') {
        mensaje = 'Demasiados intentos de contraseña. Vuelve a seleccionar el PDF para intentarlo otra vez.';
      } else if (isPdfPasswordError(err)) {
        mensaje = 'El PDF está protegido. Se necesita una contraseña válida para abrirlo.';
      } else if (etapa === 'visualización' || etapa === 'renderizado') {
        mensaje = 'No se pudo visualizar el PDF. Comprueba la conexión a Internet y vuelve a intentarlo.';
      } else if (etapa === 'edición') {
        mensaje = 'El PDF tiene una estructura que el editor no puede modificar directamente.';
      }
      notify(mensaje, true);
      if (state.pdf === pdf) {
        state.pdf = null;
        state.originalBytes = null;
        state.pages = [];
        state.placements = [];
        state.file = null;
      }
    } finally {
      if (pdf && state.pdf !== pdf) pdf.destroy().catch(() => {});
      if (!state.pdf) { $('editor').classList.add('hidden'); $('landing').classList.remove('hidden'); $('newDocBtn').classList.add('hidden'); }
      busy(false);
    }
  }

  async function renderPdf() {
    if (!state.pdf) return;
    const renderId = ++state.renderId;
    const pagesRoot = $('pdfPages');
    pagesRoot.replaceChildren();
    state.pages = [];
    const dpr = Math.min(window.devicePixelRatio || 1, 1.75);
    for (let i = 0; i < state.pdf.numPages; i++) {
      if (renderId !== state.renderId) return;
      $('loadingDetail').textContent = `Preparando página ${i + 1} de ${state.pdf.numPages}`;
      const pdfPage = await state.pdf.getPage(i + 1);
      const viewport = pdfPage.getViewport({ scale: 1.12 * state.zoom });
      const wrap = document.createElement('div');
      wrap.className = 'page-wrapper';
      wrap.dataset.page = String(i);
      const label = document.createElement('div');
      label.className = 'page-label'; label.textContent = `PÁGINA ${i + 1}`;
      const sheet = document.createElement('div');
      sheet.className = 'page-sheet';
      sheet.dataset.page = String(i);
      sheet.style.width = `${viewport.width}px`;
      sheet.style.height = `${viewport.height}px`;
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width * dpr);
      canvas.height = Math.ceil(viewport.height * dpr);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      const overlay = document.createElement('div');
      overlay.className = 'signature-overlay';
      sheet.append(canvas, overlay); wrap.append(label, sheet); pagesRoot.append(wrap);
      state.pages[i] = { pdfPage, viewport, wrap, sheet, overlay };
      const ctx = canvas.getContext('2d', { alpha: false });
      await pdfPage.render({ canvasContext: ctx, viewport, transform: [dpr, 0, 0, dpr, 0, 0] }).promise;
      renderPageStamps(i);
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    updatePageIndicator();
    updateSelectionPanel();
  }

  function activeFromScroll() {
    const viewportRect = $('workspace').getBoundingClientRect();
    const idealY = viewportRect.top + viewportRect.height * 0.43;
    let closest = 0, min = Infinity;
    state.pages.forEach((page, i) => {
      const r = page.sheet.getBoundingClientRect();
      const nearest = clamp(idealY, r.top, r.bottom);
      const distance = Math.abs(nearest - idealY);
      if (distance < min) { min = distance; closest = i; }
    });
    state.activePage = closest;
    updatePageIndicator();
  }
  $('workspace').addEventListener('scroll', activeFromScroll, { passive: true });
  function updatePageIndicator() {
    $('pageIndicator').textContent = `Página ${state.activePage + 1} de ${state.pdf?.numPages || 1}`;
  }
  $('zoomSelect').addEventListener('change', async () => {
    if (!state.pdf || state.busy) return;
    const previousPage = state.activePage;
    const previousZoom = state.zoom;
    state.zoom = Number($('zoomSelect').value) || 1;
    busy(true, 'Ajustando zoom…', 'Actualizando páginas');
    try {
      await renderPdf();
      const page = state.pages[previousPage];
      if (page) {
        // Conservar la página que se estaba leyendo, incluso al cambiar de escala.
        const workspace = $('workspace');
        const offset = page.wrap.getBoundingClientRect().top - workspace.getBoundingClientRect().top;
        workspace.scrollTop += offset - 18;
      }
      activeFromScroll();
    } catch (err) {
      console.error(err);
      state.zoom = previousZoom;
      $('zoomSelect').value = String(previousZoom);
      notify('No se pudo actualizar el zoom. Vuelve a intentarlo.', true);
    } finally { busy(false); }
  });

  function signatureForId(id) { return state.signatures.find(s => s.id === id); }
  function placementForId(id) { return state.placements.find(s => s.id === id); }
  function currentPlacement() { return placementForId(state.selectedId); }
  function dimensionsOf(signature, pageIndex, w) {
    const page = state.pages[pageIndex];
    if (!page) return { w, h: .08 };
    // Alto normalizado = ancho normalizado * (anchoPx/altoPx) / aspectoPNG.
    return { w, h: (w * page.viewport.width) / (page.viewport.height * signature.aspect) };
  }
  function addStamp(signatureId, pageIndex = state.activePage, position = null) {
    const signature = signatureForId(signatureId);
    if (!state.pdf || !signature) return;
    if (!state.pages[pageIndex]) pageIndex = 0;
    const w = clamp(210 / state.pages[pageIndex].viewport.width, .18, .44);
    const dims = dimensionsOf(signature, pageIndex, w);
    const h = Math.min(dims.h, .35);
    const x = position ? position.x : (.5 - w / 2);
    const y = position ? position.y : (.5 - h / 2);
    const stamp = { id: uid(), signatureId, pageIndex, x: clamp(x, 0, 1 - w), y: clamp(y, 0, 1 - h), w, h };
    state.placements.push(stamp);
    state.selectedId = stamp.id;
    renderPageStamps(pageIndex);
    updateSelectionPanel();
    updateCount();
    notify('Firma colocada. Puedes arrastrarla o cambiar su tamaño.');
  }
  function renderPageStamps(pageIndex) {
    const page = state.pages[pageIndex];
    if (!page) return;
    page.overlay.replaceChildren();
    for (const stamp of state.placements.filter(s => s.pageIndex === pageIndex)) {
      const signature = signatureForId(stamp.signatureId);
      if (!signature) continue;
      const el = document.createElement('div');
      el.className = 'sig-stamp' + (stamp.id === state.selectedId ? ' selected' : '');
      el.dataset.id = stamp.id;
      stampPosition(el, stamp, page);
      el.innerHTML = `<img src="${signature.dataUrl}" alt="Firma colocada" draggable="false"><span class="stamp-tools">Mover · Ajustar</span><span class="resize-handle" aria-hidden="true"></span>`;
      page.overlay.append(el);
    }
  }
  function renderAllStamps() { state.pages.forEach((p, i) => renderPageStamps(i)); }
  function stampPosition(el, stamp, page) {
    el.style.left = `${stamp.x * page.viewport.width}px`;
    el.style.top = `${stamp.y * page.viewport.height}px`;
    el.style.width = `${stamp.w * page.viewport.width}px`;
    el.style.height = `${stamp.h * page.viewport.height}px`;
  }
  function updateCount() { const n = state.placements.length; $('placedCount').textContent = `${n} ${n === 1 ? 'firma colocada' : 'firmas colocadas'}`; }
  function updateSignatureLibrary() {
    const root = $('signatureLibrary'); root.replaceChildren();
    $('signatureCounter').textContent = state.signatures.length;
    if (!state.signatures.length) { const empty = document.createElement('div'); empty.className = 'sign-empty'; empty.textContent = 'Aún no has creado una firma.'; root.append(empty); return; }
    state.signatures.forEach((signature, index) => {
      const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'signature-item';
      btn.title = `Colocar firma ${index + 1}`;
      btn.innerHTML = `<img src="${signature.dataUrl}" alt="Firma ${index + 1}" draggable="false"><span class="add-sign" aria-hidden="true"><svg class="icon" viewBox="0 0 24 24"><path d="M12 5v14m-7-7h14"/></svg></span>`;
      btn.addEventListener('click', () => addStamp(signature.id));
      root.append(btn);
    });
  }
  function updateSelectionPanel() {
    const stamp = currentPlacement();
    $('selectionEmpty').classList.toggle('hidden', !!stamp);
    $('selectionProperties').classList.toggle('hidden', !stamp);
    if (!stamp) return;
    const asset = signatureForId(stamp.signatureId);
    $('selectedPreview').replaceChildren();
    if (asset) { const img = document.createElement('img'); img.src = asset.dataUrl; img.alt = 'Firma seleccionada'; $('selectedPreview').append(img); }
    $('selectedPageLabel').textContent = `Página ${stamp.pageIndex + 1}`;
    $('sizeRange').value = String(clamp(Math.round(stamp.w * 100), 12, 65));
    $('sizeValue').textContent = `${Math.round(stamp.w * 100)} %`;
  }
  function selectStamp(id) { state.selectedId = id; renderAllStamps(); updateSelectionPanel(); }
  $('sizeRange').addEventListener('input', (e) => {
    const stamp = currentPlacement(); if (!stamp) return;
    const asset = signatureForId(stamp.signatureId);
    if (!asset || !state.pages[stamp.pageIndex]) return;
    const desiredWidth = Number(e.target.value) / 100;
    const page = state.pages[stamp.pageIndex];
    const maxWidthByHeight = (1 - stamp.y) * page.viewport.height * asset.aspect / page.viewport.width;
    // Conservar las proporciones de la firma y evitar que exceda el borde de la página.
    stamp.w = Math.min(desiredWidth, 1, Math.max(.01, maxWidthByHeight));
    stamp.h = dimensionsOf(asset, stamp.pageIndex, stamp.w).h;
    stamp.x = clamp(stamp.x, 0, 1 - stamp.w);
    stamp.y = clamp(stamp.y, 0, 1 - stamp.h);
    $('sizeValue').textContent = `${Math.round(stamp.w * 100)} %`;
    renderPageStamps(stamp.pageIndex);
  });
  function deleteStamp() {
    if (!state.selectedId) return;
    state.placements = state.placements.filter(s => s.id !== state.selectedId);
    state.selectedId = null;
    renderAllStamps(); updateSelectionPanel(); updateCount();
    notify('Firma eliminada del documento.');
  }
  $('deleteStampBtn').addEventListener('click', deleteStamp);
  $('pdfPages').addEventListener('click', (e) => {
    if (!e.target.closest('.sig-stamp') && state.selectedId && !state.drag) selectStamp(null);
  });
  $('pdfPages').addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const el = e.target.closest('.sig-stamp');
    if (!el) return;
    const stamp = placementForId(el.dataset.id);
    const page = stamp && state.pages[stamp.pageIndex];
    if (!stamp || !page) return;
    const resize = !!e.target.closest('.resize-handle');
    e.preventDefault();
    // No recrear el DOM al comenzar el gesto: en móviles rompería la captura táctil.
    state.selectedId = stamp.id;
    state.pages.forEach(p => p.overlay.querySelectorAll('.sig-stamp').forEach(item => {
      item.classList.toggle('selected', item.dataset.id === stamp.id);
    }));
    updateSelectionPanel();
    if (el.setPointerCapture) { try { el.setPointerCapture(e.pointerId); } catch (_) {} }
    state.drag = {
      id: stamp.id, pageIndex: stamp.pageIndex, resize, x: e.clientX, y: e.clientY,
      origX: stamp.x, origY: stamp.y, origW: stamp.w, origH: stamp.h,
    };
    document.body.style.userSelect = 'none';
  });
  window.addEventListener('pointermove', (e) => {
    if (!state.drag) return;
    const drag = state.drag;
    const stamp = placementForId(drag.id), page = state.pages[drag.pageIndex];
    if (!stamp || !page) return;
    const dx = (e.clientX - drag.x) / page.viewport.width;
    const dy = (e.clientY - drag.y) / page.viewport.height;
    if (drag.resize) {
      const asset = signatureForId(stamp.signatureId);
      if (!asset) return;
      // Cambio de tamaño desde el extremo inferior derecho, conservando proporción.
      const minW = .08;
      const maxW = Math.min(.70, 1 - drag.origX);
      let w = clamp(drag.origW + Math.max(dx, dy * page.viewport.height * asset.aspect / page.viewport.width), minW, maxW);
      const dims = dimensionsOf(asset, drag.pageIndex, w);
      if (dims.h > 1 - drag.origY) w *= (1 - drag.origY) / dims.h;
      stamp.w = w; stamp.h = dimensionsOf(asset, drag.pageIndex, w).h;
    } else {
      stamp.x = clamp(drag.origX + dx, 0, 1 - stamp.w);
      stamp.y = clamp(drag.origY + dy, 0, 1 - stamp.h);
    }
    const visible = page.overlay.querySelector(`.sig-stamp[data-id="${stamp.id}"]`);
    if (visible) stampPosition(visible, stamp, page);
    if (drag.resize) { $('sizeRange').value = String(clamp(Math.round(stamp.w * 100), 12, 65)); $('sizeValue').textContent = `${Math.round(stamp.w * 100)} %`; }
  });
  const endDrag = () => {
    if (!state.drag) return;
    state.drag = null;
    document.body.style.userSelect = '';
  };
  window.addEventListener('pointerup', endDrag);
  window.addEventListener('pointercancel', endDrag);
  window.addEventListener('blur', endDrag);
  window.addEventListener('pointercancel', endDrag);
  window.addEventListener('blur', endDrag);

  /* Captura manuscrita, escritura y selección de imágenes. */
  const drawingCanvas = $('drawingCanvas');
  const drawingContext = drawingCanvas.getContext('2d');
  drawingContext.lineCap = 'round'; drawingContext.lineJoin = 'round';
  drawingContext.lineWidth = 4.5; drawingContext.strokeStyle = '#1c2946';
  let drawingNow = false;
  function drawingPoint(e) {
    const rect = drawingCanvas.getBoundingClientRect();
    return { x: (e.clientX - rect.left) * drawingCanvas.width / rect.width,
      y: (e.clientY - rect.top) * drawingCanvas.height / rect.height };
  }
  drawingCanvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault(); drawingNow = true; state.hasDrawn = true;
    drawingCanvas.setPointerCapture(e.pointerId);
    const p = drawingPoint(e);
    drawingContext.beginPath(); drawingContext.moveTo(p.x, p.y);
    drawingContext.lineTo(p.x + .1, p.y + .1); drawingContext.stroke();
  });
  drawingCanvas.addEventListener('pointermove', (e) => {
    if (!drawingNow) return;
    e.preventDefault(); const p = drawingPoint(e);
    drawingContext.lineTo(p.x, p.y); drawingContext.stroke();
  });
  function stopDrawing() { drawingNow = false; }
  drawingCanvas.addEventListener('pointerup', stopDrawing);
  drawingCanvas.addEventListener('pointercancel', stopDrawing);
  $('clearDrawingBtn').addEventListener('click', () => { drawingContext.clearRect(0, 0, drawingCanvas.width, drawingCanvas.height); state.hasDrawn = false; });
  function showSignatureModal() {
    if (!state.pdf) return;
    state.hasDrawn = false;
    drawingContext.clearRect(0, 0, drawingCanvas.width, drawingCanvas.height);
    $('typedName').value = '';
    state.chosenFont = 'script';
    $('fontOptions').querySelectorAll('.font-option').forEach(b => b.classList.toggle('active', b.dataset.font === 'script'));
    updateTypedPreview();
    state.uploadedImage = null;
    $('signatureImageInput').value = '';
    $('imageFileName').textContent = 'Seleccionar una imagen';
    $('imagePreview').replaceChildren(); $('imagePreview').classList.add('hidden');
    setSignatureMode('draw');
    $('signatureModal').classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  }
  function hideSignatureModal() { $('signatureModal').classList.add('hidden'); document.body.style.overflow = ''; }
  $('createSignatureBtn').addEventListener('click', showSignatureModal);
  ['closeModalBtn','cancelSignatureBtn'].forEach(id => $(id).addEventListener('click', hideSignatureModal));
  $('signatureModal').addEventListener('click', e => { if (e.target === $('signatureModal')) hideSignatureModal(); });
  function setSignatureMode(mode) {
    state.mode = mode;
    const names = { draw:'drawMode', type:'typeMode', upload:'uploadMode' };
    Object.entries(names).forEach(([key,id]) => $(id).classList.toggle('hidden', key !== mode));
    document.querySelectorAll('[data-sign-mode]').forEach(btn => { const active = btn.dataset.signMode === mode; btn.classList.toggle('active', active); btn.setAttribute('aria-selected', String(active)); });
    if (mode === 'type') $('typedName').focus();
  }
  document.querySelectorAll('[data-sign-mode]').forEach(btn => btn.addEventListener('click', () => setSignatureMode(btn.dataset.signMode)));
  $('typedName').addEventListener('input', updateTypedPreview);
  $('fontOptions').querySelectorAll('.font-option').forEach(button => button.addEventListener('click', () => {
    state.chosenFont = button.dataset.font;
    $('fontOptions').querySelectorAll('.font-option').forEach(b => b.classList.toggle('active', b === button));
    updateTypedPreview();
  }));
  function updateTypedPreview() {
    const text = $('typedName').value.trim();
    const preview = $('typedPreview');
    preview.textContent = text || 'Tu firma aparecerá aquí';
    preview.style.fontFamily = text ? fontStyles[state.chosenFont] : 'inherit';
    preview.style.fontStyle = state.chosenFont === 'serif' && text ? 'italic' : 'normal';
    preview.style.fontSize = text ? 'clamp(24px,4.1vw,43px)' : '14px';
    preview.style.color = text ? '#1c2946' : '#adb3c3';
  }
  $('signatureImageInput').addEventListener('change', async e => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!['image/png','image/jpeg','image/webp'].includes(file.type) || file.size > 8 * 1024 * 1024) return notify('Selecciona una imagen PNG, JPG o WEBP de hasta 8 MB.', true);
    try {
      const img = await imageFromUrl(URL.createObjectURL(file), true);
      const canvas = document.createElement('canvas');
      const factor = Math.min(1, 1400 / Math.max(img.naturalWidth, img.naturalHeight));
      canvas.width = Math.max(1, Math.floor(img.naturalWidth * factor));
      canvas.height = Math.max(1, Math.floor(img.naturalHeight * factor));
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      state.uploadedImage = canvas;
      $('imageFileName').textContent = file.name;
      const preview = document.createElement('img'); preview.src = canvas.toDataURL('image/png'); preview.alt = 'Imagen de firma cargada';
      $('imagePreview').replaceChildren(preview); $('imagePreview').classList.remove('hidden');
    } catch (err) { notify('No se pudo leer la imagen.', true); }
  });
  function imageFromUrl(url, revoke = false) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => { if (revoke) URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { if (revoke) URL.revokeObjectURL(url); reject(new Error('Imagen inválida')); };
      img.src = url;
    });
  }
  function cropSignature(source, pad = 13) {
    const width = source.width, height = source.height;
    const ctx = source.getContext('2d', { willReadFrequently: true });
    const pixels = ctx.getImageData(0, 0, width, height).data;
    let minX = width, minY = height, maxX = -1, maxY = -1;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      if (pixels[(y * width + x) * 4 + 3] > 18) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
    }
    if (maxX < minX) throw new Error('La firma está vacía. Dibuja, escribe o sube una firma primero.');
    const sw = maxX - minX + 1, sh = maxY - minY + 1;
    const out = document.createElement('canvas');
    out.width = sw + 2 * pad; out.height = sh + 2 * pad;
    out.getContext('2d').drawImage(source, minX, minY, sw, sh, pad, pad, sw, sh);
    return { dataUrl: out.toDataURL('image/png'), aspect: out.width / out.height };
  }
  function typedSignatureCanvas() {
    const text = $('typedName').value.trim();
    if (!text) throw new Error('Escribe tu nombre o firma.');
    const canvas = document.createElement('canvas');
    canvas.width = 1500; canvas.height = 280;
    const ctx = canvas.getContext('2d');
    let px = 145;
    const family = fontStyles[state.chosenFont];
    const italic = state.chosenFont === 'serif' ? 'italic ' : '';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#192844';
    do { ctx.font = `${italic}${px}px ${family}`; if (ctx.measureText(text).width < 1350) break; px -= 5; } while (px > 28);
    ctx.fillText(text, 750, 137);
    return canvas;
  }
  $('saveSignatureBtn').addEventListener('click', () => {
    try {
      let source;
      if (state.mode === 'draw') { if (!state.hasDrawn) throw new Error('Dibuja tu firma antes de continuar.'); source = drawingCanvas; }
      else if (state.mode === 'type') source = typedSignatureCanvas();
      else { if (!state.uploadedImage) throw new Error('Selecciona una imagen de tu firma.'); source = state.uploadedImage; }
      const output = cropSignature(source, state.mode === 'upload' ? 8 : 14);
      const signature = { ...output, id: uid() };
      state.signatures.push(signature);
      updateSignatureLibrary();
      hideSignatureModal();
      addStamp(signature.id);
    } catch (err) { notify(err.message || 'No se pudo crear la firma.', true); }
  });

  /* Exportación: cada posición se convierte desde píxeles visibles a coordenadas PDF.
     Soporta páginas giradas a 0/90/180/270 grados mediante convertToPdfPoint. */
  // Plan B solo con consentimiento: reconstruye páginas visibles como imágenes.
  // No conserva texto seleccionable ni validación de firmas digitales previas.
  async function makeVisualPdfWithSignatures() {
    const output = await PDFLib.PDFDocument.create();
    const signatures = new Map();
    const placementsByPage = new Map();
    for (const stamp of state.placements) {
      if (!placementsByPage.has(stamp.pageIndex)) placementsByPage.set(stamp.pageIndex, []);
      placementsByPage.get(stamp.pageIndex).push(stamp);
    }
    for (let i = 0; i < state.pdf.numPages; i++) {
      $('loadingDetail').textContent = `Convirtiendo página ${i + 1} de ${state.pdf.numPages}`;
      const page = await state.pdf.getPage(i + 1);
      const visible = page.getViewport({ scale: 1 });
      const maxPixels = 7_000_000;
      const targetScale = Math.min(1.75, Math.sqrt(maxPixels / (visible.width * visible.height)));
      const viewport = page.getViewport({ scale: Math.max(1, targetScale) });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const context = canvas.getContext('2d', { alpha: false });
      await page.render({ canvasContext: context, viewport }).promise;
      const image = await output.embedJpg(canvas.toDataURL('image/jpeg', 0.92));
      const outputPage = output.addPage([visible.width, visible.height]);
      outputPage.drawImage(image, { x: 0, y: 0, width: visible.width, height: visible.height });
      canvas.width = canvas.height = 0;
      for (const stamp of placementsByPage.get(i) || []) {
        const signature = signatureForId(stamp.signatureId);
        if (!signature) continue;
        if (!signatures.has(signature.id)) signatures.set(signature.id, await output.embedPng(signature.dataUrl));
        outputPage.drawImage(signatures.get(signature.id), {
          x: stamp.x * visible.width,
          y: visible.height * (1 - stamp.y - stamp.h),
          width: stamp.w * visible.width,
          height: stamp.h * visible.height,
        });
      }
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    return output.save();
  }

  $('downloadBtn').addEventListener('click', async () => {
    if (state.busy || !state.pdf || !state.originalBytes) return;
    if (!state.placements.length) return notify('Coloca al menos una firma antes de descargar.', true);
    busy(true, 'Creando PDF firmado…', 'Incorporando las firmas al documento');
    try {
      let bytes;
      if (state.exportMode === 'visual') {
        bytes = await makeVisualPdfWithSignatures();
      } else {
        const outputPdf = await PDFLib.PDFDocument.load(state.originalBytes.slice());
        const allPages = outputPdf.getPages();
      const pngCache = new Map();
      for (const stamp of state.placements) {
        const signature = signatureForId(stamp.signatureId);
        const view = state.pages[stamp.pageIndex]?.viewport;
        if (!signature || !view || !allPages[stamp.pageIndex]) continue;
        if (!pngCache.has(signature.id)) pngCache.set(signature.id, await outputPdf.embedPng(signature.dataUrl));
        const image = pngCache.get(signature.id);
        const leftPx = stamp.x * view.width;
        const topPx = stamp.y * view.height;
        const widthPx = stamp.w * view.width;
        const heightPx = stamp.h * view.height;
        // El punto inferior izquierdo de la imagen equivale a la esquina inferior izquierda visible.
        const [x, y] = view.convertToPdfPoint(leftPx, topPx + heightPx);
        const [wx, wy] = view.convertToPdfPoint(leftPx + widthPx, topPx + heightPx);
        const [hx, hy] = view.convertToPdfPoint(leftPx, topPx);
        const width = Math.hypot(wx - x, wy - y);
        const height = Math.hypot(hx - x, hy - y);
        const rotation = ((view.rotation % 360) + 360) % 360;
        allPages[stamp.pageIndex].drawImage(image, { x, y, width, height, rotate: PDFLib.degrees(rotation) });
      }
        bytes = await outputPdf.save();
      }
      const blob = new Blob([bytes], { type: 'application/pdf' });
      const downloadUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const baseName = (state.file.name || 'documento.pdf').replace(/\.pdf$/i, '').replace(/[\\/:*?"<>|]/g, '_');
      a.download = `${baseName}_firmado.pdf`;
      a.href = downloadUrl;
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(downloadUrl), 45_000);
      notify('Tu PDF firmado se ha descargado correctamente.');
    } catch (err) {
      console.error(err);
      notify('No pudimos guardar el PDF. Puede estar cifrado o tener una estructura no admitida.', true);
    } finally { busy(false); }
  });

  function openHelp() { $('helpModal').classList.remove('hidden'); }
  function closeHelp() { $('helpModal').classList.add('hidden'); }
  $('helpBtn').addEventListener('click', openHelp);
  $('closeHelpBtn').addEventListener('click', closeHelp);
  $('gotItBtn').addEventListener('click', closeHelp);
  $('helpModal').addEventListener('click', e => { if (e.target === $('helpModal')) closeHelp(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { if (!$('signatureModal').classList.contains('hidden')) hideSignatureModal(); if (!$('helpModal').classList.contains('hidden')) closeHelp(); return; }
    const el = document.activeElement;
    const editing = el && ['INPUT','TEXTAREA','SELECT'].includes(el.tagName);
    if ((e.key === 'Delete' || e.key === 'Backspace') && state.selectedId && !editing && $('signatureModal').classList.contains('hidden')) { e.preventDefault(); deleteStamp(); }
    if (!editing && state.selectedId && ['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)) {
      const stamp = currentPlacement(); if (!stamp) return;
      e.preventDefault();
      const step = e.shiftKey ? .012 : .003;
      if (e.key === 'ArrowUp') stamp.y = clamp(stamp.y - step, 0, 1 - stamp.h);
      if (e.key === 'ArrowDown') stamp.y = clamp(stamp.y + step, 0, 1 - stamp.h);
      if (e.key === 'ArrowLeft') stamp.x = clamp(stamp.x - step, 0, 1 - stamp.w);
      if (e.key === 'ArrowRight') stamp.x = clamp(stamp.x + step, 0, 1 - stamp.w);
      renderPageStamps(stamp.pageIndex);
    }
  });
})();