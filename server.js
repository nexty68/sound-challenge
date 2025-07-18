// server.js
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import { nanoid } from 'nanoid';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

// Recreate __dirname in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// Serve static assets
app.use(express.static(path.join(__dirname, 'public')));

// Serve index.html on root
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/index.html'));
});

// Serve index.html for any /room/:room
app.get('/room/:room', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/index.html'));
});

// In-memory room store
const rooms = {};

io.on('connection', socket => {
  socket.on('join', ({ room, name }) => {
    socket.join(room);
    socket.data.room = room;
    socket.data.name = name;

    // Initialize room if needed
    if (!rooms[room]) {
      const mediaDir = path.join(__dirname, 'public', 'media');
      const files = fs.existsSync(mediaDir) ? fs.readdirSync(mediaDir) : [];
      const mediaLibrary = files.map(file => {
        const ext = path.extname(file).toLowerCase();
        const type = ext === '.mp4' ? 'video' : 'audio';
        return { id: nanoid(), title: path.basename(file, ext), type, source: `/media/${file}` };
      });
      rooms[room] = { host: name, mediaLibrary, players: {} };
    }

    // Add player
    rooms[room].players[name] = {
      submitted: false,
      scores: { plus2: 0, plus1: 0, minus1: 0 },
      audio: null,
      votedBy: []
    };

    // Send initial data
    socket.emit('mediaLibrary', rooms[room].mediaLibrary);
    io.to(room).emit('players', rooms[room].players);
    socket.emit('isHost', name === rooms[room].host);
  });

  socket.on('submit', ({ name, url }) => {
    const r = rooms[socket.data.room];
    if (!r) return;
    r.players[name].submitted = true;
    r.players[name].audio = url;
    io.to(socket.data.room).emit('players', r.players);
  });

  socket.on('playPlayback', ({ url, type }) => {
    io.to(socket.data.room).emit('playPlayback', { url, type });
  });

  socket.on('vote', ({ name, weight }) => {
    const r = rooms[socket.data.room];
    if (!r) return;
    const p = r.players[name];
    if (p.votedBy.includes(socket.data.name)) return;
    if (weight === 2) p.scores.plus2++;
    if (weight === 1) p.scores.plus1++;
    if (weight === -1) p.scores.minus1++;
    p.votedBy.push(socket.data.name);
    io.to(socket.data.room).emit('players', r.players);
  });

  socket.on('endRound', () => {
    const r = rooms[socket.data.room];
    if (!r) return;
    let winner = null, maxNet = -Infinity;
    for (const [n,p] of Object.entries(r.players)) {
      const net = p.scores.plus2*2 + p.scores.plus1 - p.scores.minus1;
      p.net = net;
      if (net > maxNet) { maxNet = net; winner = n; }
    }
    io.to(socket.data.room).emit('roundEnded', { winner, players: r.players });
  });

  socket.on('playAllImitations', () => {
    const r = rooms[socket.data.room];
    if (!r) return;
    io.to(socket.data.room).emit('playAllImitations', r.players);
  });

  socket.on('start', () => {
    const r = rooms[socket.data.room];
    if (!r) return;
    for (const p of Object.values(r.players)) {
      p.submitted = false;
      p.audio = null;
      p.scores = { plus2:0, plus1:0, minus1:0 };
      p.votedBy = [];
    }
    io.to(socket.data.room).emit('players', r.players);
    io.to(socket.data.room).emit('start');
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
