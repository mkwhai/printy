document.addEventListener('DOMContentLoaded', () => {
    // Elements
    const dropzone = document.getElementById('dropzone');
    const fileInput = document.getElementById('fileInput');
    const urlInput = document.getElementById('urlInput');
    const printUrlBtn = document.getElementById('printUrlBtn');
    const statusMessage = document.getElementById('statusMessage');
    
    // Setup Elements
    const togglePrinterSetup = document.getElementById('togglePrinterSetup');
    const printerSetupBlock = document.getElementById('printerSetupBlock');
    const setupPrinterBtn = document.getElementById('setupPrinterBtn');

    // Accordion Toggle
    togglePrinterSetup.addEventListener('click', () => {
        printerSetupBlock.classList.toggle('active');
    });

    // Helper: Show Message
    const showMessage = (msg, isError = false) => {
        statusMessage.textContent = msg;
        statusMessage.className = `status-message ${isError ? 'error' : 'success'}`;
        statusMessage.classList.remove('hidden');
        setTimeout(() => statusMessage.classList.add('hidden'), 5000);
    };

    // Helper: Collect print options
    const getPrintOptions = () => {
        return {
            printer: document.getElementById('printerName').value,
            copies: document.getElementById('copies').value,
            duplex: document.getElementById('duplex').checked,
            color: document.getElementById('color').checked
        };
    };

    // Print File Action
    const printFile = async (file) => {
        const formData = new FormData();
        formData.append('file', file);
        
        const options = getPrintOptions();
        for (const [key, value] of Object.entries(options)) {
            formData.append(key, value);
        }

        showMessage('Wysyłanie pliku do druku...', false);
        try {
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
        } catch (error) {
            showMessage('Błąd połączenia z serwerem.', true);
        }
    };

    // Print URL Action
    printUrlBtn.addEventListener('click', async () => {
        const url = urlInput.value.trim();
        if (!url) {
            showMessage('Podaj poprawny adres URL linku.', true);
            return;
        }

        const options = getPrintOptions();
        options.url = url;

        showMessage('Pobieranie pliku z URL i wysyłanie do druku...', false);
        try {
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
        } catch (error) {
            showMessage('Błąd połączenia z serwerem.', true);
        }
    });

    // Setup Printer Action
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
                showMessage(`Zakończono. Możesz wpisać "${printerName}" w polu Odbiorca.`);
                document.getElementById('printerName').value = printerName;
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

    // Drag and Drop Setup
    dropzone.addEventListener('click', () => fileInput.click());

    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            printFile(e.target.files[0]);
            fileInput.value = ''; // Reset
        }
    });

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
            printFile(files[0]);
        }
    });
    
    // Paste support
    document.addEventListener('paste', (e) => {
        const items = e.clipboardData.items;
        for (let i = 0; i < items.length; i++) {
            if (items[i].kind === 'file') {
                const file = items[i].getAsFile();
                printFile(file);
                break; // print only one file at a time
            } else if (items[i].kind === 'string' && items[i].type === 'text/plain') {
                items[i].getAsString((str) => {
                    if (str.startsWith('http://') || str.startsWith('https://')) {
                        urlInput.value = str;
                        // Opcjonalnie: printUrlBtn.click();
                    }
                });
            }
        }
    });
});
