document.addEventListener('DOMContentLoaded', () => {
    // UI Elements
    const dropzone = document.getElementById('dropzone');
    const fileInput = document.getElementById('fileInput');
    const urlInput = document.getElementById('urlInput');
    const urlNextBtn = document.getElementById('urlNextBtn');
    const statusMessage = document.getElementById('statusMessage');
    
    // Modal Elements
    const printModal = document.getElementById('printModal');
    const closeModalBtn = document.getElementById('closeModalBtn');
    const cancelPrintBtn = document.getElementById('cancelPrintBtn');
    const confirmPrintBtn = document.getElementById('confirmPrintBtn');
    const modalFileName = document.getElementById('modalFileName');

    // Admin Elements
    const togglePrinterSetup = document.getElementById('togglePrinterSetup');
    const printerSetupBlock = document.getElementById('printerSetupBlock');
    const setupPrinterBtn = document.getElementById('setupPrinterBtn');

    // State
    let currentJob = null; // { type: 'file', payload: File } | { type: 'url', payload: String }

    let verifiedUserCode = null;

    // Auth and Settings
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
                if (pinError) pinError.classList.add('hidden');
                
                // Automatycznie kontynuuj proces drukowania po pomyślnym zalogowaniu
                if (currentJob) {
                    await submitPrintJob();
                }
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
        box.addEventListener('input', (e) => {
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
            if (e.key === 'Backspace' && box.value === '') {
                if (index > 0) pinBoxes[index - 1].focus();
            }
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

    const initApp = async () => {
        const savedPin = localStorage.getItem('printyUserCode');
        if (savedPin && savedPin.length === 6) {
            // Ciche sprawdzenie w tle
            try {
                const res = await fetch('/api/verify-pin', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ userCode: savedPin })
                });
                if (res.ok) {
                    verifiedUserCode = savedPin;
                    dropzone.classList.remove('hidden');
                } else {
                    localStorage.removeItem('printyUserCode');
                    dropzone.classList.remove('hidden');
                }
            } catch (e) {
                dropzone.classList.remove('hidden');
            }
        } else {
            // Jeśli nie ma zapisanego widoczny jest od początku dropzone
            dropzone.classList.remove('hidden');
        }
    };
    initApp();

    // 2. Odczyt zapisanych ustawień druku
    const settingsKeys = ['printerName', 'copies', 'pageRanges', 'scale', 'duplexMode', 'colorMode', 'layout', 'paperSize', 'pagesPerSheet', 'margins'];
    settingsKeys.forEach(key => {
        const val = localStorage.getItem(`printy_${key}`);
        if(val) document.getElementById(key).value = val;
    });
    if(localStorage.getItem('printy_fitToPage') === 'true') {
        document.getElementById('fitToPage').checked = true;
    }

    // 3. Automatyczny powrót (zapis) po edycji dowolnego wejścia modalnego
    document.querySelectorAll('#printModal input, #printModal select').forEach(el => {
        el.addEventListener('change', (e) => {
            if(e.target.type === 'checkbox') {
                localStorage.setItem(`printy_${e.target.id}`, e.target.checked);
            } else {
                localStorage.setItem(`printy_${e.target.id}`, e.target.value);
            }
        });
    });

    // Helpers
    const showMessage = (msg, isError = false) => {
        statusMessage.textContent = msg;
        statusMessage.className = `status-message ${isError ? 'error' : 'success'}`;
        statusMessage.classList.remove('hidden');
        setTimeout(() => statusMessage.classList.add('hidden'), 5000);
    };

    const openModal = (job) => {
        currentJob = job;
        if (job.type === 'file') {
            modalFileName.textContent = `Wybrany plik: ${job.payload.name}`;
        } else {
            modalFileName.textContent = `Adres URL: ${job.payload}`;
        }
        printModal.classList.remove('hidden');
    };

    const closeModal = () => {
        printModal.classList.add('hidden');
        currentJob = null;
        fileInput.value = '';
    };

    const getPrintOptions = () => {
        return {
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
        };
    };

    // More Settings Accordion
    const toggleMoreSettings = document.getElementById('toggleMoreSettings');
    const moreSettingsBlock = document.getElementById('moreSettingsBlock');
    if (toggleMoreSettings) {
        toggleMoreSettings.addEventListener('click', () => {
            moreSettingsBlock.classList.toggle('active');
        });
    }

    // Modal Actions
    closeModalBtn.addEventListener('click', closeModal);
    cancelPrintBtn.addEventListener('click', closeModal);

    confirmPrintBtn.addEventListener('click', () => {
        if (!currentJob) return;

        // Jeśli maszyna ma już potwierdzony w tej sesji PIN - drukuj prosto.
        if (verifiedUserCode) {
            submitPrintJob();
        } else {
            // Ukryj dropzone/modal i pokaż podawanie PINu
            closeModal();
            dropzone.classList.add('hidden');
            pinWrapper.classList.remove('hidden');
            pinBoxes[0].focus();
            showMessage('Wpisz Kod Dostępu, aby autoryzować ten wydruk.');
        }
    });

    // Prawdziwe strzelanie do API z dokumentem (wydzielone z przycisku confirm)
    const submitPrintJob = async () => {
        const options = getPrintOptions();
        
        statusMessage.textContent = 'Trwa wysyłanie...';
        statusMessage.className = 'status-message';
        statusMessage.classList.remove('hidden');

        try {
            if(!verifiedUserCode) {
                pinWrapper.classList.remove('hidden');
                dropzone.classList.add('hidden');
                return showMessage('Twój PIN tracił ważność. Zaloguj się ponownie.', true);
            }

            if (currentJob.type === 'file') {
                const formData = new FormData();
                formData.append('file', currentJob.payload);
                for (const [key, value] of Object.entries(options)) {
                    formData.append(key, value);
                }

                const response = await fetch('/api/print', {
                    method: 'POST',
                    headers: { 'x-user-code': verifiedUserCode },
                    body: formData
                });
                
                const data = await response.json();
                if (response.ok) {
                    showMessage(data.message || 'Plik przesłany do systemu.');
                } else {
                    showMessage(data.error || 'Wystąpił błąd podczas wysyłania', true);
                    if(response.status === 403) showMessage('Twój PIN jest nieprawidłowy.', true);
                }
            } else if (currentJob.type === 'url') {
                options.url = currentJob.payload;
                const response = await fetch('/api/print-url', {
                    method: 'POST',
                    headers: { 
                        'Content-Type': 'application/json',
                        'x-user-code': verifiedUserCode
                    },
                    body: JSON.stringify(options)
                });
                
                const data = await response.json();
                if (response.ok) {
                    showMessage(data.message || 'Plik przesłany do systemu.');
                    urlInput.value = '';
                } else {
                    showMessage(data.error || 'Wystąpił błąd podczas drukowania URL', true);
                    if(response.status === 403) showMessage('Twój PIN jest nieprawidłowy.', true);
                }
            }
        } catch (error) {
            showMessage('Błąd połączenia z serwerem.', true);
        } finally {
            currentJob = null;
            fileInput.value = '';
            pinWrapper.classList.add('hidden');
            dropzone.classList.remove('hidden');
        }
    };

    // Dropzone & File Input Actions
    // Przeciwdziałaj bombelkowaniu, żeby np. kliknięcie inputa/buttona URL nie wyzwalało kliku na dropzone
    dropzone.addEventListener('click', (e) => {
        if (e.target.closest('#urlGroup')) return; // ignouj jeśli kliknięto sekcję URL
        fileInput.click();
    });

    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            openModal({ type: 'file', payload: e.target.files[0] });
        }
    });

    // Drag and Drop
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        dropzone.addEventListener(eventName, preventDefaults, false);
    });

    function preventDefaults(e) {
        e.preventDefault();
        e.stopPropagation();
    }

    ['dragenter', 'dragover'].forEach(eventName => {
        dropzone.addEventListener(eventName, () => dropzone.classList.add('dragover'), false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
        dropzone.addEventListener(eventName, () => dropzone.classList.remove('dragover'), false);
    });

    dropzone.addEventListener('drop', (e) => {
        const dt = e.dataTransfer;
        const files = dt.files;
        if (files.length > 0) {
            openModal({ type: 'file', payload: files[0] });
        }
    });

    // URL Actions
    urlNextBtn.addEventListener('click', () => {
        const url = urlInput.value.trim();
        if (!url) {
            showMessage('Podaj poprawny adres URL linku przed kontynuacją.', true);
            return;
        }
        openModal({ type: 'url', payload: url });
    });

    // Paste handling
    document.addEventListener('paste', (e) => {
        // Ignoruj wklejanie jeśli wpisujemy coś np w polu URL
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

        const items = e.clipboardData.items;
        for (let i = 0; i < items.length; i++) {
            if (items[i].kind === 'file') {
                const file = items[i].getAsFile();
                openModal({ type: 'file', payload: file });
                break;
            } else if (items[i].kind === 'string' && items[i].type === 'text/plain') {
                items[i].getAsString((str) => {
                    if (str.startsWith('http://') || str.startsWith('https://')) {
                        openModal({ type: 'url', payload: str });
                    }
                });
            }
        }
    });

    // Admin Panel Actions
    if(togglePrinterSetup) {
        togglePrinterSetup.addEventListener('click', () => {
            printerSetupBlock.classList.toggle('active');
        });
    }

    if(setupPrinterBtn) {
        setupPrinterBtn.addEventListener('click', async () => {
            const printerName = document.getElementById('setupPrinterName').value.trim();
            const ipAddress = document.getElementById('setupPrinterIP').value.trim();

            if (!printerName || !ipAddress) {
                showMessage('Uzupełnij nazwę drukarki i jej adres IP', true);
                return;
            }

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
                } else {
                    showMessage(data.error || 'Błąd konfiguracji drukarki', true);
                }
            } catch (error) {
                showMessage('Błąd połączenia z serwerem.', true);
            }
        });
    }
});
