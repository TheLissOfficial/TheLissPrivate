"use strict";

// ==================================================
// THELISS PRIVATE - APP.JS (versione corretta)
// Compatibile con index.html e server.js esistenti
// ==================================================

if (typeof io !== "function") {
  document.body.textContent =
    "Errore: socket.io non caricato. Includi lo script di socket.io in index.html PRIMA di app.js.";
  throw new Error("socket.io non caricato");
}

const socket = io(window.TL_SERVER_URL || undefined);

const $ = id => document.getElementById(id);

// Aggancia un evento solo se l'elemento esiste
function on(el, eventName, handler) {
  if (el) el.addEventListener(eventName, handler);
}

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

// Diagnostica: segnala in console gli ID mancanti in index.html
Object.entries({
  landing, chatView, createForm, joinForm, createName: createNameInput,
  joinName: joinNameInput, joinKey: joinKeyInput, messages, memberList,
  messageForm, messageInput, leaveButton, closeButton
}).forEach(([name, el]) => {
  if (!el) console.error("[TheLiss] Elemento mancante in index.html: #" + name);
});

// --------------------------------------------------
// STATE
// --------------------------------------------------

let currentKey = null;
let myName = "";
let myRole = "guest";

let isAdmin = false;
let canCapture = false;

// Credenziali tenute SOLO in memoria per la riconnessione automatica
let session = null; // { key, name, password, admin, token }

let protectionOverlay = null;
let toastTimer = null;
let resuming = false;

// --------------------------------------------------
// UTILITIES
// --------------------------------------------------

function showToast(message) {
  const el = $("toast");
  if (!el) return;

  el.textContent = String(message || "");
  el.classList.add("show");

  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2500);
}

function showError(message = "") {
  const el = $("landingError");
  if (el) el.textContent = message;
}

function clearError() {
  showError("");
}

function clearAdminSession() {
  try {
    sessionStorage.removeItem("tl_admin_key");
    sessionStorage.removeItem("tl_admin_token");
    sessionStorage.removeItem("tl_admin_name");
  } catch {
    /* sessionStorage non disponibile */
  }
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

    callback({ ok: false, error: "Il server non ha risposto. Riprova." });
  }, timeout);

  const onAck = result => {
    if (completed) return;

    completed = true;
    clearTimeout(timer);

    callback(result || { ok: false, error: "Risposta non valida dal server." });
  };

  // data === undefined: si invia solo la callback (es. room:close)
  if (data === undefined) {
    socket.emit(event, onAck);
  } else {
    socket.emit(event, data, onAck);
  }
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

  input.style.marginTop = "10px";
  input.style.width = "100%";
  input.style.boxSizing = "border-box";

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

// Password amministratore: compare SOLO se il nickname è "TheLiss"
createPassword.autocomplete = "new-password";
createNameInput?.insertAdjacentElement("afterend", createPassword);

function syncCreatePassword() {
  const show = isAdminName(createNameInput?.value);

  createPassword.hidden = !show;
  createPassword.required = show;

  if (!show) createPassword.value = "";
}

on(createNameInput, "input", syncCreatePassword);
syncCreatePassword();

// Accesso ospite oppure account autorizzato
joinPassword.hidden = true;

const passwordToggle = document.createElement("button");

passwordToggle.type = "button";
passwordToggle.className = "text-button";
passwordToggle.textContent = "SONO UN UTENTE AUTORIZZATO";
passwordToggle.style.marginTop = "10px";

joinNameInput?.insertAdjacentElement("afterend", passwordToggle);
passwordToggle.insertAdjacentElement("afterend", joinPassword);

passwordToggle.addEventListener("click", () => {
  joinPassword.hidden = !joinPassword.hidden;

  if (joinPassword.hidden) {
    joinPassword.value = "";
    passwordToggle.textContent = "SONO UN UTENTE AUTORIZZATO";
  } else {
    passwordToggle.textContent = "NASCONDI PASSWORD";
    joinPassword.focus();
  }
});

// --------------------------------------------------
// AUTHENTICATION
// --------------------------------------------------

function isAdminName(name) {
  return String(name || "").trim().toLowerCase() === "theliss";
}

// Il nickname è un account registrato e richiede la password
function isPasswordRequired(result) {
  return result?.code === "PASSWORD_REQUIRED" ||
    /richiede una password/i.test(result?.error || "");
}

// Il nickname NON è registrato: la password non serve
function isNotRegistered(result) {
  return result?.code === "NOT_REGISTERED" ||
    /non registrato/i.test(result?.error || "");
}

