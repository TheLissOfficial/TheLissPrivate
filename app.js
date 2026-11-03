```javascript
"use strict";

// ==================================================
// THELISS PRIVATE — APP.JS
// Compatible with the existing index.html and server.js
// ==================================================

const socket = io(window.TL_SERVER_URL || undefined);

const $ = id => document.getElementById(id);

// --------------------------------------------------
// DOM
// --------------------------------------------------

const landing = $("landing");
const chatView = $("chatView");

const createForm = $("createForm");
const joinForm = $("joinForm");

const createNameInput = $("createName");
const joinNameInput = $("joinName");
const joinKeyInput = $("joinKey");

const messages = $("messages");
const memberList = $("memberList");

const messageForm = $("messageForm");
const messageInput = $("messageInput");

const leaveButton = $("leaveButton");
const closeButton = $("closeButton");

// --------------------------------------------------
// STATE
// --------------------------------------------------

let currentKey = null;
let myName = "";
let myRole = "guest";

let isAdmin = false;
let canCapture = false;

let adminToken = null;
let adminPassword = "";

let currentAuth = false;
let protectionOverlay = null;

let toastTimer = null;
let reconnecting = false;

// --------------------------------------------------
// UTILITIES
// --------------------------------------------------

function showToast(message) {
  const el = $("toast");
  if (!el) return;

  el.textContent = String(message || "");
  el.classList.add("show");

  clearTimeout(toastTimer);

  toastTimer = setTimeout(() => {
    el.classList.remove("show");
  }, 2500);
}

function showError(message = "") {
  const el = $("landingError");
  if (el) el.textContent = message;
}

function clearError() {
  showError("");
}

function clearAdminSession() {
  sessionStorage.removeItem("tl_admin_key");
  sessionStorage.removeItem("tl_admin_token");
  sessionStorage.removeItem("tl_admin_name");
}

function setButtonLoading(button, loading, originalText) {
  if (!button) return;

  button.disabled = loading;

  if (loading) {
    button.dataset.originalText = button.textContent;
    button.textContent = "ATTENDERE...";
  } else {
    button.textContent =
      button.dataset.originalText || originalText || button.textContent;
  }
}

function emitWithTimeout(event, data, callback, timeout = 10000) {
  let completed = false;

  const timer = setTimeout(() => {
    if (completed) return;
    completed = true;

    callback({
      ok: false,
      error: "Il server non ha risposto. Riprova."
    });
  }, timeout);

  socket.emit(event, data, result => {
    if (completed) return;

    completed = true;
    clearTimeout(timer);

    callback(result || {
      ok: false,
      error: "Risposta non valida dal server."
    });
  });
}

// --------------------------------------------------
// PASSWORD FIELDS
// --------------------------------------------------

function makePasswordField(id, placeholder) {
  const input = document.createElement("input");

  input.id = id;
  input.type = "password";
  input.placeholder = placeholder;
  input.maxLength = 128;
  input.required = false;
  input.autocomplete = "off";

  input.style.cssText = `
    margin-top:10px;
    width:100%;
    box-sizing:border-box;
  `;

  return input;
}

const createPassword = makePasswordField(
  "createPassword",
  "Password amministratore TheLiss"
);

const joinPassword = makePasswordField(
  "joinPassword",
  "Password account autorizzato"
);

// Password amministratore.
createNameInput.insertAdjacentElement(
  "afterend",
  createPassword
);

createPassword.autocomplete = "new-password";
createPassword.required = true;

// Accesso ospite oppure account autorizzato.
joinPassword.hidden = true;

const passwordToggle = document.createElement("button");

passwordToggle.type = "button";
passwordToggle.className = "text-button";
passwordToggle.textContent = "SONO UN UTENTE AUTORIZZATO";

passwordToggle.style.marginTop = "10px";

joinNameInput.insertAdjacentElement(
  "afterend",
  passwordToggle
);

passwordToggle.insertAdjacentElement(
  "afterend",
  joinPassword
);

passwordToggle.addEventListener("click", () => {
  joinPassword.hidden = !joinPassword.hidden;

  if (joinPassword.hidden) {
    joinPassword.value = "";
    passwordToggle.textContent =
      "SONO UN UTENTE AUTORIZZATO";
  } else {
    passwordToggle.textContent = "NASCONDI PASSWORD";
    joinPassword.focus();
  }
});

// --------------------------------------------------
// AUTHENTICATION
// --------------------------------------------------

function authenticate(name, password, callback) {
  if (!socket.connected) {
    callback({
      ok: false,
      error: "Server non raggiungibile."
    });
    return;
  }

  emitWithTimeout("auth:login", {
    name: name.trim(),
    password: password || ""
  }, result => {
    if (!result?.ok) {
      callback({
        ok: false,
        error: result?.error || "Autenticazione non riuscita."
      });
      return;
    }

    myName = result.name;
    myRole = result.role;

    isAdmin = result.role === "admin";
    canCapture = result.canCapture === true;

    currentAuth = true;

    if (isAdmin) {
      adminPassword = password;
    } else {
      adminPassword = "";
    }

    callback({
      ok: true,
      ...result
    });
  });
}

// --------------------------------------------------
// ROOM INTERFACE
// --------------------------------------------------

function enterRoom({ key, name, admin, token }) {
  currentKey = key;
  myName = name;

  isAdmin = admin === true;
  canCapture = isAdmin;

  myRole = isAdmin ? "admin" : myRole;
  adminToken = token || null;

  landing.classList.add("hidden");
  chatView.classList.remove("hidden");

  $("roomKeyDisplay").textContent = key;

  $("myRole").textContent = isAdmin
    ? "ADMINISTRATOR"
    : myRole.toUpperCase();

  closeButton.classList.toggle("hidden", !isAdmin);

  messages.replaceChildren();

  const empty = document.createElement("div");
  empty.className = "empty-state";

  const marker = document.createElement("span");
  marker.textContent = "///";

  const description = document.createElement("p");
  description.textContent =
    "Canale stabilito. La conversazione non viene salvata come cronologia.";

  empty.append(marker, description);
  messages.append(empty);

  if (isAdmin && token) {
    sessionStorage.setItem("tl_admin_key", key);
    sessionStorage.setItem("tl_admin_token", token);
    sessionStorage.setItem("tl_admin_name", name);
  }

  updateCaptureProtection();
  renderAdminPanel();

  messageInput.focus();
}

function backToLanding(message = "") {
  currentKey = null;
  isAdmin = false;
  canCapture = false;

  adminToken = null;
  currentAuth = false;

  landing.classList.remove("hidden");
  chatView.classList.add("hidden");

  messages.replaceChildren();
  memberList.replaceChildren();

  $("connectedCount").textContent = "0";
  $("memberCount").textContent = "0";

  removeAdminPanel();
  updateCaptureProtection();

  showError(message);
}

function leaveRoomLocally() {
  if (currentKey) {
    socket.emit("room:leave");
  }

  backToLanding();
}

// --------------------------------------------------
// CHAT MESSAGES
// --------------------------------------------------

function addMessage(data) {
  if (!data || !messages) return;

  const empty = messages.querySelector(".empty-state");
  if (empty) empty.remove();

  const box = document.createElement("article");

  box.className =
    "message" + (data.name === myName ? " mine" : "");

  const meta = document.createElement("div");
  meta.className = "message-meta";

  const who = document.createElement("span");

  who.textContent =
    data.name + (data.isAdmin ? " / ADMIN" : "");

  const when = document.createElement("time");

  const date = new Date(data.time);

  when.textContent = Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit"
      });

  meta.append(who, when);

  const body = document.createElement("div");
  body.className = "message-body";
  body.textContent = data.text || "";

  box.append(meta, body);

  messages.append(box);
  messages.scrollTop = messages.scrollHeight;
}

function addSystem(text) {
  const empty = messages.querySelector(".empty-state");
  if (empty) empty.remove();

  const el = document.createElement("div");

  el.className = "system-message";
  el.textContent = text || "";

  messages.append(el);
  messages.scrollTop = messages.scrollHeight;
}

// --------------------------------------------------
// MEMBERS
// --------------------------------------------------

function updateMembers(state) {
  if (!state || !Array.isArray(state.people)) return;

  $("connectedCount").textContent = state.count;
  $("memberCount").textContent = state.count;

  memberList.replaceChildren();

  state.people.forEach(person => {
    const li = document.createElement("li");

    const label = document.createElement("span");
    label.textContent = person.name;

    li.append(label);

    if (person.isAdmin) {
      const tag = document.createElement("span");

      tag.className = "admin-tag";
      tag.textContent = "ADMIN";

      li.append(tag);
    }

    memberList.append(li);
  });
}

// --------------------------------------------------
// ADMIN PANEL
// --------------------------------------------------

function removeAdminPanel() {
  const panel = $("adminPanel");

  if (panel) panel.remove();
}

function createAdminElement(tag, text, className) {
  const el = document.createElement(tag);

  if (text !== undefined) {
    el.textContent = text;
  }

  if (className) {
    el.className = className;
  }

  return el;
}

function renderAdminPanel() {
  removeAdminPanel();

  if (!isAdmin || !currentKey) return;

  const panel = document.createElement("section");

  panel.id = "adminPanel";

  panel.style.cssText = `
    margin:16px 0;
    padding:18px;
    border:1px solid #b89443;
    border-radius:10px;
    background:#111;
    color:#eee;
  `;

  const title = createAdminElement(
    "h2",
    "THELISS ADMINISTRATION"
  );

  title.style.color = "#d6b45c";

  const subtitle = createAdminElement(
    "p",
    "Gestione account autorizzati"
  );

  const nameInput = document.createElement("input");

  nameInput.id = "adminNewName";
  nameInput.placeholder = "Nickname nuovo account";
  nameInput.maxLength = 24;
  nameInput.autocomplete = "off";

  nameInput.style.cssText = `
    width:100%;
    box-sizing:border-box;
    margin:6px 0;
    padding:10px;
  `;

  const passwordInput = document.createElement("input");

  passwordInput.id = "adminNewPassword";
  passwordInput.type = "password";
  passwordInput.placeholder = "Password (minimo 10 caratteri)";
  passwordInput.maxLength = 128;
  passwordInput.autocomplete = "new-password";

  passwordInput.style.cssText = nameInput.style.cssText;

  const addButton = createAdminElement(
    "button",
    "CREA ACCOUNT"
  );

  addButton.type = "button";

  addButton.addEventListener("click", () => {
    const name = nameInput.value.trim();
    const password = passwordInput.value;

    if (!name || !password) {
      showToast("Inserisci nickname e password.");
      return;
    }

    if (password.length < 10) {
      showToast("La password deve avere almeno 10 caratteri.");
      return;
    }

    setButtonLoading(addButton, true);

    emitWithTimeout("admin:account:create", {
      name,
      password
    }, result => {
      setButtonLoading(addButton, false, "CREA ACCOUNT");

      if (!result?.ok) {
        showToast(result?.error || "Creazione non riuscita.");
        return;
      }

      nameInput.value = "";
      passwordInput.value = "";

      showToast("Account creato.");
      loadAdminAccounts();
    });
  });

  const listTitle = createAdminElement(
    "h3",
    "ACCOUNT REGISTRATI"
  );

  listTitle.style.marginTop = "22px";

  const list = createAdminElement("div");
  list.id = "adminAccounts";

  panel.append(
    title,
    subtitle,
    nameInput,
    passwordInput,
    addButton,
    listTitle,
    list
  );

  chatView.prepend(panel);

  loadAdminAccounts();
}

function loadAdminAccounts() {
  if (!isAdmin || !currentKey) return;

  emitWithTimeout("admin:accounts:list", {}, result => {
    if (!result?.ok) {
      showToast(result?.error || "Errore caricamento account.");
      return;
    }

    const list = $("adminAccounts");
    if (!list) return;

    list.replaceChildren();

    if (!Array.isArray(result.accounts) ||
        result.accounts.length === 0) {
      list.append(
        createAdminElement("p", "Nessun account secondario.")
      );
      return;
    }

    result.accounts.forEach(account => {
      const row = document.createElement("div");

      row.style.cssText = `
        display:flex;
        flex-wrap:wrap;
        align-items:center;
        justify-content:space-between;
        gap:8px;
        padding:10px 0;
        border-bottom:1px solid #333;
      `;

      const label = createAdminElement(
        "span",
        account.nickname
      );

      const actions = document.createElement("div");

      actions.style.cssText = `
        display:flex;
        flex-wrap:wrap;
        gap:6px;
      `;

      // EDIT ACCOUNT

      const editButton = createAdminElement(
        "button",
        "MODIFICA"
      );

      editButton.type = "button";

      editButton.addEventListener("click", () => {
        const newName = prompt(
          "Nuovo nickname:",
          account.nickname
        );

        if (newName === null) return;

        const newPassword = prompt(
          "Nuova password (lascia vuoto per mantenerla):"
        );

        if (newPassword === null) return;

        if (newPassword && newPassword.length < 10) {
          showToast("La password deve avere almeno 10 caratteri.");
          return;
        }

        emitWithTimeout("admin:account:update", {
          oldName: account.nickname,
          newName: newName.trim(),
          password: newPassword
        }, response => {
          if (!response?.ok) {
            showToast(response?.error || "Modifica non riuscita.");
            return;
          }

          showToast("Account aggiornato.");
          loadAdminAccounts();
        });
      });

      // REVOKE ACCOUNT

      const revokeButton = createAdminElement(
        "button",
        "REVOCA"
      );

      revokeButton.type = "button";

      revokeButton.addEventListener("click", () => {
        if (!confirm(
          `Revocare definitivamente l'account ${account.nickname}?`
        )) return;

        emitWithTimeout("admin:account:revoke", {
          name: account.nickname
        }, response => {
          if (!response?.ok) {
            showToast(response?.error || "Revoca non riuscita.");
            return;
          }

          showToast("Account revocato.");
          loadAdminAccounts();
        });
      });

      actions.append(editButton, revokeButton);
      row.append(label, actions);
      list.append(row);
    });
  });
}

