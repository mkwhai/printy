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

    const fetchDashData = async () => {
        try {
            // Fetch users
            const usersRes = await fetch('/api/admin/users', { headers: { 'Authorization': `Bearer ${adminToken}` }});
            if (!usersRes.ok) throw new Error('Nieautoryzowany dostęp');
            const users = await usersRes.json();
            
            usersTableBody.innerHTML = '';
            users.forEach(u => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td>${u.id}</td>
                    <td>${u.name}</td>
                    <td style="font-weight:bold; letter-spacing:2px; font-family:monospace;">${u.code}</td>
                    <td>${u.requires_moderation ? 'Wymaga moderacji' : 'Bezpośredni'}</td>
                    <td>${new Date(u.created_at).toLocaleString('pl-PL')}</td>
                    <td><button class="btn btn-secondary" style="padding: 0.25rem 0.5rem; font-size: 0.75rem" onclick="deleteUser(${u.id})">Usuń</button></td>
                `;
                usersTableBody.appendChild(tr);
            });

            // Fetch queue
            const queueRes = await fetch('/api/admin/queue', { headers: { 'Authorization': `Bearer ${adminToken}` }});
            const queue = await queueRes.json();
            
            queueTableBody.innerHTML = '';
            if (queue.length === 0) {
                queueTableBody.innerHTML = '<tr><td colspan="6" style="text-align:center;">Brak oczekujących wydruków.</td></tr>';
            } else {
                queue.forEach(q => {
                    const tr = document.createElement('tr');
                    let optsStr = '';
                    try {
                        const opts = JSON.parse(q.options || '{}');
                        optsStr = `Kopie: ${opts.copies}, Układ: ${opts.layout}, Kolor: ${opts.color}`;
                    } catch(e) {}

                    tr.innerHTML = `
                        <td>${new Date(q.created_at).toLocaleString('pl-PL')}</td>
                        <td>${q.user_name} <span class="help-text">(${q.user_code})</span></td>
                        <td style="word-break: break-all; max-width: 200px;">${q.filename}</td>
                        <td>${q.printer || '-'}</td>
                        <td style="font-size: 0.75rem; color: #666;">${optsStr}</td>
                        <td>
                            <div style="display:flex; gap:5px;">
                                <button class="btn btn-primary" style="padding: 0.25rem 0.5rem; font-size: 0.75rem" onclick="approveJob(${q.id})">Zatwierdź</button>
                                <button class="btn btn-secondary" style="padding: 0.25rem 0.5rem; font-size: 0.75rem" onclick="rejectJob(${q.id})">Odrzuć</button>
                            </div>
                        </td>
                    `;
                    queueTableBody.appendChild(tr);
                });
            }

            // Fetch logs
            const logsRes = await fetch('/api/admin/logs', { headers: { 'Authorization': `Bearer ${adminToken}` }});
            const logs = await logsRes.json();
            
            logsTableBody.innerHTML = '';
            logs.forEach(l => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td>${new Date(l.created_at).toLocaleString('pl-PL')}</td>
                    <td>${l.user_name} <span class="help-text">(${l.user_code})</span></td>
                    <td style="word-break: break-all; max-width: 250px;">${l.filename}</td>
                    <td>${l.printer || '-'}</td>
                `;
                logsTableBody.appendChild(tr);
            });

            // Fetch settings
            const settingsRes = await fetch('/api/admin/settings', { headers: { 'Authorization': `Bearer ${adminToken}` }});
            if (settingsRes.ok) {
                const settings = await settingsRes.json();
                document.getElementById('retentionHoursInput').value = settings.retention_hours;
            }

        } catch (err) {
            alert('Sesja wygasła lub błędne hasło.');
            location.reload();
        }
    };

    window.deleteUser = async (id) => {
        if(!confirm('Na pewno chcesz usunąć tego użytkownika?')) return;
        await fetch(`/api/admin/users/${id}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${adminToken}` }
        });
        fetchDashData();
    };

    window.approveJob = async (id) => {
        if(!confirm('Czy na pewno chcesz zatwierdzić i wydrukować ten plik?')) return;
        const res = await fetch(`/api/admin/queue/${id}/approve`, {
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

    window.rejectJob = async (id) => {
        if(!confirm('Czy na pewno chcesz odrzucić wydruk (plik zostanie usunięty)?')) return;
        const res = await fetch(`/api/admin/queue/${id}/reject`, {
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
    loginAdminBtn.addEventListener('click', () => {
        const pass = adminPasswordInput.value.trim();
        if(!pass) return;
        adminToken = pass;
        loginModal.classList.add('hidden');
        dashboard.classList.remove('hidden');
        fetchDashData();
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