function authenticate(name, password, callback) {
  if (!socket.connected) {
    callback({ ok: false, error: "Server non raggiungibile." });
    return;
  }

  emitWithTimeout("auth:login", {
    name: name.trim(),
    password: password || ""
  }, result => {
    if (!result?.ok) {
      callback({
        ok: false,
        code: result?.code,
        error: result?.error || "Autenticazione non riuscita."
      });
      return;
    }

    myName = result.name;
    myRole = result.role;

    isAdmin = result.role === "admin";
    canCapture = result.canCapture === true;

    callback({ ...result, ok: true });
  });
}

// --------------------------------------------------
// ROOM INTERFACE
// --------------------------------------------------

function enterRoom({ key, name, admin, token, preserve = false }) {
  currentKey = key;
  myName = name;

  isAdmin = admin === true;
  canCapture = isAdmin;

  myRole = isAdmin ? "admin" : myRole;

  landing?.classList.add("hidden");
  chatView?.classList.remove("hidden");

  const keyDisplay = $("roomKeyDisplay");
  if (keyDisplay) keyDisplay.textContent = key;

  const roleDisplay = $("myRole");
  if (roleDisplay) {
    roleDisplay.textContent = isAdmin ? "ADMINISTRATOR" : myRole.toUpperCase();
  }

  closeButton?.classList.toggle("hidden", !isAdmin);

  // Dopo una riconnessione si mantiene la conversazione già a schermo
  if (!preserve) {
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
  }

  if (isAdmin && token) {
    try {
      sessionStorage.setItem("tl_admin_key", key);
      sessionStorage.setItem("tl_admin_token", token);
      sessionStorage.setItem("tl_admin_name", name);
    } catch {
      /* sessionStorage non disponibile */
    }
  }

  updateCaptureProtection();
  renderAdminPanel();

  messageInput?.focus();
}

function backToLanding(message = "") {
  currentKey = null;
  session = null;
  isAdmin = false;
  canCapture = false;
  myRole = "guest";

  landing?.classList.remove("hidden");
  chatView?.classList.add("hidden");

  messages?.replaceChildren();
  memberList?.replaceChildren();

  const connected = $("connectedCount");
  const members = $("memberCount");
  if (connected) connected.textContent = "0";
  if (members) members.textContent = "0";

  removeAdminPanel();
  updateCaptureProtection();

  document.title = "THELISS PRIVATE";

  showError(message);
}

// --------------------------------------------------
// CHAT MESSAGES
// --------------------------------------------------

function addMessage(data) {
  if (!data || !messages) return;

  const empty = messages.querySelector(".empty-state");
  if (empty) empty.remove();

  const box = document.createElement("article");
  box.className = "message" + (data.name === myName ? " mine" : "");

  const meta = document.createElement("div");
  meta.className = "message-meta";

  const who = document.createElement("span");
  who.textContent = data.name + (data.isAdmin ? " / ADMIN" : "");

  const when = document.createElement("time");
  const date = new Date(data.time);

  when.textContent = Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  meta.append(who, when);

  const body = document.createElement("div");
  body.className = "message-body";
  body.textContent = data.text || "";

  box.append(meta, body);

  messages.append(box);
  messages.scrollTop = messages.scrollHeight;
}

function addSystem(text) {
  if (!messages) return;

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

  const connected = $("connectedCount");
  const members = $("memberCount");
  if (connected) connected.textContent = state.count;
  if (members) members.textContent = state.count;

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

  if (text !== undefined) el.textContent = text;
  if (className) el.className = className;

  return el;
}

