const socket = io();
const boardEl = document.getElementById('board');
const canvasEl = document.getElementById('canvas');
const emptyHintEl = document.getElementById('empty-hint');
const saveBtn = document.getElementById('save-board');
const boardListEl = document.getElementById('board-list');
const newBoardInput = document.getElementById('new-board-name');
const newBoardBtn = document.getElementById('new-board-btn');
const trashEl = document.getElementById('trash');

let currentBoardName = null;
let boardState = [];

function updateEmptyHint() {
  if (!emptyHintEl) return;
  emptyHintEl.hidden = boardState.length > 0;
}

function renderBoard(items) {
  if (!canvasEl) return;
  canvasEl.querySelectorAll('.board-item').forEach((el) => el.remove());
  (items || []).forEach((item) => appendItemToBoard(item));
  updateEmptyHint();
}

function appendItemToBoard(item) {
  if (!canvasEl) return;
  const el = document.createElement('div');
  el.className = 'board-item';
  el.dataset.id = item.id;
  el.style.left = `${item.x}px`;
  el.style.top = `${item.y}px`;

  if (item.type === 'image') {
    const img = document.createElement('img');
    img.src = item.dataUrl || item.url || '';
    img.alt = '';
    el.appendChild(img);
  } else {
    el.classList.add('text-block');
    el.textContent = item.textContent != null ? item.textContent : '(file)';
  }

  makeDraggable(el);
  canvasEl.appendChild(el);
}

function makeDraggable(el) {
  let startX, startY, startLeft, startTop;
  el.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    startX = e.clientX;
    startY = e.clientY;
    startLeft = parseFloat(el.style.left) || 0;
    startTop = parseFloat(el.style.top) || 0;
    const onMove = (e2) => {
      const dx = e2.clientX - startX;
      const dy = e2.clientY - startY;
      const newLeft = Math.max(0, startLeft + dx);
      const newTop = Math.max(0, startTop + dy);
      el.style.left = `${newLeft}px`;
      el.style.top = `${newTop}px`;
      socket.emit('move_item', { id: el.dataset.id, x: newLeft, y: newTop });
      startLeft = newLeft;
      startTop = newTop;
      startX = e2.clientX;
      startY = e2.clientY;
    };
    const onUp = (e) => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      const rect = trashEl.getBoundingClientRect();
      if (e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom) {
        const id = el.dataset.id;
        fetch(`/api/board/${encodeURIComponent(currentBoardName)}/delete`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id }),
        }).catch((err) => console.error('Delete failed', err));
      }
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}

function loadBoardList() {
  fetch('/api/boards')
    .then((r) => r.json())
    .then((data) => {
      const names = data.names || [];
      if (!boardListEl) return;
      boardListEl.innerHTML = '';
      names.forEach((name) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'board-card';
        btn.textContent = name;
        btn.addEventListener('click', () => openBoard(name));
        boardListEl.appendChild(btn);
      });
    })
    .catch((err) => console.error('Failed to load boards', err));
}

function openBoard(name) {
  currentBoardName = name;
  fetch(`/api/board/${encodeURIComponent(name)}`)
    .then((r) => r.json())
    .then((state) => {
      boardState = state.items || [];
      renderBoard(boardState);
      socket.emit('join_board', { name });
      loadBoardList();
    })
    .catch((err) => console.error('Failed to open board', err));
}

socket.on('init_state', (state) => {
  boardState = state && state.items ? state.items : [];
  renderBoard(boardState);
});

socket.on('item_added', (item) => {
  boardState.push(item);
  appendItemToBoard(item);
  updateEmptyHint();
});

socket.on('item_moved', (data) => {
  const el = canvasEl && canvasEl.querySelector(`[data-id="${data.id}"]`);
  if (el) {
    el.style.left = `${data.x}px`;
    el.style.top = `${data.y}px`;
  }
  const item = boardState.find((i) => i.id === data.id);
  if (item) {
    item.x = data.x;
    item.y = data.y;
  }
});

socket.on('item_removed', (data) => {
  boardState = boardState.filter((i) => i.id !== data.id);
  const el = canvasEl && canvasEl.querySelector(`[data-id="${data.id}"]`);
  if (el) el.remove();
  updateEmptyHint();
});

socket.on('board_replaced', (state) => {
  boardState = state && state.items ? state.items : [];
  renderBoard(boardState);
});

saveBtn.addEventListener('click', () => {
  if (!currentBoardName) return;
  fetch(`/api/board/${encodeURIComponent(currentBoardName)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ version: 1, items: boardState }),
  })
    .then((r) => r.json())
    .then(() => {
      const msg = document.getElementById('save-msg');
      if (msg) {
        msg.textContent = 'Saved';
        msg.hidden = false;
        setTimeout(() => { msg.hidden = true; }, 1500);
      }
      loadBoardList();
    })
    .catch((err) => console.error('Save failed', err));
});

const wipeBtn = document.getElementById('wipe-btn');
if (wipeBtn) {
  wipeBtn.addEventListener('click', () => {
    if (!currentBoardName) return;
    if (!confirm('Wipe this board?')) return;
    if (!confirm('All items will be removed. Continue?')) return;
    fetch(`/api/board/${encodeURIComponent(currentBoardName)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version: 1, items: [] }),
    })
      .then((r) => r.json())
      .then(() => {
        boardState = [];
        renderBoard(boardState);
      })
      .catch((err) => console.error('Wipe failed', err));
  });
}

if (newBoardBtn && newBoardInput) {
  newBoardBtn.addEventListener('click', () => {
    const name = (newBoardInput.value || '').trim().replace(/[^a-zA-Z0-9_-]/g, '');
    if (!name) return;
    openBoard(name);
    newBoardInput.value = '';
    loadBoardList();
  });
}

const dropZone = canvasEl || boardEl;
if (dropZone) {
  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    if (!currentBoardName) return;
    const file = e.dataTransfer.files[0];
    if (!file) return;
    const rect = (canvasEl || boardEl).getBoundingClientRect();
    const form = new FormData();
    form.append('file', file);
    form.append('x', String(Math.max(0, Math.round(e.clientX - rect.left))));
    form.append('y', String(Math.max(0, Math.round(e.clientY - rect.top))));
    form.append('board', currentBoardName);
    fetch('/upload', { method: 'POST', body: form }).catch((err) => console.error('Upload failed', err));
  });
}

loadBoardList();