// --------------------------------------------------
// PRIVACY OVERLAY
// --------------------------------------------------

function updateCaptureProtection() {
  if (canCapture || !currentKey) {
    if (protectionOverlay) {
      protectionOverlay.remove();
      protectionOverlay = null;
    }

    return;
  }

  if (!protectionOverlay) {
    protectionOverlay = document.createElement("div");

    protectionOverlay.id = "captureProtection";
    protectionOverlay.textContent = "SESSION PROTECTED";

    protectionOverlay.style.cssText = `
      display:none;
      position:fixed;
      inset:0;
      z-index:999999;
      background:#000;
      color:#d6b45c;
      align-items:center;
      justify-content:center;
      font-size:20px;
      letter-spacing:4px;
      font-weight:bold;
    `;

    document.body.append(protectionOverlay);
  }
}

function obscureForNonAdmin() {
  if (!currentKey || canCapture) return;

  if (protectionOverlay) {
    protectionOverlay.style.display = "flex";
  }
}

function revealForNonAdmin() {
  if (!currentKey || canCapture) return;

  if (protectionOverlay) {
    protectionOverlay.style.display = "none";
  }
}

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    obscureForNonAdmin();

    if (currentKey) {
      document.title = "SESSION HIDDEN";
    }
  } else {
    revealForNonAdmin();
    document.title = "THELISS PRIVATE";
  }
});

