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

// Serve static assets
app.use(express.static(path.join(__dirname, 'public')));
app.get('/',        (_,res) => res.sendFile(path.join(__dirname,'public/index.html')));
app.get('/room/:r', (_,res) => res.sendFile(path.join(__dirname,'public/index.html')));

const rooms = {};

io.on('connection', socket => {
  socket.on('join', ({room,name}) => {
    socket.join(room);
    socket.data.room=name;
    socket.data.name=name;

    if (!rooms[room]) {
      const mediaDir=path.join(__dirname,'public','media');
      const files   =fs.existsSync(mediaDir)?fs.readdirSync(mediaDir):[];
      const library=files.map(f=>{
        const ext=path.extname(f).toLowerCase();
        return {
          id: nanoid(),
          title:path.basename(f,ext),
          type:ext==='.mp4'?'video':'audio',
          source:`/media/${f}`
        };
      });
      rooms[room]={ host:name, mediaLibrary:library, currentIndex:0, players:{} };
    }
    const R=rooms[room];
    R.players[name]={submitted:false,audio:null,scores:{plus2:0,plus1:0,minus1:0},votedBy:[]};

    socket.emit('mediaLibrary',R.mediaLibrary);
    socket.emit('newMedia',{index:R.currentIndex,media:R.mediaLibrary[R.currentIndex]});
    io.to(room).emit('players',R.players);
    socket.emit('isHost',name===R.host);
  });

  socket.on('submit',({name,url})=>{
    const R=rooms[socket.data.room];
    R.players[name].submitted=true;
    R.players[name].audio=url;
    io.to(socket.data.room).emit('players',R.players);
  });

  socket.on('playPlayback',({url,type})=>{
    io.to(socket.data.room).emit('playPlayback',{url,type});
  });

  socket.on('vote',({name,weight})=>{
    const R=rooms[socket.data.room],p=R.players[name];
    if(p.votedBy.includes(socket.data.name))return;
    if(weight===2)p.scores.plus2++;
    if(weight===1)p.scores.plus1++;
    if(weight===-1)p.scores.minus1++;
    p.votedBy.push(socket.data.name);
    io.to(socket.data.room).emit('players',R.players);
  });

  socket.on('endRound',()=>{
    const R=rooms[socket.data.room];
    let winner=null,max=-Infinity;
    Object.entries(R.players).forEach(([n,p])=>{
      p.net=p.scores.plus2*2+p.scores.plus1-p.scores.minus1;
      if(p.net>max){max=p.net;winner=n;}
    });
    io.to(socket.data.room).emit('roundEnded',{winner,players:R.players});
  });

  socket.on('playAllImitations',()=>{
    const R=rooms[socket.data.room];
    const items=Object.entries(R.players)
      .filter(([,p])=>p.submitted)
      .map(([n,p])=>({name:n,url:p.audio}));
    items.forEach((it,i)=>{
      setTimeout(()=>{
        io.to(socket.data.room).emit('playOneImitation',it);
        if(i===items.length-1){
          setTimeout(()=>{
            R.currentIndex=(R.currentIndex+1)%R.mediaLibrary.length;
            io.to(socket.data.room).emit('newMedia',{
              index:R.currentIndex,
              media:R.mediaLibrary[R.currentIndex]
            });
            Object.values(R.players).forEach(p=>{
              p.submitted=false; p.audio=null;
              p.scores={plus2:0,plus1:0,minus1:0};
              p.votedBy=[];
              delete p.net;
            });
            io.to(socket.data.room).emit('roundStarted');
          },8000);
        }
      },8000*i);
    });
  });

  socket.on('startRound',()=>{
    const R=rooms[socket.data.room];
    Object.values(R.players).forEach(p=>{
      p.submitted=false; p.audio=null;
      p.scores={plus2:0,plus1:0,minus1:0};
      p.votedBy=[];
      delete p.net;
    });
    io.to(socket.data.room).emit('roundStarted');
  });
});

const PORT=process.env.PORT||3000;
server.listen(PORT,()=>console.log(`Listening on ${PORT}`));
