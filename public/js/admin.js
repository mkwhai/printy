document.addEventListener('DOMContentLoaded', () => {
    let adminToken = '';

    const loginModal = document.getElementById('adminLoginModal');
    const dashboard = document.getElementById('dashboard');
    const adminPasswordInput = document.getElementById('adminPasswordInput');
    const loginAdminBtn = document.getElementById('loginAdminBtn');
    const statusMessage = document.getElementById('statusMessage');

    const usersTableBody = document.getElementById('usersTableBody');
    const logsTableBody = document.getElementById('logsTableBody');
    const newUserName = document.getElementById('newUserName');
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
                    <td>${new Date(u.created_at).toLocaleString('pl-PL')}</td>
                    <td><button class="btn btn-secondary" style="padding: 0.25rem 0.5rem; font-size: 0.75rem" onclick="deleteUser(${u.id})">Usuń</button></td>
                `;
                usersTableBody.appendChild(tr);
            });

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

    generateUserBtn.addEventListener('click', async () => {
        const name = newUserName.value.trim();
        if(!name) return showMessage('Podaj najpierw nazwę dla nowego kodu.', true);

        const res = await fetch('/api/admin/users', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ name })
        });
        if(res.ok) {
            newUserName.value = '';
            fetchDashData();
            showMessage('Pomyślnie wygenerowano nowy PIN.');
        } else {
            showMessage('Wystąpił błąd.', true);
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
});