window.addEventListener("blur", obscureForNonAdmin);
window.addEventListener("focus", revealForNonAdmin);

// --------------------------------------------------
// CREATE ROOM
// --------------------------------------------------

createForm.addEventListener("submit", event => {
  event.preventDefault();
  clearError();

  const name = createNameInput.value.trim();
  const password = createPassword.value;

  if (!name || !password) {
    showError("Inserisci nickname e password amministratore.");
    return;
  }

  const submitButton = createForm.querySelector(
    'button[type="submit"]'
  );

  setButtonLoading(submitButton, true);

  authenticate(name, password, auth => {
    setButtonLoading(submitButton, false);

    if (!auth.ok) {
      showError(auth.error);
      return;
    }

    if (auth.role !== "admin") {
      showError("Solo TheLiss può creare una stanza.");
      return;
    }

    emitWithTimeout("room:create", {}, result => {
      if (!result?.ok) {
        showError(result?.error || "Impossibile creare la stanza.");
        return;
      }

      enterRoom({
        key: result.key,
        name: result.name,
        admin: true,
        token: result.adminToken
      });

      showToast("Stanza creata. Condividi la chiave.");
    });
  });
});

// --------------------------------------------------
// JOIN ROOM
// --------------------------------------------------

joinForm.addEventListener("submit", event => {
  event.preventDefault();
  clearError();

  const key = joinKeyInput.value.trim();
  const name = joinNameInput.value.trim();

  // IMPORTANT:
  // If the password field is hidden, ALWAYS send an empty password.
  // This prevents browser autofill from accidentally blocking guests.

  const password = joinPassword.hidden
    ? ""
    : joinPassword.value;

  if (!key || !name) {
    showError("Inserisci la chiave della stanza e il nickname.");
    return;
  }

  const submitButton = joinForm.querySelector(
    'button[type="submit"]'
  );

  setButtonLoading(submitButton, true);

  authenticate(name, password, auth => {
    if (!auth.ok) {
      setButtonLoading(submitButton, false);
      showError(auth.error);
      return;
    }

    if (auth.role === "admin") {
      setButtonLoading(submitButton, false);

      showError(
        "TheLiss deve utilizzare il modulo di creazione."
      );

      return;
    }

    emitWithTimeout("room:join", {
      key
    }, result => {
      setButtonLoading(submitButton, false);

      if (!result?.ok) {
        showError(result?.error || "Accesso non riuscito.");
        return;
      }

      enterRoom({
        key: result.key,
        name: result.name,
        admin: false
      });

      joinPassword.value = "";
      joinPassword.hidden = true;

      passwordToggle.textContent =
        "SONO UN UTENTE AUTORIZZATO";
    });
  });
});

