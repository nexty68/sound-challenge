import express from 'express'
import http from 'http'
import { Server } from 'socket.io'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { dirname } from 'path'

// __dirname polyfill pour ES modules
const __filename = fileURLToPath(import.meta.url)
const __dirname  = dirname(__filename)

const app = express()
const srv = http.createServer(app)
const io  = new Server(srv)

// 1) Redirection de la racine vers /new
app.get('/', (req, res) => {
  res.redirect('/new')
})

// 2) Servir les fichiers statiques (public/)
app.use(express.static(path.join(__dirname, 'public')))

// 3) Créer une nouvelle room
app.get('/new', (req, res) => {
  const room = crypto.randomBytes(3).toString('hex')
  res.redirect(`/room/${room}`)
})

// 4) Servir l’interface de jeu pour chaque room
app.get('/room/:id', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'))
})

// Scanner automatiquement public/media au démarrage
const MEDIA_DIR = path.join(__dirname, 'public', 'media')
let mediaLibrary = []
fs.readdirSync(MEDIA_DIR).forEach(file => {
  const ext = path.extname(file).toLowerCase()
  if (['.mp3', '.wav', '.ogg', '.mp4', '.webm'].includes(ext)) {
    mediaLibrary.push({
      id: Date.now() + Math.random(),
      title: path.basename(file, ext),
      type: ['.mp4', '.webm'].includes(ext) ? 'video' : 'audio',
      source: `/media/${file}`
    })
  }
})

// 5) WebSocket
io.on('connection', socket => {
  // Join
  socket.on('join', ({ room, name }) => {
    socket.join(room)
    socket.data = { room, name }

    // Liste des joueurs
    const clients = Array.from(io.sockets.adapter.rooms.get(room) || [])
    const players = clients.map(id => ({
      id,
      name: io.sockets.sockets.get(id).data.name
    }))
    io.to(room).emit('players', players)

    // Envoyer la bibliothèque de médias
    socket.emit('mediaLibrary', mediaLibrary)
  })

  // Démarrer un nouveau round
  socket.on('start', () => {
    io.to(socket.data.room).emit('start')
  })

  // Soumission
  socket.on('submit', data => {
    io.to(socket.data.room).emit('submitted', data)
  })

  // Vote
  socket.on('vote', name => {
    io.to(socket.data.room).emit('voted', name)
  })

  // Playback synchronisé
  socket.on('playPlayback', ({ url, type }) => {
    io.to(socket.data.room).emit('playPlayback', { url, type })
  })

  // Ajout dynamique de média (optionnel)
  socket.on('addMedia', media => {
    mediaLibrary.push(media)
    io.to(socket.data.room).emit('mediaLibrary', mediaLibrary)
  })
})

// Lancer le serveur
srv.listen(3000, () => {
  console.log('Server running on http://localhost:3000')
})
