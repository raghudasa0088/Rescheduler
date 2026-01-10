// API function with your base URL
async function api(path, opts) { 
    const API_BASE = window.API_BASE || "http://127.0.0.1:8000"; // Your API base URL
    const fullPath = path.startsWith('/') ? API_BASE + path : path;
    
    opts = opts || {}; 
    opts.headers = opts.headers || {};
    if(!opts.headers['Content-Type'] && opts.body) opts.headers['Content-Type'] = 'application/json';
    if(opts.body && typeof opts.body !== 'string') opts.body = JSON.stringify(opts.body);
    
    const res = await fetch(fullPath, opts);
    let j;
    try { j = await res.json(); } catch(e) { j = { ok: false, error: 'Invalid response' }; }
    return { status: res.status, body: j };
}


// Function to fetch professor email from server
async function fetchProfessorEmail(professorName) {
    try {
        const response = await api(`/api/get-professor-email?professor_name=${encodeURIComponent(professorName)}`);
        return response.body.email;
    } catch (error) {
        console.error('Error fetching email:', error);
        return 'Email not found';
    }
}

// Get professor info and populate email
// In dashboard.html - modified to fetch email from viewerserver
async function initializeProfessorInfo() {
    const urlParams = new URLSearchParams(window.location.search);
    const professorName = urlParams.get('professor');
    
    if (!professorName) {
        document.getElementById('status').textContent = 'No professor information found. Redirecting...';
        setTimeout(() => {
            window.location.href = 'indexactualcopy.html';
        }, 2000);
        return null;
    }
    
    // Set professor name immediately
    document.getElementById('profName').textContent = professorName;
    document.getElementById('email').textContent = 'Loading email...';
    
    // Fetch email from VIEWERSERVER (different server)
    try {
        const response = await fetch(`http://127.0.0.1:8000/api/get-professor-email?professor_name=${encodeURIComponent(professorName)}`);
        if (response.ok) {
            const data = await response.json();
            document.getElementById('email').textContent = data.email;
        } else {
            document.getElementById('email').textContent = 'Email not available';
        }
    } catch (error) {
        console.error('Failed to fetch email from viewerserver:', error);
        document.getElementById('email').textContent = 'Email fetch failed';
    }
    
    return professorName;
}

// Rest of your existing functions remain the same...
function renderRows(items){
  const tbody = document.getElementById('leavesBody');
  tbody.innerHTML = '';
  if(!items || items.length === 0){
    const tr = document.createElement('tr');
    tr.innerHTML = '<td colspan="4" class="muted">No leaves found. Click "Fetch Leaves".</td>';
    tbody.appendChild(tr);
    return;
  }
  items.forEach(it => {
    const tr = document.createElement('tr');
    tr.dataset.leaveId = it.leave_id;
    tr.innerHTML = `
      <td>${it.leave_id}</td>
      <td>${it.start_date}</td>
      <td>${it.end_date}</td>
      <td>
        <button class="editBtn">Edit</button>
        <button class="deleteBtn">Delete</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

async function fetchLeaves(){
  document.getElementById('status').textContent = '';
  const professorName = document.getElementById('profName').textContent;
  const res = await api(`/api/leavess/fetch?professor=${encodeURIComponent(professorName)}`, { method: 'GET' });
  if(!res.body.ok){
    document.getElementById('status').textContent = res.body.error || 'Failed to fetch leaves';
    renderRows([]);
    return;
  }
  renderRows(res.body.leaves);
}

async function addLeave(){
  const start = document.getElementById('start').value;
  const end = document.getElementById('end').value;
  const professorName = document.getElementById('profName').textContent
  if(!start || !end){ alert('Pick both start and end date'); return; }
  const res = await api(`/api/leavess/add?professor=${encodeURIComponent(professorName)}`, { 
    method: 'POST', 
    body: { start_date: start, end_date: end }
  });
  if(res.body.ok){
    document.getElementById('start').value = '';
    document.getElementById('end').value = '';
    await fetchLeaves();
  } else {
    alert('Failed to add: ' + (res.body.error||'unknown'));
  }
}

async function editLeave(leave_id){
  const row = document.querySelector(`tr[data-leave-id="${leave_id}"]`);
  const oldStart = row.children[1].textContent;
  const oldEnd = row.children[2].textContent;
  
  const modal = document.getElementById('editModal');
  const modalStart = document.getElementById('modalStart');
  const modalEnd = document.getElementById('modalEnd');
  const modalLeaveId = document.getElementById('modalLeaveId');
  const modalSaveBtn = document.getElementById('modalSaveBtn');
  
  modalLeaveId.textContent = leave_id;
  modalStart.value = oldStart;
  modalEnd.value = oldEnd;
  modal.style.display = 'flex';

  modalSaveBtn.replaceWith(modalSaveBtn.cloneNode(true));
  const newSaveBtn = document.getElementById('modalSaveBtn');

  newSaveBtn.addEventListener('click', async function saveHandler(){
    const newStart = modalStart.value;
    const newEnd = modalEnd.value;
    const professorName = document.getElementById('profName').textContent;
    
    if(!newStart || !newEnd){
      alert('Please select both start and end dates.');
      return;
    }

    modal.style.display = 'none';
    
    const res = await api(`/api/leavess/edit/${leave_id}?professor=${encodeURIComponent(professorName)}`, { 
      method: 'POST', 
      body: { start_date: newStart, end_date: newEnd }
    });
    
    if(res.body.ok) {
      fetchLeaves();
    } else {
      alert('Failed to edit: ' + (res.body.error||'unknown'));
    }
  });
}

function closeModal(){
  document.getElementById('editModal').style.display = 'none';
}

async function deleteLeave(leave_id){
  if(!confirm('Delete leave #' + leave_id + '?')) return;
  const professorName = document.getElementById('profName').textContent;
  const res = await api(`/api/leavess/delete/${leave_id}?professor=${encodeURIComponent(professorName)}`, { method: 'POST' });
  if(res.body.ok) fetchLeaves();
  else alert('Failed to delete: ' + (res.body.error||'unknown'));
}

// --- Main Event Listeners ---
document.addEventListener('DOMContentLoaded', async function() {
    // Initialize professor info first
    const professorName = await initializeProfessorInfo();
    
    if (!professorName) return; // Stop if no professor info
    
    // Set up event listeners
    document.getElementById('fetchBtn').addEventListener('click', fetchLeaves);
    document.getElementById('addBtn').addEventListener('click', addLeave);
    document.getElementById('modalCancelBtn').addEventListener('click', closeModal);
    
    document.getElementById('editModal').addEventListener('click', function(e){
        if(e.target.id === 'editModal') closeModal();
    });


    document.getElementById('leavesBody').addEventListener('click', function(e){
        const tr = e.target.closest('tr');
        if(!tr) return;
        const id = tr.dataset.leaveId;
        if(e.target.classList.contains('editBtn')) editLeave(id);
        if(e.target.classList.contains('deleteBtn')) deleteLeave(id);
    });
    
    // Update back link
    document.querySelector('a[href="#"]').href = 'viewer.html';
});