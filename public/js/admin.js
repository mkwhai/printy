document.addEventListener('DOMContentLoaded', () => {
    let adminToken = '';

    const loginModal = document.getElementById('adminLoginModal');
    const dashboard = document.getElementById('dashboard');
    const adminPasswordInput = document.getElementById('adminPasswordInput');
    const loginAdminBtn = document.getElementById('loginAdminBtn');
    const statusMessage = document.getElementById('statusMessage');

    const usersTableBody = document.getElementById('usersTableBody');
    const queueTableBody = document.getElementById('queueTableBody');
    const logsTableBody = document.getElementById('logsTableBody');
    const newUserName = document.getElementById('newUserName');
    const requireModerationCb = document.getElementById('requireModerationCb');
    const generateUserBtn = document.getElementById('generateUserBtn');

    const showMessage = (msg, isError = false) => {
        statusMessage.textContent = msg;
        statusMessage.className = `status-message ${isError ? 'error' : 'success'}`;
        statusMessage.classList.remove('hidden');
        setTimeout(() => statusMessage.classList.add('hidden'), 5000);
    };

    // Safe DOM helper: create element with text content
    const createCell = (text, styles) => {
        const td = document.createElement('td');
        td.textContent = text;
        if (styles) Object.assign(td.style, styles);
        return td;
    };

    const fetchDashData = async () => {
        try {
            // Fetch users
            const usersRes = await fetch('/api/admin/users', { headers: { 'Authorization': `Bearer ${adminToken}` }});
            if (!usersRes.ok) throw new Error('Nieautoryzowany dostęp');
            const users = await usersRes.json();

            usersTableBody.innerHTML = '';
            users.forEach(u => {
                const tr = document.createElement('tr');

                tr.appendChild(createCell(u.id));
                tr.appendChild(createCell(u.name));
                tr.appendChild(createCell(u.code, { fontWeight: 'bold', letterSpacing: '2px', fontFamily: 'monospace' }));
                tr.appendChild(createCell(u.requires_moderation ? 'Wymaga moderacji' : 'Bezpośredni'));
                tr.appendChild(createCell(new Date(u.created_at).toLocaleString('pl-PL')));

                const actionTd = document.createElement('td');
                const deleteBtn = document.createElement('button');
                deleteBtn.className = 'btn btn-secondary';
                deleteBtn.style.cssText = 'padding: 0.25rem 0.5rem; font-size: 0.75rem';
                deleteBtn.textContent = 'Usuń';
                deleteBtn.addEventListener('click', () => deleteUser(u.id));
                actionTd.appendChild(deleteBtn);
                tr.appendChild(actionTd);

                usersTableBody.appendChild(tr);
            });

            // Fetch queue
            const queueRes = await fetch('/api/admin/queue', { headers: { 'Authorization': `Bearer ${adminToken}` }});
            const queue = await queueRes.json();

            queueTableBody.innerHTML = '';
            if (queue.length === 0) {
                const tr = document.createElement('tr');
                const td = document.createElement('td');
                td.colSpan = 6;
                td.style.textAlign = 'center';
                td.textContent = 'Brak oczekujących wydruków.';
                tr.appendChild(td);
                queueTableBody.appendChild(tr);
            } else {
                queue.forEach(q => {
                    const tr = document.createElement('tr');

                    let optsStr = '';
                    try {
                        const opts = JSON.parse(q.options || '{}');
                        optsStr = `Kopie: ${opts.copies}, Układ: ${opts.layout}, Kolor: ${opts.color}`;
                    } catch(e) {}

                    tr.appendChild(createCell(new Date(q.created_at).toLocaleString('pl-PL')));

                    // User name + code cell
                    const userTd = document.createElement('td');
                    userTd.textContent = q.user_name + ' ';
                    const codeSpan = document.createElement('span');
                    codeSpan.className = 'help-text';
                    codeSpan.textContent = `(${q.user_code})`;
                    userTd.appendChild(codeSpan);
                    tr.appendChild(userTd);

                    tr.appendChild(createCell(q.filename, { wordBreak: 'break-all', maxWidth: '200px' }));
                    tr.appendChild(createCell(q.printer || '-'));
                    tr.appendChild(createCell(optsStr, { fontSize: '0.75rem', color: '#666' }));

                    // Action buttons
                    const actionTd = document.createElement('td');
                    const actionDiv = document.createElement('div');
                    actionDiv.style.cssText = 'display:flex; gap:5px;';

                    const approveBtn = document.createElement('button');
                    approveBtn.className = 'btn btn-primary';
                    approveBtn.style.cssText = 'padding: 0.25rem 0.5rem; font-size: 0.75rem';
                    approveBtn.textContent = 'Zatwierdź';
                    approveBtn.addEventListener('click', () => approveJob(q.id));

                    const rejectBtn = document.createElement('button');
                    rejectBtn.className = 'btn btn-secondary';
                    rejectBtn.style.cssText = 'padding: 0.25rem 0.5rem; font-size: 0.75rem';
                    rejectBtn.textContent = 'Odrzuć';
                    rejectBtn.addEventListener('click', () => rejectJob(q.id));

                    actionDiv.appendChild(approveBtn);
                    actionDiv.appendChild(rejectBtn);
                    actionTd.appendChild(actionDiv);
                    tr.appendChild(actionTd);

                    queueTableBody.appendChild(tr);
                });
            }

            // Fetch logs
            const logsRes = await fetch('/api/admin/logs', { headers: { 'Authorization': `Bearer ${adminToken}` }});
            const logs = await logsRes.json();

            logsTableBody.innerHTML = '';
            logs.forEach(l => {
                const tr = document.createElement('tr');

                tr.appendChild(createCell(new Date(l.created_at).toLocaleString('pl-PL')));

                const userTd = document.createElement('td');
                userTd.textContent = l.user_name + ' ';
                const codeSpan = document.createElement('span');
                codeSpan.className = 'help-text';
                codeSpan.textContent = `(${l.user_code})`;
                userTd.appendChild(codeSpan);
                tr.appendChild(userTd);

                tr.appendChild(createCell(l.filename, { wordBreak: 'break-all', maxWidth: '250px' }));
                tr.appendChild(createCell(l.printer || '-'));

                logsTableBody.appendChild(tr);
            });

            // Fetch settings
            const settingsRes = await fetch('/api/admin/settings', { headers: { 'Authorization': `Bearer ${adminToken}` }});
            if (settingsRes.ok) {
                const settings = await settingsRes.json();
                document.getElementById('retentionHoursInput').value = settings.retention_hours;
            }

        } catch (err) {
            console.error('Fetch error:', err);
            showMessage('Błąd podczas pobierania danych. Sprawdź hasło lub połączenie.', true);
            // Only reload if it's strictly an auth error
            if (err.message.includes('401')) {
                setTimeout(() => location.reload(), 2000);
            }
        }
    };

    const deleteUser = async (id) => {
        if(!confirm('Na pewno chcesz usunąć tego użytkownika?')) return;
        await fetch(`/api/admin/users/${encodeURIComponent(id)}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${adminToken}` }
        });
        fetchDashData();
    };

    const approveJob = async (id) => {
        if(!confirm('Czy na pewno chcesz zatwierdzić i wydrukować ten plik?')) return;
        const res = await fetch(`/api/admin/queue/${encodeURIComponent(id)}/approve`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${adminToken}` }
        });
        if(res.ok) {
            showMessage('Wydruk zatwierdzony i wysłany do drukarki.');
            fetchDashData();
        } else {
            const data = await res.json();
            showMessage(data.error || 'Wystąpił błąd', true);
        }
    };

    const rejectJob = async (id) => {
        if(!confirm('Czy na pewno chcesz odrzucić wydruk (plik zostanie usunięty)?')) return;
        const res = await fetch(`/api/admin/queue/${encodeURIComponent(id)}/reject`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${adminToken}` }
        });
        if(res.ok) {
            showMessage('Wydruk odrzucony pomyślnie.');
            fetchDashData();
        } else {
            showMessage('Błąd podczas odrzucania.', true);
        }
    };

    generateUserBtn.addEventListener('click', async () => {
        const name = newUserName.value.trim();
        const requiresModeration = requireModerationCb.checked;
        if(!name) return showMessage('Podaj najpierw nazwę dla nowego kodu.', true);

        const res = await fetch('/api/admin/users', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, requiresModeration })
        });
        if(res.ok) {
            newUserName.value = '';
            requireModerationCb.checked = false;
            fetchDashData();
            showMessage('Pomyślnie wygenerowano nowy PIN.');
        } else {
            showMessage('Wystąpił błąd.', true);
        }
    });

    document.getElementById('saveSettingsBtn').addEventListener('click', async () => {
        const hours = document.getElementById('retentionHoursInput').value;
        const res = await fetch('/api/admin/settings', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ retention_hours: hours })
        });
        if(res.ok) {
            showMessage('Ustawienia zapisane pomyślnie.');
        } else {
            showMessage('Błąd podczas zapisywania ustawień.', true);
        }
    });

    const setupPrinterBtn = document.getElementById('setupPrinterBtn');
    if (setupPrinterBtn) {
        setupPrinterBtn.addEventListener('click', async () => {
            const printerName = document.getElementById('setupPrinterName').value.trim();
            const ipAddress = document.getElementById('setupPrinterIP').value.trim();
            if (!printerName || !ipAddress) {
                return showMessage('Uzupełnij nazwę drukarki i jej adres IP', true);
            }
            showMessage('Trwa dodawanie drukarki do serwera...', false);
            try {
                const response = await fetch('/api/setup-printer', {
                    method: 'POST',
                    headers: { 
                        'Authorization': `Bearer ${adminToken}`,
                        'Content-Type': 'application/json' 
                    },
                    body: JSON.stringify({ printerName, ipAddress })
                });
                const data = await response.json();
                if (response.ok) {
                    showMessage(`Zakończono pomyślnie. Drukarka "${printerName}" została dodana.`);
                    document.getElementById('setupPrinterName').value = '';
                    document.getElementById('setupPrinterIP').value = '';
                    fetchDashData();
                } else {
                    showMessage(data.error || 'Błąd konfiguracji drukarki', true);
                }
            } catch (error) {
                showMessage('Błąd połączenia z serwerem.', true);
            }
        });
    }
    loginAdminBtn.addEventListener('click', async () => {
        const pass = adminPasswordInput.value.trim();
        if(!pass) return;
        
        // Weryfikacja hasła przed wejściem
        loginAdminBtn.disabled = true;
        loginAdminBtn.textContent = 'Logowanie...';
        
        try {
            const res = await fetch('/api/admin/users', { headers: { 'Authorization': `Bearer ${pass}` }});
            if (res.ok) {
                adminToken = pass;
                loginModal.classList.add('hidden');
                dashboard.classList.remove('hidden');
                fetchDashData();
            } else if (res.status === 429) {
                alert('Zbyt wiele prób logowania. Odczekaj minutę.');
            } else {
                alert('Błędne hasło administratora.');
            }
        } catch (e) {
            alert('Błąd połączenia z serwerem.');
        } finally {
            loginAdminBtn.disabled = false;
            loginAdminBtn.textContent = 'Zaloguj';
        }
    });

    adminPasswordInput.addEventListener('keypress', (e) => {
        if(e.key === 'Enter') loginAdminBtn.click();
    });

    // Theme Switch Logic
    const toggleSwitch = document.querySelector('.theme-switch input[type="checkbox"]');
    const currentTheme = localStorage.getItem('theme');

    if (currentTheme) {
        document.body.classList.toggle('dark-mode', currentTheme === 'dark');
        if (currentTheme === 'dark' && toggleSwitch) {
            toggleSwitch.checked = true;
        }
    }

    const switchTheme = (e) => {
        if (e.target.checked) {
            document.body.classList.add('dark-mode');
            localStorage.setItem('theme', 'dark');
        } else {
            document.body.classList.remove('dark-mode');
            localStorage.setItem('theme', 'light');
        }
    };

    if (toggleSwitch) {
        toggleSwitch.addEventListener('change', switchTheme, false);
    }
});
