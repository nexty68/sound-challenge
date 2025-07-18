// server.js
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import { nanoid } from 'nanoid';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, { cors: { origin: '*' } });

// Serve public folder
app.use(express.static(path.join(__dirname, 'public')));

// Serve index.html at root & /room/:room
app.get('/',        (_,res) => res.sendFile(path.join(__dirname,'public/index.html')));
app.get('/room/:r', (_,res) => res.sendFile(path.join(__dirname,'public/index.html')));

// In-memory rooms store
const rooms = {};

io.on('connection', socket => {
  // JOIN
  socket.on('join', ({ room, name }) => {
    socket.join(room);
    socket.data.room = room;
    socket.data.name = name;

    // Init room if needed
    if (!rooms[room]) {
      const mediaDir = path.join(__dirname, 'public', 'media');
      const files    = fs.existsSync(mediaDir) ? fs.readdirSync(mediaDir) : [];
      const mediaLibrary = files.map(file => {
        const ext  = path.extname(file).toLowerCase();
        const type = ext === '.mp4' ? 'video' : 'audio';
        return {
          id:     nanoid(),
          title:  path.basename(file, ext),
          type,
          source: `/media/${file}`
        };
      });
      rooms[room] = {
        host:         name,
        mediaLibrary,
        players:      {}
      };
    }

    // Register player
    rooms[room].players[name] = {
      submitted: false,
      audio:     null,
      scores:    { plus2: 0, plus1: 0, minus1: 0 },
      votedBy:   []
    };

    // Send initial data
    socket.emit('mediaLibrary', rooms[room].mediaLibrary);
    io.to(room).emit('players', rooms[room].players);
    socket.emit('isHost', name === rooms[room].host);
  });

  // SUBMIT imitation
  socket.on('submit', ({ name, url }) => {
    const r = rooms[socket.data.room];
    if (!r) return;
    r.players[name].submitted = true;
    r.players[name].audio     = url;
    io.to(socket.data.room).emit('players', r.players);
  });

  // PLAY original for all
  socket.on('playPlayback', ({ url, type }) => {
    io.to(socket.data.room).emit('playPlayback', { url, type });
  });

  // VOTE weighted
  socket.on('vote', ({ name, weight }) => {
    const r = rooms[socket.data.room];
    if (!r) return;
    const p = r.players[name];
    if (p.votedBy.includes(socket.data.name)) return;
    if (weight === 2)  p.scores.plus2++;
    if (weight === 1)  p.scores.plus1++;
    if (weight === -1) p.scores.minus1++;
    p.votedBy.push(socket.data.name);
    io.to(socket.data.room).emit('players', r.players);
  });

  // END ROUND → compute nets & broadcast
  socket.on('endRound', () => {
    const r = rooms[socket.data.room];
    if (!r) return;
    let winner = null, maxNet = -Infinity;
    Object.entries(r.players).forEach(([n,p]) => {
      p.net = p.scores.plus2*2 + p.scores.plus1 - p.scores.minus1;
      if (p.net > maxNet) { maxNet = p.net; winner = n; }
    });
    io.to(socket.data.room).emit('roundEnded', {
      winner,
      players: r.players
    });
  });

  // SEQUENTIAL REPLAY
  socket.on('playAllImitations', () => {
    const r = rooms[socket.data.room];
    if (!r) return;
    const items = Object.entries(r.players)
      .filter(([,p]) => p.submitted)
      .map(([n,p]) => ({ name: n, url: p.audio }));
    const INTERVAL = 8000; // 8s
    items.forEach((it, idx) => {
      setTimeout(() => {
        io.to(socket.data.room).emit('playOneImitation', it);
      }, idx * INTERVAL);
    });
  });

  // START NEXT ROUND (server-driven)
  socket.on('startRound', () => {
    const r = rooms[socket.data.room];
    if (!r) return;
    Object.values(r.players).forEach(p => {
      p.submitted = false;
      p.audio     = null;
      p.scores    = { plus2:0, plus1:0, minus1:0 };
      p.votedBy   = [];
      delete p.net;
    });
    io.to(socket.data.room).emit('roundStarted');
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
