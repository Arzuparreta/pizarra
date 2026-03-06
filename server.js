const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const { Server } = require('socket.io');
const cors = require('cors');
const archiver = require('archiver');
const AdmZip = require('adm-zip');

const app = express();
const PORT = 3000;
const HOST = '0.0.0.0';

// Ensure board directory exists and clear any leftover assets from previous runs.
// The board does not persist unless the user explicitly saves (export) and later opens (import) that file.
const boardDir = path.join(__dirname, 'board');
fs.mkdirSync(boardDir, { recursive: true });

function clearBoardDir() {
  try {
    const names = fs.readdirSync(boardDir);
    for (const name of names) {
      if (name === '.gitkeep') continue;
      const p = path.join(boardDir, name);
      try {
        fs.unlinkSync(p);
      } catch {
        // ignore
      }
    }
  } catch (err) {
    console.error('Failed to clear board directory:', err);
  }
}

clearBoardDir();

function ext(name) {
  return path.extname(name) || '';
}

// Multer: save uploads to board, preserve extension
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, boardDir),
  filename: (_req, file, cb) => {
    cb(null, `${crypto.randomUUID()}${ext(file.originalname)}`);
  },
});
const upload = multer({ storage });

// Multer: import .pizarra files into memory
const importUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB
  },
});

// In-memory board state: { id, type, url, textContent, x, y }[]
let boardState = [];

function isImage(mimetype) {
  return /^image\//.test(mimetype);
}

function isText(mimetype, filename) {
  return mimetype === 'text/plain' || /\.(txt|md|json)$/i.test(filename || '');
}

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/board', express.static(boardDir));

function buildManifestFromState(state) {
  return {
    version: 1,
    items: state.map((item) => {
      const base = {
        id: item.id,
        type: item.type,
        x: item.x,
        y: item.y,
      };
      if (item.type === 'image' && item.url) {
        return {
          ...base,
          asset: `assets/${item.id}${ext(path.basename(item.url))}`,
        };
      }
      return {
        ...base,
        textContent: item.textContent != null ? item.textContent : null,
      };
    }),
  };
}

app.get('/board/export', (req, res) => {
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', 'attachment; filename="board.pizarra"');

  const archive = archiver('zip', { zlib: { level: 9 } });

  archive.on('error', (err) => {
    console.error('Export error:', err);
    if (!res.headersSent) {
      res.status(500).end();
    } else {
      res.end();
    }
  });

  archive.pipe(res);

  const manifest = buildManifestFromState(boardState);
  archive.append(JSON.stringify(manifest, null, 2), { name: 'manifest.json' });

  boardState.forEach((item) => {
    if (item.type !== 'image' || !item.url) return;
    const basename = path.basename(item.url);
    const srcPath = path.join(boardDir, basename);
    if (!fs.existsSync(srcPath)) return;
    archive.file(srcPath, { name: `assets/${item.id}${ext(basename)}` });
  });

  archive.finalize();
});

app.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }
  const x = Number(req.body.x) || 0;
  const y = Number(req.body.y) || 0;
  const relativeUrl = `/board/${req.file.filename}`;
  const id = crypto.randomUUID();
  const mimetype = req.file.mimetype || '';
  const filename = req.file.originalname || '';

  const type = isImage(mimetype) ? 'image' : 'text';
  let textContent = null;
  if (type === 'text' && isText(mimetype, filename)) {
    try {
      textContent = fs.readFileSync(req.file.path, 'utf8');
    } catch (_) {
      textContent = '';
    }
  }

  const item = { id, type, url: relativeUrl, textContent, x, y };
  boardState.push(item);
  io.emit('item_added', item);
  res.json({ success: true, item });
});

app.post('/board/import', importUpload.single('board'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No board file uploaded' });
  }

  let zip;
  try {
    zip = new AdmZip(req.file.buffer);
  } catch (err) {
    console.error('Import error (zip):', err);
    return res.status(400).json({ error: 'Invalid board file' });
  }

  const manifestEntry = zip.getEntry('manifest.json');
  if (!manifestEntry) {
    return res.status(400).json({ error: 'Board file is missing manifest.json' });
  }

  let manifest;
  try {
    manifest = JSON.parse(manifestEntry.getData().toString('utf8'));
  } catch (err) {
    console.error('Import error (manifest JSON):', err);
    return res.status(400).json({ error: 'Invalid manifest in board file' });
  }

  if (!manifest || manifest.version !== 1 || !Array.isArray(manifest.items)) {
    return res.status(400).json({ error: 'Unsupported or invalid board manifest' });
  }

  clearBoardDir();

  const newState = [];

  for (const item of manifest.items) {
    const type = item.type;
    const x = Number(item.x) || 0;
    const y = Number(item.y) || 0;

    if (type === 'image' && item.asset) {
      const entry = zip.getEntry(item.asset);
      if (!entry) continue;
      const filename = `${crypto.randomUUID()}${ext(item.asset)}`;
      const destPath = path.join(boardDir, filename);
      try {
        fs.writeFileSync(destPath, entry.getData());
      } catch (err) {
        console.error('Failed to write asset file:', err);
        continue;
      }
      newState.push({
        id: crypto.randomUUID(),
        type: 'image',
        url: `/board/${filename}`,
        textContent: null,
        x,
        y,
      });
    } else if (type === 'text') {
      newState.push({
        id: crypto.randomUUID(),
        type: 'text',
        url: null,
        textContent: item.textContent != null ? item.textContent : null,
        x,
        y,
      });
    }
  }

  boardState = newState;
  io.emit('board_replaced', boardState);

  return res.json({ success: true, count: boardState.length });
});

app.post('/board/wipe', (_req, res) => {
  boardState = [];
  clearBoardDir();
  io.emit('board_replaced', boardState);
  return res.json({ success: true });
});

app.post('/board/delete', (req, res) => {
  const { id } = req.body;
  if (!id) {
    return res.status(400).json({ error: 'Missing id' });
  }
  const item = boardState.find((i) => i.id === id);
  if (!item) {
    return res.status(400).json({ error: 'Item not found' });
  }
  if (item.type === 'image' && item.url) {
    const basename = path.basename(item.url);
    const filePath = path.join(boardDir, basename);
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (err) {
      console.error('Failed to delete asset file:', err);
    }
  }
  boardState = boardState.filter((i) => i.id !== id);
  io.emit('item_removed', { id });
  return res.json({ success: true });
});

const httpServer = app.listen(PORT, HOST, () => {
  console.log(`Pizarra server at http://${HOST}:${PORT}`);
});

const io = new Server(httpServer);

io.on('connection', (socket) => {
  socket.emit('init_state', boardState);

  socket.on('move_item', (data) => {
    const { id, x, y } = data;
    const item = boardState.find((i) => i.id === id);
    if (item) {
      item.x = x;
      item.y = y;
      socket.broadcast.emit('item_moved', { id, x, y });
    }
  });
});
