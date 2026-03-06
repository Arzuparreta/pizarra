const socket = io();
const boardEl = document.getElementById('board');
const emptyHintEl = document.getElementById('empty-hint');
const saveBtn = document.getElementById('save-board');
const openBtn = document.getElementById('open-board');
const openInput = document.getElementById('open-board-input');
const wipeBtn = document.getElementById('wipe-btn');
const trashEl = document.getElementById('trash');

let boardState = [];

function updateEmptyHint() {
  emptyHintEl.hidden = boardState.length > 0;
}

function renderBoard(state) {
  boardEl.querySelectorAll('.board-item').forEach((el) => el.remove());
  state.forEach((item) => appendItemToBoard(item));
  updateEmptyHint();
}

function appendItemToBoard(item) {
  const el = document.createElement('div');
  el.className = 'board-item';
  el.dataset.id = item.id;
  el.style.left = `${item.x}px`;
  el.style.top = `${item.y}px`;

  if (item.type === 'image') {
    const img = document.createElement('img');
    img.src = item.url;
    img.alt = '';
    el.appendChild(img);
  } else {
    el.classList.add('text-block');
    el.textContent = item.textContent != null ? item.textContent : '(file)';
  }

  makeDraggable(el);
  boardEl.appendChild(el);
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
        fetch('/board/delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id }),
        }).catch((err) => console.error('Delete failed', err));
      }
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', (e) => onUp(e));
  });
}

saveBtn.addEventListener('click', () => {
  window.location.href = '/board/export';
});

openBtn.addEventListener('click', () => {
  openInput.click();
});

openInput.addEventListener('change', () => {
  const file = openInput.files && openInput.files[0];
  if (!file) return;
  const form = new FormData();
  form.append('board', file);
  fetch('/board/import', { method: 'POST', body: form })
    .catch((err) => console.error('Import failed', err))
    .finally(() => { openInput.value = ''; });
});

wipeBtn.addEventListener('click', () => {
  fetch('/board/wipe', { method: 'POST' }).catch((err) => console.error('Wipe failed', err));
});

boardEl.addEventListener('dragover', (e) => {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
});

boardEl.addEventListener('drop', (e) => {
  e.preventDefault();
  const x = e.clientX - boardEl.getBoundingClientRect().left;
  const y = e.clientY - boardEl.getBoundingClientRect().top;
  const files = e.dataTransfer.files;
  if (!files.length) return;
  files.forEach((file) => {
    const form = new FormData();
    form.append('file', file);
    form.append('x', String(Math.max(0, Math.round(x))));
    form.append('y', String(Math.max(0, Math.round(y))));
    fetch('/upload', { method: 'POST', body: form }).catch((err) => console.error('Upload failed', err));
  });
});

socket.on('init_state', (state) => {
  boardState = state;
  renderBoard(boardState);
});

socket.on('item_added', (item) => {
  boardState.push(item);
  appendItemToBoard(item);
  updateEmptyHint();
});

socket.on('item_moved', (data) => {
  const el = boardEl.querySelector(`[data-id="${data.id}"]`);
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

socket.on('board_replaced', (state) => {
  boardState = state;
  renderBoard(boardState);
});

socket.on('item_removed', (data) => {
  boardState = boardState.filter((i) => i.id !== data.id);
  const el = boardEl.querySelector(`[data-id="${data.id}"]`);
  if (el) el.remove();
  updateEmptyHint();
});
