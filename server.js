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

// Serve static files from /public
app.use(express.static(path.join(__dirname, 'public')));

// Serve index.html on root and on /room/:room
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/index.html'));
});
app.get('/room/:room', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/index.html'));
});

// In-memory store
const rooms = {};

io.on('connection', socket => {
  // 1) Join a room
  socket.on('join', ({ room, name }) => {
    socket.join(room);
    socket.data.room = room;
    socket.data.name = name;

    // If room not exist, init it
    if (!rooms[room]) {
      const mediaDir = path.join(__dirname, 'public', 'media');
      const files = fs.existsSync(mediaDir) ? fs.readdirSync(mediaDir) : [];
      const mediaLibrary = files.map(file => {
        const ext = path.extname(file).toLowerCase();
        const type = ext === '.mp4' ? 'video' : 'audio';
        return {
          id: nanoid(),
          title: path.basename(file, ext),
          type,
          source: `/media/${file}`
        };
      });
      rooms[room] = {
        host: name,
        mediaLibrary,
        players: {}
      };
    }

    // Add player
    rooms[room].players[name] = {
      submitted: false,
      audio: null,
      scores: { plus2: 0, plus1: 0, minus1: 0 },
      votedBy: []
    };

    // Send initial state
    socket.emit('mediaLibrary', rooms[room].mediaLibrary);
    io.to(room).emit('players', rooms[room].players);
    socket.emit('isHost', name === rooms[room].host);
  });

  // 2) Submit imitation
  socket.on('submit', ({ name, url }) => {
    const room = socket.data.room;
    if (!rooms[room]) return;
    rooms[room].players[name].submitted = true;
    rooms[room].players[name].audio = url;
    io.to(room).emit('players', rooms[room].players);
  });

  // 3) Play one media for everyone
  socket.on('playPlayback', ({ url, type }) => {
    io.to(socket.data.room).emit('playPlayback', { url, type });
  });

  // 4) Weighted vote
  socket.on('vote', ({ name, weight }) => {
    const room = socket.data.room;
    if (!rooms[room]) return;
    const p = rooms[room].players[name];
    if (p.votedBy.includes(socket.data.name)) return;
    if (weight === 2) p.scores.plus2++;
    if (weight === 1) p.scores.plus1++;
    if (weight === -1) p.scores.minus1++;
    p.votedBy.push(socket.data.name);
    io.to(room).emit('players', rooms[room].players);
  });

  // 5) End round → calculate winner by net score
  socket.on('endRound', () => {
    const room = socket.data.room;
    if (!rooms[room]) return;
    let winner = null, max = -Infinity;
    for (const [n, p] of Object.entries(rooms[room].players)) {
      const net = p.scores.plus2 * 2 + p.scores.plus1 - p.scores.minus1;
      p.net = net;
      if (net > max) { max = net; winner = n; }
    }
    io.to(room).emit('roundEnded', { winner, players: rooms[room].players });
  });

  // 6) Play all imitations
  socket.on('playAllImitations', () => {
    const room = socket.data.room;
    if (!rooms[room]) return;
    io.to(room).emit('playAllImitations', rooms[room].players);
  });

  // 7) Start next round (reset)
  socket.on('start', () => {
    const room = socket.data.room;
    if (!rooms[room]) return;
    for (const p of Object.values(rooms[room].players)) {
      p.submitted = false;
      p.audio = null;
      p.scores = { plus2: 0, plus1: 0, minus1: 0 };
      p.votedBy = [];
    }
    io.to(room).emit('players', rooms[room].players);
    io.to(room).emit('start');
  });
});

// Launch
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server listening on ${PORT}`));
