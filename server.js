const express = require("express");
const http = require("http");
const helmet = require("helmet");
const { Server } = require("socket.io");
const crypto = require("crypto");
const { Pool } = require("pg");
const { promisify } = require("util");

const scrypt = promisify(crypto.scrypt);

const app = express();
const server = http.createServer(app);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL
    ? { rejectUnauthorized: false }
    : undefined
});

const io = new Server(server, {
  maxHttpBufferSize: 8e3,
  cors: { origin: process.env.CLIENT_ORIGIN || true }
});

app.disable("x-powered-by");

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "https://cdn.socket.io"],
      styleSrc: ["'self'"],
      connectSrc: [
        "'self'",
        "ws:",
        "wss:",
        "https://*.onrender.com"
      ],
      imgSrc: ["'self'", "data:"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      frameAncestors: ["'none'"]
    }
  },
  crossOriginEmbedderPolicy: false
}));

app.use(express.static("public", {
  etag: false,
  maxAge: 0
}));

// --------------------------------------------------
// DATABASE
// --------------------------------------------------

async function initializeDatabase() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL non configurato.");
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS authorized_accounts (
      name_key TEXT PRIMARY KEY,
      nickname TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
}

async function hashPassword(password, salt) {
  const result = await scrypt(password, salt, 64);
  return result.toString("hex");
}

function safeEqual(a, b) {
  const first = Buffer.from(String(a || ""));
  const second = Buffer.from(String(b || ""));

  return first.length === second.length &&
    crypto.timingSafeEqual(first, second);
}

// --------------------------------------------------
// HELPERS
// --------------------------------------------------

const rooms = new Map();

const roomName = key => `room:${key}`;

const randomToken = (bytes = 24) =>
  crypto.randomBytes(bytes).toString("base64url");

const cleanName = value =>
  String(value || "")
    .trim()
    .replace(/[<>]/g, "")
    .slice(0, 24);

const normalizeName = value =>
  cleanName(value).toLowerCase();

const validKey = value =>
  /^[A-Za-z0-9_-]{20,40}$/.test(String(value || ""));

function publicState(room) {
  const people = [...room.members.values()].map(member => ({
    name: member.name,
    isAdmin: member.isAdmin
  }));

  return {
    count: people.length,
    people
  };
}

function broadcastState(key, room) {
  io.to(roomName(key)).emit(
    "room:state",
    publicState(room)
  );
}

function leaveCurrentRoom(socket) {
  const key = socket.data.roomKey;
  if (!key) return;

  const room = rooms.get(key);

  socket.leave(roomName(key));
  socket.data.roomKey = null;

  if (!room) return;

  room.members.delete(socket.id);

  if (room.adminSocketId === socket.id) {
    room.adminSocketId = null;
  }

  if (room.members.size === 0 && !room.adminSocketId) {
    rooms.delete(key);
  } else {
    broadcastState(key, room);
  }
}

function isAdmin(socket) {
  return socket.data.authenticated === true &&
    socket.data.role === "admin";
}

function requireAdmin(socket, ack) {
  if (!isAdmin(socket)) {
    ack({
      ok: false,
      error: "Operazione riservata a TheLiss."
    });
    return false;
  }

  return true;
}

// --------------------------------------------------
// SOCKET CONNECTION
// --------------------------------------------------

