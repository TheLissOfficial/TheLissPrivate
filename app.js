
const socket = io(window.TL_SERVER_URL || undefined);
const $ = (id) => document.getElementById(id);

const landing = $("landing");
const chatView = $("chatView");

let currentKey = null;
let myName = "";
let isAdmin = false;
let myRole = "guest";
let canCapture = false;
let adminToken = null;
let adminPassword = "";
let authenticatedPassword = "";
let currentAuth = false;

function showToast(message) {
  const el = $("toast");
  el.textContent = message;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 2300);
}

function showError(message) {
  $("landingError").textContent = message || "";
}

function makePasswordField(id, placeholder) {
  const input = document.createElement("input");
  input.id = id;
  input.type = "password";
  input.placeholder = placeholder;
  input.autocomplete = "current-password";
  input.maxLength = 128;
  input.required = false;
  input.style.marginTop = "10px";
  input.style.width = "100%";
  input.style.boxSizing = "border-box";
  return input;
}

// Add password fields without requiring HTML changes.
const createNameInput = $("createName");
const joinNameInput = $("joinName");

const createPassword = makePasswordField(
  "createPassword",
  "Password amministratore TheLiss"
);

const joinPassword = makePasswordField(
  "joinPassword",
  "Password (solo account autorizzati)"
);

createNameInput.insertAdjacentElement("afterend", createPassword);
joinNameInput.insertAdjacentElement("afterend", joinPassword);

createPassword.autocomplete = "new-password";
createPassword.required = true;

// --------------------------------------------------
// AUTHENTICATION
// --------------------------------------------------

function authenticate(name, password, callback) {
  socket.emit("auth:login", {
    name,
    password
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
    }

    authenticatedPassword = password;

    callback({
      ok: true,
      ...result
    });
  });
}

// --------------------------------------------------
// ROOM
// --------------------------------------------------

function enterRoom({ key, name, admin, token }) {
  currentKey = key;
  myName = name;
  isAdmin = !!admin;
  canCapture = isAdmin;
  myRole = isAdmin ? "admin" : myRole;
  adminToken = token || null;

  landing.classList.add("hidden");
  chatView.classList.remove("hidden");

  $("roomKeyDisplay").textContent = key;
  $("myRole").textContent = isAdmin
    ? "ADMINISTRATOR"
    : myRole.toUpperCase();

  $("closeButton").classList.toggle("hidden", !isAdmin);

  $("messages").innerHTML =
    '<div class="empty-state"><span>///</span><p>Canale stabilito.<br>La conversazione non viene salvata come cronologia.</p></div>';

  if (isAdmin && token) {
    sessionStorage.setItem("tl_admin_key", key);
    sessionStorage.setItem("tl_admin_token", token);
    sessionStorage.setItem("tl_admin_name", name);
  }

  updateCaptureProtection();
  renderAdminPanel();
}

function backToLanding(message = "") {
  currentKey = null;
  isAdmin = false;
  canCapture = false;
  adminToken = null;

  chatView.classList.add("hidden");
  landing.classList.remove("hidden");

  $("messages").replaceChildren();
  $("memberList").replaceChildren();

  removeAdminPanel();
  updateCaptureProtection();

  showError(message);
}

function addMessage({ name, text, time, isAdmin: admin }) {
  const empty = $("messages").querySelector(".empty-state");
  if (empty) empty.remove();

  const box = document.createElement("article");
  box.className = "message" + (name === myName ? " mine" : "");

  const meta = document.createElement("div");
  meta.className = "message-meta";

  const who = document.createElement("span");
  who.textContent = name + (admin ? " / ADMIN" : "");

  const when = document.createElement("time");
  when.textContent = new Date(time).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit"
  });

  meta.append(who, when);

  const body = document.createElement("div");
  body.className = "message-body";
  body.textContent = text;

  box.append(meta, body);
  $("messages").append(box);
  $("messages").scrollTop = $("messages").scrollHeight;
}

function addSystem(text) {
  const empty = $("messages").querySelector(".empty-state");
  if (empty) empty.remove();

  const el = document.createElement("div");
  el.className = "system-message";
  el.textContent = text;

  $("messages").append(el);
  $("messages").scrollTop = $("messages").scrollHeight;
}

function updateMembers(state) {
  $("connectedCount").textContent = state.count;
  $("memberCount").textContent = state.count;

  const list = $("memberList");
  list.replaceChildren();

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

    list.append(li);
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
  panel.append(title);

  const subtitle = createAdminElement(
    "p",
    "Gestione account autorizzati"
  );
  panel.append(subtitle);

  const nameInput = document.createElement("input");
  nameInput.id = "adminNewName";
  nameInput.placeholder = "Nickname nuovo account";
  nameInput.maxLength = 24;
  nameInput.style.cssText = "width:100%;box-sizing:border-box;margin:6px 0;padding:10px;";

  const passwordInput = document.createElement("input");
  passwordInput.id = "adminNewPassword";
  passwordInput.type = "password";
  passwordInput.placeholder = "Password (minimo 10 caratteri)";
  passwordInput.maxLength = 128;
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
      return showToast("Inserisci nickname e password.");
    }

    socket.emit("admin:account:create", {
      name,
      password
    }, result => {
      if (!result?.ok) {
        return showToast(result?.error || "Creazione non riuscita.");
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
  if (!isAdmin) return;

  socket.emit("admin:accounts:list", {}, result => {
    if (!result?.ok) {
      return showToast(result?.error || "Errore caricamento account.");
    }

    const list = $("adminAccounts");
    if (!list) return;

    list.replaceChildren();

    if (!result.accounts.length) {
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

        socket.emit("admin:account:update", {
          oldName: account.nickname,
          newName: newName.trim(),
          password: newPassword
        }, response => {
          if (!response?.ok) {
            return showToast(
              response?.error || "Modifica non riuscita."
            );
          }

          showToast("Account aggiornato.");
          loadAdminAccounts();
        });
      });

      const revokeButton = createAdminElement(
        "button",
        "REVOCA"
      );

      revokeButton.type = "button";

      revokeButton.addEventListener("click", () => {
        if (!confirm(
          `Revocare definitivamente l'account ${account.nickname}?`
        )) return;

        socket.emit("admin:account:revoke", {
          name: account.nickname
        }, response => {
          if (!response?.ok) {
            return showToast(
              response?.error || "Revoca non riuscita."
            );
          }

          showToast("Account revocato.");
          loadAdminAccounts();
        });
      });

      row.append(label, editButton, revokeButton);
      list.append(row);
    });
  });
}

