const express = require("express");
const http = require("http");
const helmet = require("helmet");
const { Server } = require("socket.io");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  maxHttpBufferSize: 8e3,
  cors: { origin: false }
});

app.disable("x-powered-by");
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "https://cdn.socket.io"],
      styleSrc: ["'self'"],
      connectSrc: ["'self'", "ws:", "wss:"],
      imgSrc: ["'self'", "data:"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      frameAncestors: ["'none'"]
    }
  },
  crossOriginEmbedderPolicy: false
}));
app.use(express.static("public", { etag: false, maxAge: 0 }));

// Rooms and messages exist only in process memory. No database or message history.
const rooms = new Map();
const roomName = (key) => `room:${key}`;
const randomToken = (bytes = 24) => crypto.randomBytes(bytes).toString("base64url");
const cleanName = (value) => String(value || "").trim().replace(/[<>]/g, "").slice(0, 24);
const validKey = (value) => /^[A-Za-z0-9_-]{20,40}$/.test(String(value || ""));

function publicState(room) {
  const people = [...room.members.values()].map(m => ({
    name: m.name,
    isAdmin: m.isAdmin
  }));
  return { count: people.length, people };
}
function broadcastState(key, room) {
  io.to(roomName(key)).emit("room:state", publicState(room));
}
function leaveCurrentRoom(socket) {
  const key = socket.data.roomKey;
  if (!key) return;
  const room = rooms.get(key);
  socket.leave(roomName(key));
  socket.data.roomKey = null;
  if (!room) return;
  room.members.delete(socket.id);
  if (room.members.size === 0 && !room.adminSocketId) {
    rooms.delete(key);
  } else {
    broadcastState(key, room);
  }
}

io.on("connection", (socket) => {
  socket.data.lastMessages = [];

  socket.on("room:create", ({ name } = {}, ack = () => {}) => {
    const nickname = cleanName(name);
    if (!nickname) return ack({ ok: false, error: "Inserisci un nickname." });
    const key = randomToken(18);
    const adminToken = randomToken(32);
    const room = {
      adminToken,
      adminSocketId: socket.id,
      members: new Map(),
      createdAt: Date.now()
    };
    rooms.set(key, room);
    socket.data.roomKey = key;
    socket.data.isAdmin = true;
    socket.join(roomName(key));
    room.members.set(socket.id, { name: nickname, isAdmin: true });
    ack({ ok: true, key, adminToken, name: nickname });
    broadcastState(key, room);
  });

  socket.on("room:join", ({ key, name } = {}, ack = () => {}) => {
    const roomKey = String(key || "").trim();
    const nickname = cleanName(name);
    if (!validKey(roomKey)) return ack({ ok: false, error: "Chiave non valida." });
    if (!nickname) return ack({ ok: false, error: "Inserisci un nickname." });
    const room = rooms.get(roomKey);
    if (!room) return ack({ ok: false, error: "Stanza inesistente o già chiusa." });
    if (room.members.size >= 30) return ack({ ok: false, error: "La stanza ha raggiunto il limite di 30 partecipanti." });

    leaveCurrentRoom(socket);
    socket.data.roomKey = roomKey;
    socket.data.isAdmin = false;
    socket.join(roomName(roomKey));
    room.members.set(socket.id, { name: nickname, isAdmin: false });
    ack({ ok: true, key: roomKey, name: nickname, isAdmin: false });
    broadcastState(roomKey, room);
    io.to(roomName(roomKey)).emit("chat:system", { text: `${nickname} è entrato nella stanza.` });
  });

  socket.on("room:resume", ({ key, token } = {}, ack = () => {}) => {
    const roomKey = String(key || "").trim();
    const room = rooms.get(roomKey);
    if (!room || !token || !crypto.timingSafeEqual(
      Buffer.from(String(token)), Buffer.from(room.adminToken)
    )) return ack({ ok: false, error: "Sessione amministratore non più valida." });

    leaveCurrentRoom(socket);
    room.adminSocketId = socket.id;
    socket.data.roomKey = roomKey;
    socket.data.isAdmin = true;
    socket.join(roomName(roomKey));
    const old = room.members.get(socket.id);
    room.members.set(socket.id, { name: old?.name || "ADMIN", isAdmin: true });
    ack({ ok: true, key: roomKey, name: old?.name || "ADMIN", isAdmin: true });
    broadcastState(roomKey, room);
  });

  socket.on("chat:message", ({ text } = {}, ack = () => {}) => {
    const key = socket.data.roomKey;
    const room = rooms.get(key);
    if (!room || !room.members.has(socket.id)) return ack?.({ ok: false });
    const message = String(text || "").trim();
    if (!message || message.length > 2000) return ack?.({ ok: false, error: "Messaggio vuoto o troppo lungo." });

    const now = Date.now();
    socket.data.lastMessages = socket.data.lastMessages.filter(t => now - t < 4000);
    if (socket.data.lastMessages.length >= 8) return ack?.({ ok: false, error: "Attendi qualche secondo." });
    socket.data.lastMessages.push(now);

    const member = room.members.get(socket.id);
    io.to(roomName(key)).emit("chat:message", {
      name: member.name,
      isAdmin: member.isAdmin,
      text: message,
      time: new Date().toISOString()
    });
    ack?.({ ok: true });
  });

  socket.on("room:close", (ack = () => {}) => {
    const key = socket.data.roomKey;
    const room = rooms.get(key);
    if (!room || room.adminSocketId !== socket.id || !socket.data.isAdmin) {
      return ack({ ok: false, error: "Solo il creatore può chiudere la stanza." });
    }
    // Remove the room before notifying clients; no message history is retained.
    rooms.delete(key);
    io.to(roomName(key)).emit("room:closed");
    for (const id of room.members.keys()) {
      const peer = io.sockets.sockets.get(id);
      if (peer) {
        peer.data.roomKey = null;
        peer.disconnect(true);
      }
    }
    ack({ ok: true });
  });

  socket.on("room:leave", () => leaveCurrentRoom(socket));

  socket.on("disconnect", () => {
    const key = socket.data.roomKey;
    if (!key) return;
    const room = rooms.get(key);
    if (!room) return;
    room.members.delete(socket.id);
    if (room.adminSocketId === socket.id) room.adminSocketId = null;
    if (room.members.size === 0 && !room.adminSocketId) rooms.delete(key);
    else broadcastState(key, room);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`THELISS PRIVATE running on port ${PORT}`));