io.on("connection", socket => {

  socket.data.lastMessages = [];
  socket.data.authenticated = false;
  socket.data.role = null;
  socket.data.nickname = null;
  socket.data.canCapture = false;
  socket.data.loginAttempts = [];

  // ------------------------------------------------
  // AUTHENTICATION
  // ------------------------------------------------

  socket.on("auth:login", async ({
    name,
    password
  } = {}, ack = () => {}) => {

    try {
      const nickname = cleanName(name);
      const nameKey = normalizeName(nickname);
      const pass = String(password || "");

      if (!nickname) {
        return ack({
          ok: false,
          error: "Inserisci un nickname."
        });
      }

      if (nickname.length < 2) {
        return ack({
          ok: false,
          error: "Il nickname deve avere almeno 2 caratteri."
        });
      }

      // Limitazione tentativi di accesso.
      const now = Date.now();

      socket.data.loginAttempts =
        socket.data.loginAttempts.filter(
          time => now - time < 60000
        );

      if (socket.data.loginAttempts.length >= 8) {
        return ack({
          ok: false,
          error: "Troppi tentativi. Attendi un minuto."
        });
      }

      socket.data.loginAttempts.push(now);

      // ACCOUNT PRINCIPALE THELISS
      if (nameKey === "theliss") {
        const adminPassword =
          process.env.THELISS_ADMIN_PASSWORD;

        if (!adminPassword) {
          return ack({
            ok: false,
            error: "Password amministratore non configurata sul server."
          });
        }

        if (!safeEqual(pass, adminPassword)) {
          return ack({
            ok: false,
            error: "Password TheLiss non corretta."
          });
        }

        socket.data.authenticated = true;
        socket.data.role = "admin";
        socket.data.nickname = "TheLiss";
        socket.data.canCapture = true;

        return ack({
          ok: true,
          name: "TheLiss",
          role: "admin",
          canCapture: true
        });
      }

      // ACCOUNT SECONDARIO
      const result = await pool.query(
        `SELECT nickname, password_hash, password_salt
         FROM authorized_accounts
         WHERE name_key = $1`,
        [nameKey]
      );

      if (result.rows.length > 0) {
        const account = result.rows[0];

        if (!pass) {
          return ack({
            ok: false,
            code: "PASSWORD_REQUIRED",
            error: "Questo nickname richiede una password."
          });
        }

        const calculatedHash = await hashPassword(
          pass,
          account.password_salt
        );

        if (!safeEqual(
          calculatedHash,
          account.password_hash
        )) {
          return ack({
            ok: false,
            error: "Password non corretta."
          });
        }

        socket.data.authenticated = true;
        socket.data.role = "authorized";
        socket.data.nickname = account.nickname;
        socket.data.canCapture = false;

        return ack({
          ok: true,
          name: account.nickname,
          role: "authorized",
          canCapture: false
        });
      }

      // NICKNAME RISERVATO
      if (nameKey === "theliss") {
        return ack({
          ok: false,
          error: "Nickname riservato."
        });
      }

      // OSPITE SENZA PASSWORD
      if (pass) {
        return ack({
          ok: false,
          code: "NOT_REGISTERED",
          error: "Nickname non registrato. Accedi senza password."
        });
      }

      socket.data.authenticated = true;
      socket.data.role = "guest";
      socket.data.nickname = nickname;
      socket.data.canCapture = false;

      ack({
        ok: true,
        name: nickname,
        role: "guest",
        canCapture: false
      });

    } catch (error) {
      console.error("Errore autenticazione:", error);

      ack({
        ok: false,
        error: "Errore durante l'accesso."
      });
    }
  });

  // ------------------------------------------------
  // ADMIN: LIST ACCOUNTS
  // ------------------------------------------------

  socket.on("admin:accounts:list", async (
    data,
    ack = () => {}
  ) => {
    if (!requireAdmin(socket, ack)) return;

    try {
      const result = await pool.query(
        `SELECT nickname, created_at
         FROM authorized_accounts
         ORDER BY nickname ASC`
      );

      ack({
        ok: true,
        accounts: result.rows
      });

    } catch (error) {
      console.error(error);
      ack({
        ok: false,
        error: "Impossibile caricare gli account."
      });
    }
  });

  // ------------------------------------------------
  // ADMIN: CREATE ACCOUNT
  // ------------------------------------------------

  socket.on("admin:account:create", async ({
    name,
    password
  } = {}, ack = () => {}) => {

    if (!requireAdmin(socket, ack)) return;

    try {
      const nickname = cleanName(name);
      const nameKey = normalizeName(nickname);
      const pass = String(password || "");

      if (
        nickname.length < 2 ||
        !pass ||
        pass.length < 10 ||
        pass.length > 128
      ) {
        return ack({
          ok: false,
          error: "Nickname non valido o password inferiore a 10 caratteri."
        });
      }

      if (nameKey === "theliss") {
        return ack({
          ok: false,
          error: "Nickname riservato."
        });
      }

      const salt = randomToken(16);
      const passwordHash = await hashPassword(pass, salt);

      await pool.query(
        `INSERT INTO authorized_accounts
         (name_key, nickname, password_hash, password_salt)
         VALUES ($1, $2, $3, $4)`,
        [nameKey, nickname, passwordHash, salt]
      );

      ack({
        ok: true,
        message: "Account creato."
      });

    } catch (error) {
      if (error.code === "23505") {
        return ack({
          ok: false,
          error: "Questo nickname è già registrato."
        });
      }

      console.error(error);

      ack({
        ok: false,
        error: "Impossibile creare l'account."
      });
    }
  });

  // ------------------------------------------------
  // ADMIN: UPDATE ACCOUNT
  // ------------------------------------------------

  socket.on("admin:account:update", async ({
    oldName,
    newName,
    password
  } = {}, ack = () => {}) => {

    if (!requireAdmin(socket, ack)) return;

    try {
      const oldKey = normalizeName(oldName);
      const nickname = cleanName(newName);
      const newKey = normalizeName(nickname);
      const pass = String(password || "");

      if (
        !oldKey ||
        nickname.length < 2 ||
        newKey === "theliss"
      ) {
        return ack({
          ok: false,
          error: "Dati dell'account non validi."
        });
      }

      if (pass && (pass.length < 10 || pass.length > 128)) {
        return ack({
          ok: false,
          error: "La nuova password deve avere almeno 10 caratteri."
        });
      }

      if (pass) {
        const salt = randomToken(16);
        const passwordHash = await hashPassword(pass, salt);

        const result = await pool.query(
          `UPDATE authorized_accounts
           SET name_key = $1,
               nickname = $2,
               password_hash = $3,
               password_salt = $4
           WHERE name_key = $5`,
          [newKey, nickname, passwordHash, salt, oldKey]
        );

        if (!result.rowCount) {
          return ack({
            ok: false,
            error: "Account non trovato."
          });
        }
      } else {
        const result = await pool.query(
          `UPDATE authorized_accounts
           SET name_key = $1, nickname = $2
           WHERE name_key = $3`,
          [newKey, nickname, oldKey]
        );

        if (!result.rowCount) {
          return ack({
            ok: false,
            error: "Account non trovato."
          });
        }
      }

      ack({
        ok: true,
        message: "Account aggiornato."
      });

    } catch (error) {
      if (error.code === "23505") {
        return ack({
          ok: false,
          error: "Il nuovo nickname è già utilizzato."
        });
      }

      console.error(error);

      ack({
        ok: false,
        error: "Impossibile modificare l'account."
      });
    }
  });

  // ------------------------------------------------
  // ADMIN: REVOKE ACCOUNT
  // ------------------------------------------------

  socket.on("admin:account:revoke", async ({
    name
  } = {}, ack = () => {}) => {

    if (!requireAdmin(socket, ack)) return;

    try {
      const nameKey = normalizeName(name);

      const result = await pool.query(
        `DELETE FROM authorized_accounts
         WHERE name_key = $1`,
        [nameKey]
      );

      if (!result.rowCount) {
        return ack({
          ok: false,
          error: "Account non trovato."
        });
      }

      ack({
        ok: true,
        message: "Account revocato."
      });

    } catch (error) {
      console.error(error);

      ack({
        ok: false,
        error: "Impossibile revocare l'account."
      });
    }
  });

  // ------------------------------------------------
  // CREATE ROOM: ONLY THELISS
  // ------------------------------------------------

  socket.on("room:create", (data, ack = () => {}) => {

    if (!isAdmin(socket)) {
      return ack({
        ok: false,
        error: "Solo TheLiss può creare una stanza."
      });
    }

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

    room.members.set(socket.id, {
      name: "TheLiss",
      isAdmin: true
    });

    ack({
      ok: true,
      key,
      adminToken,
      name: "TheLiss",
      isAdmin: true,
      canCapture: true
    });

    broadcastState(key, room);
  });

  // ------------------------------------------------
  // JOIN ROOM
  // ------------------------------------------------

  socket.on("room:join", ({
    key
  } = {}, ack = () => {}) => {

    if (!socket.data.authenticated) {
      return ack({
        ok: false,
        error: "Devi prima effettuare l'accesso."
      });
    }

    const roomKey = String(key || "").trim();
    const nickname = socket.data.nickname;

    if (!validKey(roomKey)) {
      return ack({
        ok: false,
        error: "Chiave non valida."
      });
    }

    const room = rooms.get(roomKey);

    if (!room) {
      return ack({
        ok: false,
        error: "Stanza inesistente o già chiusa."
      });
    }

    if (room.members.size >= 30) {
      return ack({
        ok: false,
        error: "La stanza ha raggiunto il limite di 30 partecipanti."
      });
    }

    leaveCurrentRoom(socket);

    socket.data.roomKey = roomKey;
    socket.data.isAdmin = false;

    socket.join(roomName(roomKey));

    room.members.set(socket.id, {
      name: nickname,
      isAdmin: false
    });

    ack({
      ok: true,
      key: roomKey,
      name: nickname,
      isAdmin: false,
      canCapture: false
    });

    broadcastState(roomKey, room);

    io.to(roomName(roomKey)).emit(
      "chat:system",
      { text: `${nickname} è entrato nella stanza.` }
    );
  });

  // ------------------------------------------------
  // RESUME ADMIN ROOM
  // ------------------------------------------------

  socket.on("room:resume", ({
    key,
    token
  } = {}, ack = () => {}) => {

    if (!isAdmin(socket)) {
      return ack({
        ok: false,
        error: "Accesso amministratore richiesto."
      });
    }

    const roomKey = String(key || "").trim();
    const room = rooms.get(roomKey);

    if (
      !room ||
      !token ||
      !safeEqual(token, room.adminToken)
    ) {
      return ack({
        ok: false,
        error: "Sessione amministratore non più valida."
      });
    }

    leaveCurrentRoom(socket);

    room.adminSocketId = socket.id;

    socket.data.roomKey = roomKey;
    socket.data.isAdmin = true;

    socket.join(roomName(roomKey));

    room.members.set(socket.id, {
      name: "TheLiss",
      isAdmin: true
    });

    ack({
      ok: true,
      key: roomKey,
      name: "TheLiss",
      isAdmin: true,
      canCapture: true
    });

    broadcastState(roomKey, room);
  });

  // ------------------------------------------------
  // CHAT MESSAGE
  // ------------------------------------------------

  socket.on("chat:message", ({
    text
  } = {}, ack = () => {}) => {

    const key = socket.data.roomKey;
    const room = rooms.get(key);

    if (!room || !room.members.has(socket.id)) {
      return ack({ ok: false });
    }

    const message = String(text || "").trim();

    if (!message || message.length > 2000) {
      return ack({
        ok: false,
        error: "Messaggio vuoto o troppo lungo."
      });
    }

    const now = Date.now();

    socket.data.lastMessages =
      socket.data.lastMessages.filter(
        time => now - time < 4000
      );

    if (socket.data.lastMessages.length >= 8) {
      return ack({
        ok: false,
        error: "Attendi qualche secondo."
      });
    }

    socket.data.lastMessages.push(now);

    const member = room.members.get(socket.id);

    io.to(roomName(key)).emit("chat:message", {
      name: member.name,
      isAdmin: member.isAdmin,
      text: message,
      time: new Date().toISOString()
    });

    ack({ ok: true });
  });

  // ------------------------------------------------
  // CLOSE ROOM: ONLY THELISS
  // ------------------------------------------------

  socket.on("room:close", (arg1, arg2) => {

    // Accetta sia room:close(ack) sia room:close(data, ack)
    const ack =
      typeof arg1 === "function" ? arg1 :
      typeof arg2 === "function" ? arg2 :
      () => {};

    const key = socket.data.roomKey;
    const room = rooms.get(key);

    if (
      !isAdmin(socket) ||
      !room ||
      room.adminSocketId !== socket.id
    ) {
      return ack({
        ok: false,
        error: "Solo TheLiss può chiudere la stanza."
      });
    }

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

  // ------------------------------------------------
  // LEAVE / DISCONNECT
  // ------------------------------------------------

  socket.on("room:leave", () => {
    leaveCurrentRoom(socket);
  });

  socket.on("disconnect", () => {
    leaveCurrentRoom(socket);
  });
});

// --------------------------------------------------
// START SERVER
// --------------------------------------------------

const PORT = process.env.PORT || 3000;

initializeDatabase()
  .then(() => {
    server.listen(PORT, () => {
      console.log(
        `THELISS PRIVATE running on port ${PORT}`
      );
    });
  })
  .catch(error => {
    console.error(
      "Avvio non riuscito:",
      error.message
    );
    process.exit(1);
  });
