// --- configuration: endpoints used by this page ---
const API_BASE = window.API_BASE || "http://127.0.0.1:8000";
const VALID_ACCESS = ['VWR', 'SCR', 'RSCR', 'ACL', 'DBCL', 'SCS', 'PLS'];

// --- state ---
let credentials = [];
let editing = null; // email when editing

// --- helpers ---
const $ = id => document.getElementById(id);

function showModal(mode = 'add', row = null) {
    editing = null;

    // Clear all checkboxes first
    document.querySelectorAll('#accessCheckboxes input[type="checkbox"]').forEach(checkbox => {
        checkbox.checked = false;
    });

    if (mode === 'add') {
        $('modalTitle').innerText = 'Add user';
        $('email').disabled = false;
        $('email').value = '';
        // No default selections
        $('professor_name').value = '';
    } else if (mode === 'edit' && row) {
        $('modalTitle').innerText = 'Edit user';
        $('email').value = row.email;
        $('email').disabled = true; // primary key

        // Parse access string and check corresponding checkboxes
        const accessCodes = row.user_type.split(',').map(code => code.trim());
        accessCodes.forEach(code => {
            const checkbox = document.querySelector(`#accessCheckboxes input[value="${code}"]`);
            if (checkbox) {
                checkbox.checked = true;
            }
        });

        $('professor_name').value = row.professor_name || '';
        editing = row.email;
    }
    $('modalBackdrop').style.display = 'flex';
}
async function apiFetch(endpoint, options = {}) {
                try {
                    const response = await fetch(`${API_BASE}${endpoint}`, options);
                    if (!response.ok) {
                        throw new Error(`HTTP error! status: ${response.status}`);
                    }
                    return await response.json();
                } catch (error) {
                    console.error('API Fetch Error:', error);
                    showMessage(`Error: ${error.message}`, 'error');
                    return null;
                }
            }

function hideModal() {
    $('modalBackdrop').style.display = 'none';
    editing = null;
}

function getSelectedAccess() {
    const selected = [];
    document.querySelectorAll('#accessCheckboxes input[type="checkbox"]:checked').forEach(checkbox => {
        selected.push(checkbox.value);
    });
    return selected;
}

function validateForm() {
    const email = $('email').value.trim();
    const selectedAccess = getSelectedAccess();

    if (!email) return 'Email is required.';
    if (!/^\S+@\S+\.\S+$/.test(email)) return 'Enter a valid email.';
    if (selectedAccess.length === 0) return 'At least one access privilege must be selected.';

    // Validate that all selected access codes are valid
    const invalidAccess = selectedAccess.filter(code => !VALID_ACCESS.includes(code));
    if (invalidAccess.length > 0) return `Invalid access code(s): ${invalidAccess.join(', ')}`;

    return null;
}

// --- render list ---
function render() {
    const tbody = $('tbody');
    const q = $('q').value.trim().toLowerCase();
    const f = $('filterType').value;
    const rows = credentials.filter(r => {
        if (f && !r.user_type.includes(f)) return false;
        if (!q) return true;
        return (r.email || '').toLowerCase().includes(q) || (r.professor_name || '').toLowerCase().includes(q);
    });
    
    if (rows.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="muted" style="text-align:center;">No users found.</td></tr>';
        return;
    }
    
    tbody.innerHTML = rows.map(r => {
        const accessCodes = r.user_type.split(',').map(code => code.trim());
        const accessBadges = accessCodes.map(code => `<span class="access-badge">${escapeHtml(code)}</span>`).join('');

        return `
        <tr>
            <td><strong>${escapeHtml(r.email)}</strong></td>
            <td><div class="access-badges">${accessBadges}</div></td>
            <td>${escapeHtml(r.professor_name || '—')}</td>
            <td>
                <div class="actions">
                    <button onclick="onEdit('${encodeURIComponent(r.email)}')" class="ghost">Edit</button>
                    <button onclick="onDelete('${encodeURIComponent(r.email)}')" class="danger">Delete</button>
                </div>
            </td>
        </tr>
        `;
    }).join('');
}

function escapeHtml(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// --- API calls ---
async function fetchAll() {
    try {
        const res = await apiFetch('/api/credentials');
        if (!res.ok) throw new Error('Failed to fetch');
        credentials = await res.json();
        render();
    } catch (e) {
        $('tbody').innerHTML = `<tr><td colspan="4" class="muted" style="text-align:center;">Failed to load data: ${escapeHtml(e.message)}</td></tr>`;
        console.error('Failed to fetch credentials', e);
    }
}

async function createUser(payload) {
    const res = await apiFetch('/api/credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error('Create failed: ' + (await res.json()).error);
    return res.json();
}

async function updateUser(email, payload) {
    const res = await apiFetch('/api/credentials/'+ encodeURIComponent(email), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error('Update failed: ' + (await res.json()).error);
    return res.json();
}

async function deleteUser(email) {
    const res = await apiFetch('/api/credentials/' + encodeURIComponent(email), { method: 'DELETE' });
    if (!res.ok) throw new Error('Delete failed: ' + (await res.json()).error);
    return res.json();
}

// --- event handlers exposed to html via window ---
window.onEdit = (emailEnc) => {
    const email = decodeURIComponent(emailEnc);
    const row = credentials.find(r => r.email === email);
    if (!row) {
        alert('User not found');
        return;
    }
    showModal('edit', row);
}

window.onDelete = async (emailEnc) => {
    const email = decodeURIComponent(emailEnc);
    if (!confirm('Delete user ' + email + '? This cannot be undone.')) return;
    
    try {
        await deleteUser(email);
        // optimistic refresh
        credentials = credentials.filter(r => r.email !== email);
        render();
    } catch (e) {
        alert('Failed to delete: ' + e.message);
        console.error('Failed to delete', e);
    }
}

// --- wiring ---
document.addEventListener('DOMContentLoaded', () => {
    $('addBtn').addEventListener('click', () => showModal('add'));
    $('cancelBtn').addEventListener('click', hideModal);
    $('refreshBtn').addEventListener('click', fetchAll);
    $('q').addEventListener('input', render);
    $('filterType').addEventListener('change', render);

    $('saveBtn').addEventListener('click', async () => {
        const err = validateForm();
        if (err) {
            alert(err);
            return;
        }

        const selectedAccess = getSelectedAccess();
        const payload = {
            email: $('email').value.trim(),
            user_type: selectedAccess.join(', '),
            professor_name: $('professor_name').value.trim() || null
        };
        
        try {
            if (editing) {
                // Update: only user_type and professor_name should be sent
                const updatePayload = { user_type: payload.user_type, professor_name: payload.professor_name };
                await updateUser(editing, updatePayload);

                // update local copy
                const idx = credentials.findIndex(r => r.email === editing);
                if (idx >= 0) credentials[idx] = { ...credentials[idx], ...payload }; // merge changes
            } else {
                // Create
                await createUser(payload);
                credentials.push(payload);
            }
            hideModal();
            render();
        } catch (e) {
            alert('Save failed: ' + e.message);
            console.error('Failed to save the access', e);
        }
    });

    // initial load
    fetchAll();
});