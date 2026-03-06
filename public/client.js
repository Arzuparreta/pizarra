const socket = io();
const boardEl = document.getElementById('board');
const canvasEl = document.getElementById('canvas');
const emptyHintEl = document.getElementById('empty-hint');
const boardListEl = document.getElementById('board-list');
const trashEl = document.getElementById('trash');

function sanitizeBoardName(name) {
  if (typeof name !== 'string') return '';
  const safe = name.replace(/[^a-zA-Z0-9_-]/g, '');
  return safe;
}

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

function createBoardRow(name) {
  const card = document.createElement('div');
  card.className = 'board-card';
  const nameEl = document.createElement('span');
  nameEl.className = 'board-card-name';
  nameEl.textContent = name;
  nameEl.addEventListener('click', (e) => { e.stopPropagation(); openBoard(name); });
  const actions = document.createElement('div');
  actions.className = 'board-card-actions';
  const renameBtn = document.createElement('button');
  renameBtn.type = 'button';
  renameBtn.setAttribute('aria-label', 'Rename');
  renameBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>';
  renameBtn.addEventListener('click', (e) => { e.stopPropagation(); startRename(card, name); });
  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.className = 'delete';
  deleteBtn.setAttribute('aria-label', 'Delete');
  deleteBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
  deleteBtn.addEventListener('click', (e) => { e.stopPropagation(); deleteBoard(name); });
  actions.appendChild(renameBtn);
  actions.appendChild(deleteBtn);
  card.appendChild(nameEl);
  card.appendChild(actions);
  return card;
}

function startRename(card, name) {
  const nameEl = card.querySelector('.board-card-name');
  const text = nameEl.textContent;
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'board-card-name';
  input.value = text;
  input.addEventListener('blur', commitRename);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); if (e.key === 'Escape') { input.value = text; input.blur(); } });
  card.replaceChild(input, nameEl);
  input.focus();
  input.select();
  function commitRename() {
    const newName = sanitizeBoardName(input.value);
    card.removeChild(input);
    const span = document.createElement('span');
    span.className = 'board-card-name';
    span.textContent = name;
    span.addEventListener('click', (e) => { e.stopPropagation(); openBoard(name); });
    card.insertBefore(span, card.querySelector('.board-card-actions'));
    if (!newName || newName === name) return;
    fetch(`/api/board/${encodeURIComponent(name)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName }),
    })
      .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
      .then(() => {
        if (currentBoardName === name) {
          currentBoardName = newName;
          socket.emit('join_board', { name: newName });
        }
        loadBoardList();
      })
      .catch(() => loadBoardList());
  }
}

function deleteBoard(name) {
  if (!confirm('Delete this board?')) return;
  fetch(`/api/board/${encodeURIComponent(name)}`, { method: 'DELETE' })
    .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
    .then(() => {
      const wasCurrent = currentBoardName === name;
      if (wasCurrent) {
        currentBoardName = null;
        boardState = [];
        renderBoard([]);
      }
      return loadBoardList().then((data) => {
        if (wasCurrent && data.names && data.names.length > 0) openBoard(data.names[0]);
      });
    })
    .catch((err) => console.error('Delete board failed', err));
}

function createBoard() {
  return fetch('/api/boards')
    .then((r) => r.json())
    .then((data) => {
      const names = data.names || [];
      let id = 'New_Board';
      let n = 2;
      while (names.includes(id)) { id = `New_Board_${n}`; n++; }
      return fetch(`/api/board/${encodeURIComponent(id)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version: 1, items: [] }),
      }).then((r) => { if (!r.ok) throw new Error(); return id; });
    });
}

function loadBoardList() {
  return fetch('/api/boards')
    .then((r) => r.json())
    .then((data) => {
      const names = data.names || [];
      if (!boardListEl) return data;
      boardListEl.innerHTML = '';
      names.forEach((name) => boardListEl.appendChild(createBoardRow(name)));
      return data;
    })
    .catch((err) => { console.error('Failed to load boards', err); return { names: [] }; });
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

const addBoardBtn = document.getElementById('add-board-btn');
if (addBoardBtn) {
  addBoardBtn.addEventListener('click', () => {
    createBoard().then((id) => { openBoard(id); loadBoardList(); }).catch((err) => console.error('Create board failed', err));
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

loadBoardList().then((data) => {
  if (data.names && data.names.length === 0) {
    createBoard().then((id) => { openBoard(id); return loadBoardList(); }).catch((err) => console.error('Create board failed', err));
  }
});
