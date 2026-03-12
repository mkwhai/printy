document.addEventListener('DOMContentLoaded', () => {
    // UI Elements
    const dropzone = document.getElementById('dropzone');
    const fileInput = document.getElementById('fileInput');
    const urlInput = document.getElementById('urlInput');
    const urlNextBtn = document.getElementById('urlNextBtn');
    const statusMessage = document.getElementById('statusMessage');
    const fileQueueSection = document.getElementById('fileQueueSection');
    const fileQueueList = document.getElementById('fileQueueList');
    const printAllBtn = document.getElementById('printAllBtn');
    
    // Modal Elements
    const printModal = document.getElementById('printModal');
    const closeModalBtn = document.getElementById('closeModalBtn');
    const cancelPrintBtn = document.getElementById('cancelPrintBtn');
    const confirmPrintBtn = document.getElementById('confirmPrintBtn');
    const modalFileName = document.getElementById('modalFileName');

    // Preview Elements
    const previewCanvas = document.getElementById('previewCanvas');
    const previewImage = document.getElementById('previewImage');
    const previewPlaceholder = document.getElementById('previewPlaceholder');
    const prevPageBtn = document.getElementById('prevPageBtn');
    const nextPageBtn = document.getElementById('nextPageBtn');
    const previewPageInfo = document.getElementById('previewPageInfo');
    const previewNav = document.getElementById('previewNav');

    // Preview State
    let currentPdfDoc = null;
    let currentPage = 1;
    let totalPages = 1;
    let currentPreviewUrl = null;

    // Admin Elements
    const togglePrinterSetup = document.getElementById('togglePrinterSetup');
    const printerSetupBlock = document.getElementById('printerSetupBlock');
    const setupPrinterBtn = document.getElementById('setupPrinterBtn');

    // State
    let jobQueue = [];
    let editingJobId = null;
    let verifiedUserCode = null;
    let nextJobId = 0;

    // Auth
    const pinWrapper = document.getElementById('pinWrapper');
    const pinContainer = document.getElementById('pinContainer');
    const pinBoxes = document.querySelectorAll('.pin-box');
    const pinError = document.getElementById('pinError');

    const verifyPinAction = async (pin, showVisualError = true) => {
        try {
            const res = await fetch('/api/verify-pin', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userCode: pin })
            });
            if (res.ok) {
                verifiedUserCode = pin;
                localStorage.setItem('printyUserCode', pin);
                pinWrapper.classList.add('hidden');
                dropzone.classList.remove('hidden');
                fileQueueSection.classList.toggle('hidden', jobQueue.length === 0);
                if (pinError) pinError.classList.add('hidden');
                if (jobQueue.length > 0) await submitAllJobs();
            } else {
                handlePinError(showVisualError);
            }
        } catch (e) {
            handlePinError(showVisualError);
        }
    };

    const handlePinError = (showVisualError) => {
        localStorage.removeItem('printyUserCode');
        verifiedUserCode = null;
        if (showVisualError) {
            if (pinError) {
                pinError.textContent = 'Nieprawidłowy PIN, spróbuj ponownie.';
                pinError.classList.remove('hidden');
            }
            pinContainer.classList.add('shake');
            setTimeout(() => pinContainer.classList.remove('shake'), 400);
            pinBoxes.forEach(b => b.value = '');
            pinBoxes[0].focus();
        }
    };

    pinBoxes.forEach((box, index) => {
        box.addEventListener('input', () => {
            box.value = box.value.replace(/[^0-9]/g, '');
            if (box.value.length === 1) {
                if (index < pinBoxes.length - 1) {
                    pinBoxes[index + 1].focus();
                } else {
                    const fullPin = Array.from(pinBoxes).map(b => b.value).join('');
                    if (fullPin.length === 6) verifyPinAction(fullPin, true);
                }
            }
        });
        box.addEventListener('keydown', (e) => {
            if (e.key === 'Backspace' && box.value === '' && index > 0) pinBoxes[index - 1].focus();
        });
        box.addEventListener('paste', (e) => {
            e.preventDefault();
            const pastedData = e.clipboardData.getData('text').replace(/[^0-9]/g, '').slice(0, 6);
            if (pastedData) {
                let currIdx = index;
                for (let i = 0; i < pastedData.length; i++) {
                    if (currIdx < pinBoxes.length) {
                        pinBoxes[currIdx].value = pastedData[i];
                        if (currIdx < pinBoxes.length - 1) pinBoxes[currIdx + 1].focus();
                        currIdx++;
                    }
                }
                const fullPin = Array.from(pinBoxes).map(b => b.value).join('');
                if (fullPin.length === 6) verifyPinAction(fullPin, true);
            }
        });
    });

    const fetchPrinters = async () => {
        try {
            const res = await fetch('/api/printers');
            if (res.ok) {
                const { printers, defaultPrinter } = await res.json();
                const printerSelect = document.getElementById('printerName');
                const selectionGroup = document.getElementById('printerSelectionGroup');
                if (!printerSelect || !selectionGroup) return;
                if (printers && printers.length > 1) {
                    selectionGroup.classList.remove('hidden');
                    printerSelect.innerHTML = '';
                    printers.forEach(p => {
                        const opt = document.createElement('option');
                        opt.value = p;
                        opt.textContent = p === defaultPrinter ? `${p} (Domyślna)` : p;
                        if (p === defaultPrinter) opt.selected = true;
                        printerSelect.appendChild(opt);
                    });
                    const savedPrinter = localStorage.getItem('printy_printerName');
                    if (savedPrinter && printers.includes(savedPrinter)) printerSelect.value = savedPrinter;
                } else {
                    selectionGroup.classList.add('hidden');
                }
            }
        } catch (e) { console.error('Błąd pobierania drukarek:', e); }
    };

    const initApp = async () => {
        const savedPin = localStorage.getItem('printyUserCode');
        if (savedPin && savedPin.length === 6) {
            try {
                const res = await fetch('/api/verify-pin', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ userCode: savedPin })
                });
                if (res.ok) verifiedUserCode = savedPin;
                else localStorage.removeItem('printyUserCode');
            } catch (e) { /* ignore */ }
        }
        await fetchPrinters();
        dropzone.classList.remove('hidden');
    };
    initApp();

    // Settings keys
    const settingsKeys = ['printerName', 'copies', 'pageRanges', 'scale', 'duplexMode', 'colorMode', 'layout', 'paperSize', 'pagesPerSheet', 'margins'];

    const loadSavedSettings = () => {
        settingsKeys.forEach(key => {
            const val = localStorage.getItem(`printy_${key}`);
            if (val) { const el = document.getElementById(key); if (el) el.value = val; }
        });
        const fitEl = document.getElementById('fitToPage');
        if (fitEl && localStorage.getItem('printy_fitToPage') === 'true') fitEl.checked = true;
    };
    loadSavedSettings();

    // Auto-save settings on change
    document.querySelectorAll('#printModal input, #printModal select').forEach(el => {
        el.addEventListener('change', (e) => {
            if (e.target.type === 'checkbox') localStorage.setItem(`printy_${e.target.id}`, e.target.checked);
            else localStorage.setItem(`printy_${e.target.id}`, e.target.value);
        });
    });

    // ====== PREVIEW SYSTEM ======
    const previewPage = document.getElementById('previewPage');

    const cleanupPreview = () => {
        if (currentPreviewUrl) { URL.revokeObjectURL(currentPreviewUrl); currentPreviewUrl = null; }
        currentPdfDoc = null;
        currentPage = 1;
        totalPages = 1;
        previewCanvas.width = 0;
        previewCanvas.height = 0;
        previewCanvas.classList.add('hidden');
        previewImage.classList.add('hidden');
        previewImage.src = '';
        previewPlaceholder.classList.remove('hidden');
        previewPlaceholder.querySelector('p').textContent = 'Podgląd niedostępny';
        previewNav.style.visibility = 'hidden';
        previewPageInfo.textContent = '1 / 1';
        prevPageBtn.disabled = true;
        nextPageBtn.disabled = true;
        // Reset preview effects
        [previewCanvas, previewImage].forEach(t => {
            t.style.transform = '';
            t.style.filter = '';
        });
        if (previewPage) {
            previewPage.style.padding = '';
        }
    };

    // Apply visual effects to preview based on current settings
    const applyPreviewEffects = () => {
        // Target both canvas and image — whichever is active
        const targets = [previewCanvas, previewImage];
        const activeTarget = targets.find(t => !t.classList.contains('hidden'));
        if (!activeTarget) return;

        const transforms = [];
        let filterStr = '';

        // Scale
        const scaleEl = document.getElementById('scale');
        const scaleVal = parseInt(scaleEl?.value, 10);
        if (!isNaN(scaleVal) && scaleVal >= 10 && scaleVal <= 200 && scaleVal !== 100) {
            transforms.push(`scale(${scaleVal / 100})`);
        }

        // Layout rotation
        const layoutEl = document.getElementById('layout');
        if (layoutEl && layoutEl.value === 'landscape') {
            transforms.push('rotate(-90deg)');
        }

        // Color mode — grayscale
        const colorEl = document.getElementById('colorMode');
        if (colorEl && colorEl.value === 'bw') {
            filterStr = 'grayscale(100%)';
        }

        // Margins — visual padding on the page container
        const marginsEl = document.getElementById('margins');
        if (previewPage && marginsEl) {
            if (marginsEl.value === 'none') {
                previewPage.style.padding = '0';
            } else if (marginsEl.value === 'minimum') {
                previewPage.style.padding = '4px';
            } else {
                previewPage.style.padding = '';
            }
        }

        // Apply to ALL targets (both canvas and img) so switching doesn't lose state
        targets.forEach(t => {
            t.style.transform = transforms.join(' ');
            t.style.filter = filterStr;
            t.style.transition = 'transform 0.3s ease, filter 0.3s ease';
            t.style.transformOrigin = 'center center';
        });
    };

    // Listen for settings changes that affect preview
    ['scale', 'colorMode', 'layout', 'margins'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('change', applyPreviewEffects);
            el.addEventListener('input', applyPreviewEffects);
        }
    });

    const getFileExtension = (name) => (name || '').split('.').pop().toLowerCase();
    const isImageFile = (ext) => ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext);
    const isPdfFile = (ext) => ext === 'pdf';

    const renderPreview = async (job) => {
        cleanupPreview();

        if (job.type === 'url') {
            previewPlaceholder.querySelector('p').textContent = 'Podgląd URL niedostępny';
            return;
        }

        const file = job.payload;
        const ext = getFileExtension(file.name);

        if (isImageFile(ext)) {
            currentPreviewUrl = URL.createObjectURL(file);
            previewPlaceholder.classList.add('hidden');
            previewCanvas.classList.add('hidden');
            previewImage.classList.remove('hidden');
            previewImage.src = currentPreviewUrl;
            previewNav.style.visibility = 'hidden';
            previewImage.onload = () => applyPreviewEffects();
        } else if (isPdfFile(ext) && window.pdfjsLib) {
            try {
                const arrayBuffer = await file.arrayBuffer();
                currentPdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
                totalPages = currentPdfDoc.numPages;
                currentPage = 1;
                previewPlaceholder.classList.add('hidden');
                previewImage.classList.add('hidden');
                previewCanvas.classList.remove('hidden');
                previewNav.style.visibility = 'visible';
                updatePageNav();
                await renderPdfPage(currentPage);
                applyPreviewEffects();
            } catch (err) {
                console.error('PDF preview error:', err);
                previewPlaceholder.querySelector('p').textContent = 'Błąd ładowania PDF';
            }
        } else {
            previewPlaceholder.querySelector('p').textContent = `Podgląd .${ext} niedostępny`;
        }
    };

    const renderPdfPage = async (pageNum) => {
        if (!currentPdfDoc) return;
        try {
            const page = await currentPdfDoc.getPage(pageNum);
            const scale = 1.5;
            const viewport = page.getViewport({ scale });
            previewCanvas.width = viewport.width;
            previewCanvas.height = viewport.height;
            const ctx = previewCanvas.getContext('2d');
            await page.render({ canvasContext: ctx, viewport }).promise;
            applyPreviewEffects();
        } catch (err) { console.error('PDF page render error:', err); }
    };

    const updatePageNav = () => {
        previewPageInfo.textContent = `${currentPage} / ${totalPages}`;
        prevPageBtn.disabled = currentPage <= 1;
        nextPageBtn.disabled = currentPage >= totalPages;
    };

    prevPageBtn.addEventListener('click', async () => {
        if (currentPage > 1) { currentPage--; updatePageNav(); await renderPdfPage(currentPage); }
    });
    nextPageBtn.addEventListener('click', async () => {
        if (currentPage < totalPages) { currentPage++; updatePageNav(); await renderPdfPage(currentPage); }
    });

    // Helpers
    const showMessage = (msg, isError = false) => {
        statusMessage.textContent = msg;
        statusMessage.className = `status-message ${isError ? 'error' : 'success'}`;
        statusMessage.classList.remove('hidden');
        setTimeout(() => statusMessage.classList.add('hidden'), 5000);
    };

    // --- JOB QUEUE MANAGEMENT ---
    const addJobToQueue = (type, payload, name) => {
        const job = { id: nextJobId++, type, payload, name: name || (type === 'file' ? payload.name : payload), options: null };
        jobQueue.push(job);
        renderQueue();
    };

    const removeJobFromQueue = (id) => {
        jobQueue = jobQueue.filter(j => j.id !== id);
        renderQueue();
    };

    const renderQueue = () => {
        fileQueueList.innerHTML = '';
        if (jobQueue.length === 0) { fileQueueSection.classList.add('hidden'); return; }
        fileQueueSection.classList.remove('hidden');

        jobQueue.forEach((job) => {
            const row = document.createElement('div');
            row.className = 'file-queue-item';

            const hasCustom = job.options !== null;
            const statusLabel = hasCustom ? '✅ Własne ustawienia' : '⚙️ Domyślne';

            const nameSpan = document.createElement('span');
            nameSpan.className = 'fq-name';
            nameSpan.textContent = job.name;

            const statusSpan = document.createElement('span');
            statusSpan.style.cssText = 'font-size:0.75rem;color:var(--text-muted);margin-right:0.5rem;';
            statusSpan.textContent = statusLabel;

            const actionsDiv = document.createElement('div');
            actionsDiv.className = 'fq-actions';

            const editBtn = document.createElement('button');
            editBtn.textContent = 'Ustawienia';
            editBtn.addEventListener('click', () => window._editJob(job.id));

            const removeBtn = document.createElement('button');
            removeBtn.className = 'fq-remove';
            removeBtn.textContent = '✕';
            removeBtn.addEventListener('click', () => window._removeJob(job.id));

            actionsDiv.appendChild(editBtn);
            actionsDiv.appendChild(removeBtn);
            row.appendChild(nameSpan);
            row.appendChild(statusSpan);
            row.appendChild(actionsDiv);
            fileQueueList.appendChild(row);
        });
    };

    window._removeJob = (id) => removeJobFromQueue(id);
    window._editJob = (id) => {
        const job = jobQueue.find(j => j.id === id);
        if (!job) return;
        editingJobId = id;

        if (job.options) setModalFromOptions(job.options);
        else loadSavedSettings();

        modalFileName.textContent = job.name;
        confirmPrintBtn.textContent = 'Zapisz ustawienia';
        printModal.classList.remove('hidden');

        // Render preview
        renderPreview(job);
    };

    const setModalFromOptions = (opts) => {
        if (opts.printer !== undefined) document.getElementById('printerName').value = opts.printer || '';
        if (opts.copies !== undefined) document.getElementById('copies').value = opts.copies || 1;
        if (opts.pageRanges !== undefined) document.getElementById('pageRanges').value = opts.pageRanges || '';
        if (opts.scale !== undefined) document.getElementById('scale').value = opts.scale || '';
        if (opts.duplex !== undefined) document.getElementById('duplexMode').value = opts.duplex || 'one-sided';
        if (opts.color !== undefined) document.getElementById('colorMode').value = opts.color || 'color';
        if (opts.layout !== undefined) document.getElementById('layout').value = opts.layout || 'portrait';
        if (opts.paperSize !== undefined) document.getElementById('paperSize').value = opts.paperSize || 'A4';
        if (opts.pagesPerSheet !== undefined) document.getElementById('pagesPerSheet').value = opts.pagesPerSheet || '1';
        if (opts.margins !== undefined) document.getElementById('margins').value = opts.margins || 'default';
        document.getElementById('fitToPage').checked = !!opts.fitToPage;
    };

    const getPrintOptions = () => ({
        printer: document.getElementById('printerName').value,
        copies: document.getElementById('copies').value,
        scale: document.getElementById('scale').value,
        pageRanges: document.getElementById('pageRanges').value,
        duplex: document.getElementById('duplexMode').value,
        color: document.getElementById('colorMode').value,
        layout: document.getElementById('layout').value,
        paperSize: document.getElementById('paperSize').value,
        pagesPerSheet: document.getElementById('pagesPerSheet').value,
        margins: document.getElementById('margins').value,
        fitToPage: document.getElementById('fitToPage').checked
    });

    // Modal Actions
    const closeModal = () => {
        printModal.classList.add('hidden');
        editingJobId = null;
        confirmPrintBtn.textContent = 'Zapisz ustawienia';
        cleanupPreview();
    };

    closeModalBtn.addEventListener('click', closeModal);
    cancelPrintBtn.addEventListener('click', closeModal);

    confirmPrintBtn.addEventListener('click', () => {
        const opts = getPrintOptions();
        if (editingJobId !== null) {
            const job = jobQueue.find(j => j.id === editingJobId);
            if (job) job.options = opts;
            closeModal();
            renderQueue();
            showMessage('Ustawienia zapisane dla tego pliku.');
            return;
        }
    });

    // --- PRINT ALL ---
    printAllBtn.addEventListener('click', () => {
        if (jobQueue.length === 0) return;
        if (verifiedUserCode) {
            submitAllJobs();
        } else {
            dropzone.classList.add('hidden');
            fileQueueSection.classList.add('hidden');
            pinWrapper.classList.remove('hidden');
            pinBoxes[0].focus();
            showMessage('Wpisz Kod Dostępu, aby autoryzować wydruk.');
        }
    });

    const submitAllJobs = async () => {
        if (!verifiedUserCode) {
            pinWrapper.classList.remove('hidden');
            dropzone.classList.add('hidden');
            fileQueueSection.classList.add('hidden');
            return showMessage('Twój PIN stracił ważność. Zaloguj się ponownie.', true);
        }

        showMessage(`Wysyłanie ${jobQueue.length} plików...`);
        const defaultOpts = getPrintOptions();
        let successCount = 0, errorCount = 0;

        for (const job of [...jobQueue]) {
            const opts = job.options || defaultOpts;
            try {
                if (job.type === 'file') {
                    const formData = new FormData();
                    formData.append('file', job.payload);
                    for (const [key, value] of Object.entries(opts)) formData.append(key, value);
                    const response = await fetch('/api/print', {
                        method: 'POST',
                        headers: { 'x-user-code': verifiedUserCode },
                        body: formData
                    });
                    if (response.ok) successCount++;
                    else { errorCount++; if (response.status === 403) { showMessage('Twój PIN jest nieprawidłowy.', true); return; } }
                } else if (job.type === 'url') {
                    const body = { ...opts, url: job.payload };
                    const response = await fetch('/api/print-url', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'x-user-code': verifiedUserCode },
                        body: JSON.stringify(body)
                    });
                    if (response.ok) successCount++;
                    else { errorCount++; if (response.status === 403) { showMessage('Twój PIN jest nieprawidłowy.', true); return; } }
                }
            } catch (error) { errorCount++; }
        }

        jobQueue = [];
        renderQueue();
        fileInput.value = '';
        urlInput.value = '';
        pinWrapper.classList.add('hidden');
        dropzone.classList.remove('hidden');

        if (errorCount === 0) showMessage(`Wysłano ${successCount} plik(ów) do systemu drukowania.`);
        else showMessage(`Wysłano ${successCount}, błędy: ${errorCount}`, true);
    };

    // --- DROPZONE & FILE INPUT ---
    dropzone.addEventListener('click', (e) => {
        if (e.target.closest('#urlGroup')) return;
        fileInput.click();
    });

    fileInput.addEventListener('change', (e) => {
        const files = Array.from(e.target.files);
        if (files.length === 0) return;
        files.forEach(f => addJobToQueue('file', f, f.name));
        if (files.length === 1) window._editJob(jobQueue[jobQueue.length - 1].id);
    });

    // Drag and Drop
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        dropzone.addEventListener(eventName, (e) => { e.preventDefault(); e.stopPropagation(); }, false);
    });
    ['dragenter', 'dragover'].forEach(eventName => {
        dropzone.addEventListener(eventName, () => dropzone.classList.add('dragover'), false);
    });
    ['dragleave', 'drop'].forEach(eventName => {
        dropzone.addEventListener(eventName, () => dropzone.classList.remove('dragover'), false);
    });

    dropzone.addEventListener('drop', (e) => {
        const dt = e.dataTransfer;
        const files = Array.from(dt.files);
        if (files.length === 0) return;
        files.forEach(f => addJobToQueue('file', f, f.name));
        if (files.length === 1) window._editJob(jobQueue[jobQueue.length - 1].id);
    });

    // URL Actions
    urlNextBtn.addEventListener('click', () => {
        const url = urlInput.value.trim();
        if (!url) { showMessage('Podaj poprawny adres URL linku przed kontynuacją.', true); return; }
        addJobToQueue('url', url, url);
        urlInput.value = '';
        window._editJob(jobQueue[jobQueue.length - 1].id);
    });

    // Paste handling
    document.addEventListener('paste', (e) => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
        const items = e.clipboardData.items;
        for (let i = 0; i < items.length; i++) {
            if (items[i].kind === 'file') {
                const file = items[i].getAsFile();
                addJobToQueue('file', file, file.name);
                break;
            } else if (items[i].kind === 'string' && items[i].type === 'text/plain') {
                items[i].getAsString((str) => {
                    if (str.startsWith('http://') || str.startsWith('https://')) addJobToQueue('url', str, str);
                });
            }
        }
    });

    // Admin Panel Actions
    if (togglePrinterSetup) {
        togglePrinterSetup.addEventListener('click', () => printerSetupBlock.classList.toggle('active'));
    }

    if (setupPrinterBtn) {
        setupPrinterBtn.addEventListener('click', async () => {
            const printerName = document.getElementById('setupPrinterName').value.trim();
            const ipAddress = document.getElementById('setupPrinterIP').value.trim();
            if (!printerName || !ipAddress) { showMessage('Uzupełnij nazwę drukarki i jej adres IP', true); return; }
            showMessage('Trwa dodawanie drukarki do serwera...', false);
            try {
                const response = await fetch('/api/setup-printer', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ printerName, ipAddress })
                });
                const data = await response.json();
                if (response.ok) {
                    showMessage(`Zakończono pomyślnie. Możesz wpisać "${printerName}" w polu Odbiorca.`);
                    document.getElementById('setupPrinterName').value = '';
                    document.getElementById('setupPrinterIP').value = '';
                    printerSetupBlock.classList.remove('active');
                    await fetchPrinters();
                } else {
                    showMessage(data.error || 'Błąd konfiguracji drukarki', true);
                }
            } catch (error) { showMessage('Błąd połączenia z serwerem.', true); }
        });
    }

    // Theme Switch Logic
    const toggleSwitch = document.querySelector('.theme-switch input[type="checkbox"]');
    const currentTheme = localStorage.getItem('theme');
    if (currentTheme) {
        document.body.classList.toggle('dark-mode', currentTheme === 'dark');
        if (currentTheme === 'dark' && toggleSwitch) toggleSwitch.checked = true;
    }
    const switchTheme = (e) => {
        if (e.target.checked) { document.body.classList.add('dark-mode'); localStorage.setItem('theme', 'dark'); }
        else { document.body.classList.remove('dark-mode'); localStorage.setItem('theme', 'light'); }
    };
    if (toggleSwitch) toggleSwitch.addEventListener('change', switchTheme, false);
});
