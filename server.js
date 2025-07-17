// server.js
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import { nanoid } from 'nanoid';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

// ==== Recalcule __dirname en module ES ====
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

// Sert tous les fichiers statiques dans public/
app.use(express.static(path.join(__dirname, 'public')));

// Pour toutes les routes /room/... retourne index.html
app.get('/room/:room', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/index.html'));
});

// Structure de stockage en mémoire des rooms
// rooms = { [roomId]: { host, mediaLibrary, players: { [name]: { submitted, votes, audio } } } }
const rooms = {};

io.on('connection', socket => {
  // 1) Un client rejoint une room
  socket.on('join', ({ room, name }) => {
    socket.join(room);
    socket.data.room = room;
    socket.data.name = name;

    // Crée la room si elle n'existe pas encore
    if (!rooms[room]) {
      // Scan du dossier public/media pour générer la mediaLibrary
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

    // Ajoute le joueur dans la room
    rooms[room].players[name] = {
      submitted: false,
      votes: 0,
      audio: null
    };

    // Envoie au client la mediaLibrary et l'état des joueurs
    socket.emit('mediaLibrary', rooms[room].mediaLibrary);
    io.to(room).emit('players', rooms[room].players);

    // Informe le client s'il est l'hôte
    socket.emit('isHost', name === rooms[room].host);
  });

  // 2) Quand un joueur soumet son imitation
  socket.on('submit', ({ name, url }) => {
    const room = socket.data.room;
    if (!rooms[room]) return;
    rooms[room].players[name].submitted = true;
    rooms[room].players[name].audio = url;
    io.to(room).emit('players', rooms[room].players);
  });

  // 3) Rejoue un media (original ou imitation) pour tous
  socket.on('playPlayback', ({ url, type }) => {
    io.to(socket.data.room).emit('playPlayback', { url, type });
  });

  // 4) Un vote pour un joueur
  socket.on('vote', votedName => {
    const room = socket.data.room;
    if (!rooms[room]) return;
    rooms[room].players[votedName].votes++;
    io.to(room).emit('players', rooms[room].players);
  });

  // 5) L'hôte termine la manche et calcule le gagnant
  socket.on('endRound', () => {
    const room = socket.data.room;
    if (!rooms[room]) return;
    const players = rooms[room].players;
    // Trouver le nom avec le plus de votes
    const winnerName = Object.keys(players)
      .reduce((a, b) => (players[b].votes > players[a].votes ? b : a));
    io.to(room).emit('roundEnded', { winnerName, players });
  });

  // 6) L'hôte demande la relecture de toutes les imitations
  socket.on('playAllImitations', () => {
    const room = socket.data.room;
    if (!rooms[room]) return;
    io.to(room).emit('playAllImitations', rooms[room].players);
  });

  // 7) L'hôte démarre la manche suivante (reset players)
  socket.on('start', () => {
    const room = socket.data.room;
    if (!rooms[room]) return;
    const R = rooms[room];
    for (let p of Object.values(R.players)) {
      p.submitted = false;
      p.votes = 0;
      p.audio = null;
    }
    io.to(room).emit('players', R.players);
    io.to(room).emit('start');
  });
});

// Démarrage du serveur
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