// --------------------------------------------------
// SEND MESSAGE
// --------------------------------------------------

messageForm.addEventListener("submit", event => {
  event.preventDefault();

  const text = messageInput.value.trim();

  if (!text || !currentKey) return;

  if (text.length > 2000) {
    showToast("Messaggio troppo lungo.");
    return;
  }

  messageInput.value = "";

  emitWithTimeout("chat:message", {
    text
  }, result => {
    if (!result?.ok) {
      showToast(result?.error || "Messaggio non inviato.");
      messageInput.value = text;
    }
  });

  messageInput.focus();
});

// --------------------------------------------------
// COPY ROOM KEY
// --------------------------------------------------

$("copyKey").addEventListener("click", async () => {
  if (!currentKey) return;

  try {
    await navigator.clipboard.writeText(currentKey);
    showToast("Chiave copiata.");
  } catch {
    showToast("Seleziona e copia la chiave manualmente.");
  }
});

// --------------------------------------------------
// LEAVE ROOM
// --------------------------------------------------

leaveButton.addEventListener("click", () => {
  if (!currentKey) return;

  if (isAdmin) {
    if (!confirm(
      "Uscire senza chiudere la stanza? La stanza resterà attiva finché non viene chiusa o non si svuota."
    )) return;

    clearAdminSession();
  }

  socket.emit("room:leave");

  backToLanding();
});

