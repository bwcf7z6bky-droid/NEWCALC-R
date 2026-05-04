// server.js
const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const { Game } = require('./game');

const app = express();
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const rooms = new Map();
const socketToRoom = new Map();

function broadcast(roomId) {
  const game = rooms.get(roomId);
  if (!game) return;
  for (const p of game.players) {
    if (p.connected) io.to(p.id).emit('state', game.snapshotFor(p.id));
  }
}

io.on('connection', (socket) => {
  socket.on('joinRoom', ({ roomId, name }) => {
    if (!roomId || !name) return socket.emit('joinError', 'Room and name required');
    roomId = String(roomId).trim().toUpperCase().slice(0, 8);
    name = String(name).trim().slice(0, 20);
    if (!roomId || !name) return socket.emit('joinError', 'Invalid');
    if (!rooms.has(roomId)) rooms.set(roomId, new Game(roomId));
    const game = rooms.get(roomId);
    const r = game.addPlayer(socket.id, name);
    if (r.error) return socket.emit('joinError', r.error);
    socket.join(roomId);
    socketToRoom.set(socket.id, roomId);
    socket.emit('joined', { roomId, seat: r.player.seat });
    broadcast(roomId);
    console.log(`[${roomId}] ${name} joined seat ${r.player.seat + 1}`);
  });

  socket.on('startGame', () => {
    const roomId = socketToRoom.get(socket.id);
    const game = rooms.get(roomId);
    if (!game) return;
    const me = game.players.find(p => p.id === socket.id);
    if (!me || me.seat !== 0) return socket.emit('moveError', 'Only host can start');
    const r = game.start();
    if (r.error) return socket.emit('moveError', r.error);
    broadcast(roomId);
    console.log(`[${roomId}] started`);
  });

  socket.on('move', (move) => {
    const roomId = socketToRoom.get(socket.id);
    const game = rooms.get(roomId);
    if (!game) return;
    const r = game.applyMove(socket.id, move);
    if (r.error) return socket.emit('moveError', r.error);
    broadcast(roomId);
  });

  socket.on('chat', (text) => {
    const roomId = socketToRoom.get(socket.id);
    const game = rooms.get(roomId);
    if (!game) return;
    const p = game.players.find(x => x.id === socket.id);
    if (!p) return;
    text = String(text || '').slice(0, 200);
    if (!text) return;
    game.log_("chat", `💬 ${p.name}: ${text}`);
    broadcast(roomId);
  });

  socket.on('disconnect', () => {
    const roomId = socketToRoom.get(socket.id);
    const game = rooms.get(roomId);
    if (!game) return;
    game.removePlayer(socket.id);
    if (!game.started && game.players.length === 0) {
      rooms.delete(roomId);
    } else {
      broadcast(roomId);
    }
    socketToRoom.delete(socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Listening on ${PORT}`));
