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
            duplex: document.getElementById('duplex').checked,
            color: document.getElementById('color').checked,
            fitToPage: document.getElementById('fitToPage').checked
        };
    };

    // Modal Actions
    closeModalBtn.addEventListener('click', closeModal);
    cancelPrintBtn.addEventListener('click', closeModal);

    confirmPrintBtn.addEventListener('click', async () => {
        if (!currentJob) return;

        const options = getPrintOptions();
        
        // Setup UI for loading
        confirmPrintBtn.disabled = true;
        confirmPrintBtn.textContent = 'Trwa wysyłanie...';

        try {
            if (currentJob.type === 'file') {
                const formData = new FormData();
                formData.append('file', currentJob.payload);
                for (const [key, value] of Object.entries(options)) {
                    formData.append(key, value);
                }

                const response = await fetch('/api/print', {
                    method: 'POST',
                    body: formData
                });
                
                const data = await response.json();
                if (response.ok) {
                    showMessage('Plik został poprawnie wysłany do druku.');
                } else {
                    showMessage(data.error || 'Wystąpił błąd podczas wysyłania', true);
                }
            } else if (currentJob.type === 'url') {
                options.url = currentJob.payload;
                const response = await fetch('/api/print-url', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(options)
                });
                
                const data = await response.json();
                if (response.ok) {
                    showMessage('Plik z URL został poprawnie wysłany do druku.');
                    urlInput.value = '';
                } else {
                    showMessage(data.error || 'Wystąpił błąd podczas drukowania URL', true);
                }
            }
        } catch (error) {
            showMessage('Błąd połączenia z serwerem.', true);
        } finally {
            confirmPrintBtn.disabled = false;
            confirmPrintBtn.textContent = 'Drukuj';
            closeModal();
        }
    });

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
