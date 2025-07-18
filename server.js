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

// Serve static
app.use(express.static(path.join(__dirname, 'public')));
app.get('/',        (_,res)=>res.sendFile(path.join(__dirname,'public/index.html')));
app.get('/room/:r', (_,res)=>res.sendFile(path.join(__dirname,'public/index.html')));

// Rooms store
const rooms = {};

io.on('connection', socket => {
  // JOIN ROOM
  socket.on('join', ({ room, name }) => {
    socket.join(room);
    socket.data.room = room;
    socket.data.name = name;

    // Init room
    if (!rooms[room]) {
      const mediaDir = path.join(__dirname,'public','media');
      const files    = fs.existsSync(mediaDir)?fs.readdirSync(mediaDir):[];
      const lib = files.map(file=>{
        const ext  = path.extname(file).toLowerCase();
        const type = ext==='.mp4'?'video':'audio';
        return { id: nanoid(), title: path.basename(file,ext), type, source:`/media/${file}` };
      });
      rooms[room] = {
        host:           name,
        mediaLibrary:   lib,
        currentIndex:   0,
        players:        {}
      };
    }

    const R = rooms[room];

    // Add player
    R.players[name] = {
      submitted:false, audio:null,
      scores:{plus2:0,plus1:0,minus1:0},
      votedBy:[]
    };

    // Send state
    socket.emit('mediaLibrary', R.mediaLibrary);
    socket.emit('newMedia', { index:R.currentIndex, media:R.mediaLibrary[R.currentIndex] });
    io.to(room).emit('players', R.players);
    socket.emit('isHost', name===R.host);
  });

  // SUBMIT imitation
  socket.on('submit', ({ name, url }) => {
    const R = rooms[socket.data.room];
    if (!R) return;
    R.players[name].submitted = true;
    R.players[name].audio     = url;
    io.to(socket.data.room).emit('players', R.players);
  });

  // PLAY original
  socket.on('playPlayback', ({ url, type }) => {
    io.to(socket.data.room).emit('playPlayback', { url, type });
  });

  // WEIGHTED VOTE
  socket.on('vote', ({ name, weight }) => {
    const R = rooms[socket.data.room];
    if (!R) return;
    const p = R.players[name];
    if (p.votedBy.includes(socket.data.name)) return;
    if (weight===2)  p.scores.plus2++;
    if (weight===1)  p.scores.plus1++;
    if (weight===-1) p.scores.minus1++;
    p.votedBy.push(socket.data.name);
    io.to(socket.data.room).emit('players', R.players);
  });

  // END ROUND
  socket.on('endRound', () => {
    const room = socket.data.room, R = rooms[room];
    if (!R) return;
    let winner=null, max=-Infinity;
    Object.entries(R.players).forEach(([n,p])=>{
      p.net = p.scores.plus2*2 + p.scores.plus1 - p.scores.minus1;
      if (p.net>max){ max=p.net; winner=n; }
    });
    io.to(room).emit('roundEnded', { winner, players:R.players });
  });

  // SEQUENTIAL REPLAY (server drives timing)
  socket.on('playAllImitations', () => {
    const room = socket.data.room, R = rooms[room];
    if (!R) return;
    const items = Object.entries(R.players)
                     .filter(([,p])=>p.submitted)
                     .map(([n,p])=>({ name:n, url:p.audio }));
    const INTERVAL = 8000;
    items.forEach((it, idx)=>{
      setTimeout(()=>{
        io.to(room).emit('playOneImitation', it);
        // if last, schedule auto‐start next round after a short delay
        if(idx===items.length-1){
          setTimeout(()=>{
            // advance media index
            R.currentIndex = (R.currentIndex+1)%R.mediaLibrary.length;
            // broadcast new media to all
            io.to(room).emit('newMedia',{
              index: R.currentIndex,
              media: R.mediaLibrary[R.currentIndex]
            });
            // reset for next round
            Object.values(R.players).forEach(p=>{
              p.submitted=false; p.audio=null;
              p.scores={plus2:0,plus1:0,minus1:0};
              p.votedBy=[]; delete p.net;
            });
            io.to(room).emit('roundStarted');
          }, INTERVAL);
        }
      }, idx*INTERVAL);
    });
  });
});
const PORT = process.env.PORT||3000;
server.listen(PORT,()=>console.log(`Listening on ${PORT}`));