// --------------------------------------------------
// CAPTURE PERMISSIONS
// --------------------------------------------------

let protectionOverlay = null;

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

    protectionOverlay.textContent =
      "SESSION PROTECTED";

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

$("createForm").addEventListener("submit", event => {
  event.preventDefault();
  showError("");

  const name = $("createName").value.trim();
  const password = createPassword.value;

  authenticate(name, password, auth => {
    if (!auth.ok) {
      return showError(auth.error);
    }

    if (auth.role !== "admin") {
      return showError("Solo TheLiss può creare una stanza.");
    }

    socket.emit("room:create", {}, result => {
      if (!result?.ok) {
        return showError(
          result?.error || "Impossibile creare la stanza."
        );
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

$("joinForm").addEventListener("submit", event => {
  event.preventDefault();
  showError("");

  const key = $("joinKey").value.trim();
  const name = $("joinName").value.trim();
  const password = joinPassword.value;

  authenticate(name, password, auth => {
    if (!auth.ok) {
      return showError(auth.error);
    }

    if (auth.role === "admin") {
      return showError(
        "TheLiss deve utilizzare il modulo di creazione."
      );
    }

    socket.emit("room:join", {
      key
    }, result => {
      if (!result?.ok) {
        return showError(
          result?.error || "Accesso non riuscito."
        );
      }

      enterRoom({
        key: result.key,
        name: result.name,
        admin: false
      });

      joinPassword.value = "";
    });
  });
});

// --------------------------------------------------
// CHAT MESSAGES
// --------------------------------------------------

$("messageForm").addEventListener("submit", event => {
  event.preventDefault();

  const input = $("messageInput");
  const text = input.value.trim();

  if (!text) return;

  socket.emit("chat:message", {
    text
  }, result => {
    if (!result?.ok) {
      showToast(result?.error || "Messaggio non inviato.");
    }
  });

  input.value = "";
  input.focus();
});

// --------------------------------------------------
// COPY ROOM KEY
// --------------------------------------------------

$("copyKey").addEventListener("click", async () => {
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

$("leaveButton").addEventListener("click", () => {
  if (isAdmin) {
    if (!confirm(
      "Uscire senza chiudere la stanza? La stanza resterà attiva finché non viene chiusa o non si svuota."
    )) return;
  }

  socket.emit("room:leave");

  if (isAdmin) {
    sessionStorage.removeItem("tl_admin_key");
    sessionStorage.removeItem("tl_admin_token");
    sessionStorage.removeItem("tl_admin_name");
  }

  backToLanding();
});

// --------------------------------------------------
// CLOSE ROOM
// --------------------------------------------------

$("closeButton").addEventListener("click", () => {
  if (!isAdmin) return;

  if (!confirm(
    "TERMINARE LA SESSIONE? Tutti verranno disconnessi e la stanza sarà eliminata."
  )) return;

  socket.emit("room:close", result => {
    if (!result?.ok) {
      return showToast(
        result?.error || "Chiusura non riuscita."
      );
    }

    sessionStorage.removeItem("tl_admin_key");
    sessionStorage.removeItem("tl_admin_token");
    sessionStorage.removeItem("tl_admin_name");

    backToLanding("Sessione terminata.");
  });
});

// --------------------------------------------------
// SOCKET EVENTS
// --------------------------------------------------

socket.on("room:state", updateMembers);
socket.on("chat:message", addMessage);

socket.on("chat:system", data => {
  addSystem(data.text);
});

socket.on("room:closed", () => {
  sessionStorage.removeItem("tl_admin_key");
  sessionStorage.removeItem("tl_admin_token");
  sessionStorage.removeItem("tl_admin_name");

  backToLanding(
    "La sessione è stata terminata dall'amministratore."
  );
});

// --------------------------------------------------
// RECONNECT ADMIN
// --------------------------------------------------

socket.on("connect", () => {
  const key = sessionStorage.getItem("tl_admin_key");
  const token = sessionStorage.getItem("tl_admin_token");

  if (!key || !token || !adminPassword) return;

  socket.emit("auth:login", {
    name: "TheLiss",
    password: adminPassword
  }, auth => {
    if (!auth?.ok) return;

    isAdmin = true;
    canCapture = true;
    currentAuth = true;

    socket.emit("room:resume", {
      key,
      token
    }, result => {
      if (result?.ok) {
        enterRoom({
          key,
          name: "TheLiss",
          admin: true,
          token
        });
      } else {
        sessionStorage.removeItem("tl_admin_key");
        sessionStorage.removeItem("tl_admin_token");
        sessionStorage.removeItem("tl_admin_name");
      }
    });
  });
});

socket.on("disconnect", () => {
  if (currentKey) {
    showToast("Connessione interrotta.");
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
    ) return;

    if (["c", "x", "v", "s", "p", "u"].includes(key)) {
      event.preventDefault();
    }
  }
});

document.title = "THELISS PRIVATE";