function renderAdminPanel() {
  removeAdminPanel();

  if (!isAdmin || !currentKey || !chatView) return;

  const panel = document.createElement("section");
  panel.id = "adminPanel";

  panel.style.cssText =
    "margin:16px 0;padding:18px;border:1px solid #b89443;" +
    "border-radius:10px;background:#111;color:#eee;";

  const title = createAdminElement("h2", "THELISS ADMINISTRATION");
  title.style.color = "#d6b45c";

  const subtitle = createAdminElement("p", "Gestione account autorizzati");

  const inputStyle =
    "width:100%;box-sizing:border-box;margin:6px 0;padding:10px;";

  const nameInput = document.createElement("input");
  nameInput.id = "adminNewName";
  nameInput.placeholder = "Nickname nuovo account";
  nameInput.maxLength = 24;
  nameInput.autocomplete = "off";
  nameInput.style.cssText = inputStyle;

  const passwordInput = document.createElement("input");
  passwordInput.id = "adminNewPassword";
  passwordInput.type = "password";
  passwordInput.placeholder = "Password (minimo 10 caratteri)";
  passwordInput.maxLength = 128;
  passwordInput.autocomplete = "new-password";
  passwordInput.style.cssText = inputStyle;

  const addButton = createAdminElement("button", "CREA ACCOUNT");
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

    emitWithTimeout("admin:account:create", { name, password }, result => {
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

  const listTitle = createAdminElement("h3", "ACCOUNT REGISTRATI");
  listTitle.style.marginTop = "22px";

  const list = createAdminElement("div");
  list.id = "adminAccounts";

  panel.append(
    title, subtitle, nameInput, passwordInput, addButton, listTitle, list
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

    if (!Array.isArray(result.accounts) || result.accounts.length === 0) {
      list.append(createAdminElement("p", "Nessun account secondario."));
      return;
    }

    result.accounts.forEach(account => {
      const row = document.createElement("div");

      row.style.cssText =
        "display:flex;flex-wrap:wrap;align-items:center;" +
        "justify-content:space-between;gap:8px;padding:10px 0;" +
        "border-bottom:1px solid #333;";

      const label = createAdminElement("span", account.nickname);

      const actions = document.createElement("div");
      actions.style.cssText = "display:flex;flex-wrap:wrap;gap:6px;";

      // MODIFICA ACCOUNT
      const editButton = createAdminElement("button", "MODIFICA");
      editButton.type = "button";

      editButton.addEventListener("click", () => {
        const newName = prompt("Nuovo nickname:", account.nickname);
        if (newName === null) return;

        if (!newName.trim()) {
          showToast("Il nickname non può essere vuoto.");
          return;
        }

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

      // REVOCA ACCOUNT
      const revokeButton = createAdminElement("button", "REVOCA");
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
// PRIVACY OVERLAY (best effort, solo lato client)
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

    protectionOverlay.style.cssText =
      "display:none;position:fixed;inset:0;z-index:999999;" +
      "background:#000;color:#d6b45c;align-items:center;" +
      "justify-content:center;font-size:20px;letter-spacing:4px;" +
      "font-weight:bold;";

    document.body.append(protectionOverlay);
  }
}

function obscureForNonAdmin() {
  if (!currentKey || canCapture) return;
  if (protectionOverlay) protectionOverlay.style.display = "flex";
}

function revealForNonAdmin() {
  if (!currentKey || canCapture) return;
  if (protectionOverlay) protectionOverlay.style.display = "none";
}

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    obscureForNonAdmin();
    if (currentKey) document.title = "SESSION HIDDEN";
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

on(createForm, "submit", event => {
  event.preventDefault();
  clearError();

  const name = createNameInput.value.trim();
  const password = createPassword.value;

  if (!name) {
    showError("Inserisci il nickname.");
    return;
  }

  // Nickname diverso da TheLiss: nessuna richiesta di password admin
  if (!isAdminName(name)) {
    showError("Solo TheLiss può creare una stanza. Per entrare in una stanza usa il modulo a destra.");
    return;
  }

  if (!password) {
    showError("Inserisci la password amministratore.");
    return;
  }

  const submitButton = createForm.querySelector('button[type="submit"]');
  setButtonLoading(submitButton, true);

  authenticate(name, password, auth => {
    if (!auth.ok) {
      setButtonLoading(submitButton, false);
      showError(auth.error);
      return;
    }

    if (auth.role !== "admin") {
      setButtonLoading(submitButton, false);
      showError("Solo TheLiss può creare una stanza.");
      return;
    }

    emitWithTimeout("room:create", {}, result => {
      setButtonLoading(submitButton, false);

      if (!result?.ok) {
        showError(result?.error || "Impossibile creare la stanza.");
        return;
      }

      session = {
        key: result.key,
        name: result.name,
        password,
        admin: true,
        token: result.adminToken
      };

      createPassword.value = "";

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

on(joinForm, "submit", event => {
  event.preventDefault();
  clearError();

  const key = joinKeyInput.value.trim();
  const name = joinNameInput.value.trim();

  // Campo nascosto = password SEMPRE vuota (evita l'autofill del browser)
  const typedPassword = joinPassword.hidden ? "" : joinPassword.value;

  if (!key || !name) {
    showError("Inserisci la chiave della stanza e il nickname.");
    return;
  }

  // TheLiss usa il modulo di creazione: da qui non si chiede la password admin
  if (isAdminName(name)) {
    showError("TheLiss deve utilizzare il modulo di creazione.");
    return;
  }

  const submitButton = joinForm.querySelector('button[type="submit"]');
  setButtonLoading(submitButton, true);

  const finish = (auth, passwordUsed) => {
    if (!auth.ok) {
      setButtonLoading(submitButton, false);
      showError(auth.error);
      return;
    }

    if (auth.role === "admin") {
      setButtonLoading(submitButton, false);
      showError("TheLiss deve utilizzare il modulo di creazione.");
      return;
    }

    emitWithTimeout("room:join", { key }, result => {
      setButtonLoading(submitButton, false);

      if (!result?.ok) {
        showError(result?.error || "Accesso non riuscito.");
        return;
      }

      session = {
        key: result.key,
        name: result.name,
        password: passwordUsed,
        admin: false,
        token: null
      };

      enterRoom({
        key: result.key,
        name: result.name,
        admin: false
      });

      joinPassword.value = "";
      joinPassword.hidden = true;
      passwordToggle.textContent = "SONO UN UTENTE AUTORIZZATO";
    });
  };

  authenticate(name, typedPassword, auth => {
    // Nickname non registrato ma password presente: entra come ospite
    if (!auth.ok && typedPassword && isNotRegistered(auth)) {
      authenticate(name, "", guestAuth => finish(guestAuth, ""));
      return;
    }

    // Nickname registrato: solo ora compare il campo password
    if (!auth.ok && !typedPassword && isPasswordRequired(auth)) {
      setButtonLoading(submitButton, false);

      joinPassword.hidden = false;
      passwordToggle.textContent = "NASCONDI PASSWORD";
      joinPassword.focus();

      showError("Questo nickname è un account registrato: inserisci la password.");
      return;
    }

    finish(auth, typedPassword);
  });
});

// --------------------------------------------------
// SEND MESSAGE
// --------------------------------------------------

on(messageForm, "submit", event => {
  event.preventDefault();

  const text = messageInput.value.trim();

  if (!text || !currentKey) return;

  if (text.length > 2000) {
    showToast("Messaggio troppo lungo.");
    return;
  }

  messageInput.value = "";

  emitWithTimeout("chat:message", { text }, result => {
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

on($("copyKey"), "click", async () => {
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

on(leaveButton, "click", () => {
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

on(closeButton, "click", () => {
  if (!isAdmin || !currentKey) return;

  if (!confirm(
    "TERMINARE LA SESSIONE? Tutti verranno disconnessi e la stanza sarà eliminata."
  )) return;

  emitWithTimeout("room:close", undefined, result => {
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
  if (data?.text) addSystem(data.text);
});

socket.on("room:closed", () => {
  clearAdminSession();
  backToLanding("La sessione è stata terminata dall'amministratore.");
});

// --------------------------------------------------
// RICONNESSIONE AUTOMATICA (admin e utenti)
// --------------------------------------------------

function resumeSession() {
  if (resuming || !socket.connected || !session || !currentKey) return;

  resuming = true;

  const s = session;

  const fail = () => {
    resuming = false;
    if (s.admin) clearAdminSession();
    backToLanding("Impossibile riprendere la sessione.");
  };

  emitWithTimeout("auth:login", {
    name: s.name,
    password: s.password || ""
  }, auth => {
    if (!auth?.ok) {
      fail();
      return;
    }

    myName = auth.name;
    myRole = auth.role;
    isAdmin = auth.role === "admin";
    canCapture = auth.canCapture === true;

    const event = s.admin ? "room:resume" : "room:join";
    const payload = s.admin ? { key: s.key, token: s.token } : { key: s.key };

    emitWithTimeout(event, payload, result => {
      resuming = false;

      if (!result?.ok) {
        fail();
        return;
      }

      enterRoom({
        key: s.key,
        name: s.name,
        admin: s.admin,
        token: s.token,
        preserve: true
      });

      showToast("Connessione ripristinata.");
    });
  });
}

socket.on("connect", resumeSession);

socket.on("disconnect", () => {
  if (currentKey) {
    showToast("Connessione interrotta. Tentativo di riconnessione...");
  }
});

socket.on("connect_error", () => {
  if (!currentKey) {
    showError("Server non raggiungibile. Controlla il server Render.");
  }
});

// --------------------------------------------------
// BEST-EFFORT COPY PROTECTION
// (scoraggia l'uso occasionale, non impedisce screenshot
//  o copie con strumenti esterni)
// --------------------------------------------------

document.addEventListener("contextmenu", event => event.preventDefault());
document.addEventListener("copy", event => event.preventDefault());
document.addEventListener("cut", event => event.preventDefault());

document.addEventListener("paste", event => {
  if (event.target?.id === "joinKey") return;
  event.preventDefault();
});

document.addEventListener("keydown", event => {
  const key = (event.key || "").toLowerCase();

  if (event.ctrlKey || event.metaKey) {
    if (key === "v" && event.target?.id === "joinKey") return;

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