// --------------------------------------------------
// CLOSE ROOM
// --------------------------------------------------

closeButton.addEventListener("click", () => {
  if (!isAdmin || !currentKey) return;

  if (!confirm(
    "TERMINARE LA SESSIONE? Tutti verranno disconnessi e la stanza sarà eliminata."
  )) return;

  emitWithTimeout("room:close", {}, result => {
    if (!result?.ok) {
      showToast(result?.error || "Chiusura non riuscita.");
      return;
    }

    clearAdminSession();

    backToLanding("Sessione terminata.");
  });
});

// --------------------------------------------------
// SOCKET EVENTS
// --------------------------------------------------

socket.on("room:state", updateMembers);

socket.on("chat:message", addMessage);

socket.on("chat:system", data => {
  if (data?.text) {
    addSystem(data.text);
  }
});

socket.on("room:closed", () => {
  clearAdminSession();

  backToLanding(
    "La sessione è stata terminata dall'amministratore."
  );
});

// --------------------------------------------------
// ADMIN RECONNECTION
// --------------------------------------------------

function tryAdminReconnect() {
  if (reconnecting || !socket.connected) return;

  const key = sessionStorage.getItem("tl_admin_key");
  const token = sessionStorage.getItem("tl_admin_token");

  if (!key || !token || !adminPassword) return;

  reconnecting = true;

  emitWithTimeout("auth:login", {
    name: "TheLiss",
    password: adminPassword
  }, auth => {
    if (!auth?.ok) {
      reconnecting = false;
      return;
    }

    isAdmin = auth.role === "admin";
    canCapture = auth.canCapture === true;
    currentAuth = true;

    emitWithTimeout("room:resume", {
      key,
      token
    }, result => {
      reconnecting = false;

      if (result?.ok) {
        enterRoom({
          key,
          name: "TheLiss",
          admin: true,
          token
        });
      } else {
        clearAdminSession();
        showToast("Non è stato possibile riprendere la stanza.");
      }
    });
  });
}

socket.on("connect", () => {
  tryAdminReconnect();
});

socket.on("disconnect", () => {
  if (currentKey) {
    showToast("Connessione interrotta. Tentativo di riconnessione...");
  }
});

socket.on("connect_error", () => {
  showError(
    "Server non raggiungibile. Controlla il server Render."
  );
});

// --------------------------------------------------
// BEST-EFFORT COPY PROTECTION
// --------------------------------------------------

document.addEventListener("contextmenu", event => {
  event.preventDefault();
});

document.addEventListener("copy", event => {
  event.preventDefault();
});

document.addEventListener("cut", event => {
  event.preventDefault();
});

document.addEventListener("paste", event => {
  if (event.target?.id === "joinKey") return;

  event.preventDefault();
});

document.addEventListener("keydown", event => {
  const key = event.key.toLowerCase();

  if (event.ctrlKey || event.metaKey) {
    if (
      key === "v" &&
      event.target?.id === "joinKey"
    ) {
      return;
    }

    if (["c", "x", "v", "s", "p", "u"].includes(key)) {
      event.preventDefault();
    }
  }
});

// --------------------------------------------------
// INITIALIZATION
// --------------------------------------------------

document.title = "THELISS PRIVATE";

showError("");
```
