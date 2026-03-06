const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
const PORT = 3000;
const HOST = '0.0.0.0';

const boardsDir = path.join(__dirname, 'boards');
fs.mkdirSync(boardsDir, { recursive: true });

const boardStates = {};
const saveDebounce = {};
const SAVE_DEBOUNCE_MS = 400;

function sanitizeBoardName(name) {
  if (typeof name !== 'string') return null;
  const safe = name.replace(/[^a-zA-Z0-9_-]/g, '');
  return safe.length > 0 ? safe : null;
}

function getBoardState(name) {
  const safe = sanitizeBoardName(name);
  if (!safe) return null;
  if (boardStates[safe]) return boardStates[safe];
  const filePath = path.join(boardsDir, `${safe}.json`);
  if (!fs.existsSync(filePath)) {
    const initial = { version: 1, items: [] };
    boardStates[safe] = initial;
    try {
      fs.writeFileSync(filePath, JSON.stringify(initial, null, 2), 'utf8');
    } catch (err) {
      console.error('Failed to create board file:', err);
    }
    return initial;
  }
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (data && typeof data.version === 'number' && Array.isArray(data.items)) {
      boardStates[safe] = data;
      return data;
    }
  } catch (err) {
    console.error('Failed to load board:', err);
  }
  const initial = { version: 1, items: [] };
  boardStates[safe] = initial;
  return initial;
}

function saveBoardToFile(name) {
  const safe = sanitizeBoardName(name);
  if (!safe || !boardStates[safe]) return;
  const filePath = path.join(boardsDir, `${safe}.json`);
  fs.writeFileSync(filePath, JSON.stringify(boardStates[safe], null, 2), 'utf8');
}

function isImage(mimetype) {
  return /^image\//.test(mimetype);
}

function isText(mimetype, filename) {
  return mimetype === 'text/plain' || /\.(txt|md|json)$/i.test(filename || '');
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/boards', (req, res) => {
  try {
    const names = fs.readdirSync(boardsDir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => path.basename(f, '.json'));
    res.json({ names });
  } catch (err) {
    console.error('List boards error:', err);
    res.status(500).json({ error: 'Failed to list boards' });
  }
});

app.get('/api/board/:name', (req, res) => {
  const state = getBoardState(req.params.name);
  if (!state) return res.status(400).json({ error: 'Invalid board name' });
  res.json(state);
});

app.post('/api/board/:name', (req, res) => {
  const safe = sanitizeBoardName(req.params.name);
  if (!safe) return res.status(400).json({ error: 'Invalid board name' });
  const { version, items } = req.body;
  if (typeof version !== 'number' || !Array.isArray(items)) {
    return res.status(400).json({ error: 'Invalid body: need version and items' });
  }
  boardStates[safe] = { version, items };
  try {
    saveBoardToFile(safe);
  } catch (err) {
    console.error('Save board error:', err);
    return res.status(500).json({ error: 'Failed to save board' });
  }
  io.to(`board:${safe}`).emit('board_replaced', boardStates[safe]);
  res.json({ success: true });
});

app.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const board = sanitizeBoardName(req.body.board);
  if (!board) return res.status(400).json({ error: 'Missing or invalid board name' });

  const state = getBoardState(board);
  const x = Number(req.body.x) || 0;
  const y = Number(req.body.y) || 0;
  const id = crypto.randomUUID();
  const mimetype = req.file.mimetype || '';
  const filename = req.file.originalname || '';

  const type = isImage(mimetype) ? 'image' : 'text';
  let item;

  if (type === 'image') {
    const base64 = req.file.buffer.toString('base64');
    const dataUrl = `data:${mimetype};base64,${base64}`;
    item = { id, type, x, y, dataUrl };
  } else {
    let textContent = null;
    if (isText(mimetype, filename)) {
      try {
        textContent = req.file.buffer.toString('utf8');
      } catch (_) {
        textContent = '';
      }
    }
    item = { id, type, x, y, textContent };
  }

  state.items.push(item);
  saveBoardToFile(board);
  io.to(`board:${board}`).emit('item_added', item);
  res.json({ success: true, item });
});

app.post('/api/board/:name/delete', (req, res) => {
  const safe = sanitizeBoardName(req.params.name);
  if (!safe) return res.status(400).json({ error: 'Invalid board name' });
  const { id } = req.body;
  if (!id) return res.status(400).json({ error: 'Missing id' });

  const state = boardStates[safe];
  if (!state) return res.status(404).json({ error: 'Board not found' });
  const idx = state.items.findIndex((i) => i.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Item not found' });

  state.items.splice(idx, 1);
  saveBoardToFile(safe);
  io.to(`board:${safe}`).emit('item_removed', { id });
  res.json({ success: true });
});

app.delete('/api/board/:name', (req, res) => {
  const safe = sanitizeBoardName(req.params.name);
  if (!safe) return res.status(400).json({ error: 'Invalid board name' });
  const filePath = path.join(boardsDir, `${safe}.json`);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Board not found' });
  delete boardStates[safe];
  try {
    fs.unlinkSync(filePath);
  } catch (err) {
    console.error('Delete board error:', err);
    return res.status(500).json({ error: 'Failed to delete board' });
  }
  res.json({ success: true });
});

app.patch('/api/board/:name', (req, res) => {
  const safe = sanitizeBoardName(req.params.name);
  if (!safe) return res.status(400).json({ error: 'Invalid board name' });
  const newName = sanitizeBoardName(req.body && req.body.name);
  if (!newName) return res.status(400).json({ error: 'Invalid new name' });
  if (newName === safe) return res.json({ success: true });
  const oldPath = path.join(boardsDir, `${safe}.json`);
  if (!fs.existsSync(oldPath)) return res.status(404).json({ error: 'Board not found' });
  const newPath = path.join(boardsDir, `${newName}.json`);
  if (fs.existsSync(newPath)) return res.status(400).json({ error: 'Name already in use' });
  const state = getBoardState(safe);
  if (!state) return res.status(404).json({ error: 'Board not found' });
  boardStates[newName] = state;
  delete boardStates[safe];
  try {
    fs.writeFileSync(newPath, JSON.stringify(state, null, 2), 'utf8');
    fs.unlinkSync(oldPath);
  } catch (err) {
    console.error('Rename board error:', err);
    delete boardStates[newName];
    boardStates[safe] = state;
    return res.status(500).json({ error: 'Failed to rename board' });
  }
  res.json({ success: true });
});

const httpServer = app.listen(PORT, HOST, () => {
  console.log(`Pizarra server at http://${HOST}:${PORT}`);
});

const io = new Server(httpServer);

io.on('connection', (socket) => {
  socket.on('join_board', (data) => {
    const name = sanitizeBoardName(data && data.name);
    if (!name) return;
    getBoardState(name);
    socket.join(`board:${name}`);
    socket.currentBoard = name;
    socket.emit('init_state', boardStates[name]);
  });

  socket.on('move_item', (data) => {
    const name = socket.currentBoard;
    if (!name) return;
    const state = boardStates[name];
    if (!state) return;
    const { id, x, y } = data;
    const item = state.items.find((i) => i.id === id);
    if (item) {
      item.x = x;
      item.y = y;
      socket.to(`board:${name}`).emit('item_moved', { id, x, y });
      if (saveDebounce[name]) clearTimeout(saveDebounce[name]);
      saveDebounce[name] = setTimeout(() => {
        delete saveDebounce[name];
        saveBoardToFile(name);
      }, SAVE_DEBOUNCE_MS);
    }
  });
});
