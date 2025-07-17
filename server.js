import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import { nanoid } from 'nanoid';
import path from 'path';

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Fallback pour toutes les rooms : renvoie index.html
app.get('/room/:room', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/index.html'));
});

const rooms = {};  // { roomId: { host, mediaLibrary, players: { [name]: { submitted, votes, audio } } } }

io.on('connection', socket => {
  // 1. Un client rejoint une room
  socket.on('join', ({ room, name }) => {
    socket.join(room);
    socket.data.room = room;
    socket.data.name = name;

    // Création de la room si nécessaire
    if (!rooms[room]) {
      rooms[room] = {
        host: name,
        mediaLibrary: [
          // Exemples : remplace par tes fichiers / URLs
          { title:'This is Sparta!', type:'audio', source:'https://www.soundjay.com/button/button-3.mp3' },
          { title:'Wilhelm Scream',  type:'audio', source:'https://www.soundjay.com/button/button-10.mp3' },
          { title:'Lion Roar',      type:'video', source:'https://www.youtube.com/embed/GibiNy4d4gc' }
        ],
        players: {}
      };
    }

    // Ajout du joueur
    rooms[room].players[name] = { submitted:false, votes:0, audio:null };

    // Envoi la liste des médias + état players
    io.to(room).emit('mediaLibrary', rooms[room].mediaLibrary);
    io.to(room).emit('players', rooms[room].players);

    // Informe le client s’il est l’hôte
    socket.emit('isHost', name === rooms[room].host);
  });

  // 2. Soumission d’une imitation
  socket.on('submit', ({ name, url }) => {
    const room = socket.data.room;
    rooms[room].players[name].submitted = true;
    rooms[room].players[name].audio = url;
    io.to(room).emit('players', rooms[room].players);
  });

  // 3. Rejoue un media (original ou imitation) pour tous
  socket.on('playPlayback', ({ url, type }) => {
    io.to(socket.data.room).emit('playPlayback', { url, type });
  });

  // 4. Vote pour un joueur
  socket.on('vote', votedName => {
    const room = socket.data.room;
    rooms[room].players[votedName].votes++;
    io.to(room).emit('players', rooms[room].players);
  });

  // 5. L’hôte termine la manche et calcule le gagnant
  socket.on('endRound', () => {
    const room = socket.data.room;
    const players = rooms[room].players;
    // Trouver le nom avec le plus de votes
    const winnerName = Object.keys(players)
      .reduce((a,b) => players[b].votes > players[a].votes ? b : a);
    io.to(room).emit('roundEnded', { winnerName, players });
  });

  // 6. L’hôte déclenche la relecture de toutes les imitations
  socket.on('playAllImitations', () => {
    const room = socket.data.room;
    io.to(room).emit('playAllImitations', rooms[room].players);
  });

  // 7. Démarrer la manche suivante (reset)
  socket.on('start', () => {
    const room = socket.data.room;
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

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
