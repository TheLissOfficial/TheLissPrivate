const socket = io(window.TL_SERVER_URL || undefined);
const $ = (id) => document.getElementById(id);
const landing = $("landing"), chatView = $("chatView");
let currentKey = null, myName = "", isAdmin = false;
let adminToken = null;

function showToast(message) {
  const el = $("toast"); el.textContent = message; el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 2300);
}
function showError(message) { $("landingError").textContent = message || ""; }
function enterRoom({ key, name, admin, token }) {
  currentKey = key; myName = name; isAdmin = !!admin; adminToken = token || null;
  landing.classList.add("hidden"); chatView.classList.remove("hidden");
  $("roomKeyDisplay").textContent = key;
  $("myRole").textContent = isAdmin ? "ADMINISTRATOR" : "GUEST";
  $("closeButton").classList.toggle("hidden", !isAdmin);
  $("messages").innerHTML = '<div class="empty-state"><span>///</span><p>Canale stabilito.<br>La conversazione non viene salvata come cronologia.</p></div>';
  if (isAdmin && token) {
    sessionStorage.setItem("tl_admin_key", key);
    sessionStorage.setItem("tl_admin_token", token);
    sessionStorage.setItem("tl_admin_name", name);
  }
}
function backToLanding(message = "") {
  currentKey = null; isAdmin = false; adminToken = null;
  chatView.classList.add("hidden"); landing.classList.remove("hidden");
  $("messages").replaceChildren(); $("memberList").replaceChildren();
  showError(message);
}
function addMessage({ name, text, time, isAdmin: admin }) {
  const empty = $("messages").querySelector(".empty-state"); if (empty) empty.remove();
  const box = document.createElement("article");
  box.className = "message" + (name === myName ? " mine" : "");
  const meta = document.createElement("div"); meta.className = "message-meta";
  const who = document.createElement("span"); who.textContent = name + (admin ? " / ADMIN" : "");
  const when = document.createElement("time");
  when.textContent = new Date(time).toLocaleTimeString([], {hour:"2-digit", minute:"2-digit"});
  meta.append(who, when);
  const body = document.createElement("div"); body.className = "message-body"; body.textContent = text;
  box.append(meta, body); $("messages").append(box);
  $("messages").scrollTop = $("messages").scrollHeight;
}
function addSystem(text) {
  const empty = $("messages").querySelector(".empty-state"); if (empty) empty.remove();
  const el = document.createElement("div"); el.className = "system-message"; el.textContent = text;
  $("messages").append(el); $("messages").scrollTop = $("messages").scrollHeight;
}
function updateMembers(state) {
  $("connectedCount").textContent = state.count;
  $("memberCount").textContent = state.count;
  const list = $("memberList"); list.replaceChildren();
  state.people.forEach(person => {
    const li = document.createElement("li");
    const label = document.createElement("span"); label.textContent = person.name;
    li.append(label);
    if (person.isAdmin) { const tag = document.createElement("span"); tag.className = "admin-tag"; tag.textContent = "ADMIN"; li.append(tag); }
    list.append(li);
  });
}

$("createForm").addEventListener("submit", (event) => {
  event.preventDefault(); showError("");
  const name = $("createName").value.trim();
  socket.emit("room:create", { name }, (result) => {
    if (!result?.ok) return showError(result?.error || "Impossibile creare la stanza.");
    enterRoom({ key: result.key, name: result.name, admin: true, token: result.adminToken });
    showToast("Stanza creata. Condividi la chiave.");
  });
});
$("joinForm").addEventListener("submit", (event) => {
  event.preventDefault(); showError("");
  const key = $("joinKey").value.trim(), name = $("joinName").value.trim();
  socket.emit("room:join", { key, name }, (result) => {
    if (!result?.ok) return showError(result?.error || "Accesso non riuscito.");
    enterRoom({ key: result.key, name: result.name, admin: false });
  });
});
$("messageForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const input = $("messageInput"), text = input.value.trim();
  if (!text) return;
  socket.emit("chat:message", { text }, (result) => {
    if (!result?.ok) showToast(result?.error || "Messaggio non inviato.");
  });
  input.value = ""; input.focus();
});
$("copyKey").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText(currentKey); showToast("Chiave copiata."); }
  catch { showToast("Seleziona e copia la chiave manualmente."); }
});
$("leaveButton").addEventListener("click", () => {
  if (isAdmin) {
    if (!confirm("Uscire senza chiudere la stanza? La stanza resterà attiva finché non viene chiusa o non si svuota.")) return;
  }
  socket.emit("room:leave");
  if (isAdmin) {
    sessionStorage.removeItem("tl_admin_key");
    sessionStorage.removeItem("tl_admin_token");
    sessionStorage.removeItem("tl_admin_name");
  }
  backToLanding();
});
$("closeButton").addEventListener("click", () => {
  if (!confirm("TERMINARE LA SESSIONE? Tutti verranno disconnessi e la stanza sarà eliminata.")) return;
  socket.emit("room:close", (result) => {
    if (!result?.ok) return showToast(result?.error || "Chiusura non riuscita.");
    sessionStorage.removeItem("tl_admin_key");
    sessionStorage.removeItem("tl_admin_token");
    sessionStorage.removeItem("tl_admin_name");
    backToLanding("Sessione terminata.");
  });
});

socket.on("room:state", updateMembers);
socket.on("chat:message", addMessage);
socket.on("chat:system", (data) => addSystem(data.text));
socket.on("room:closed", () => {
  sessionStorage.removeItem("tl_admin_key");
  sessionStorage.removeItem("tl_admin_token");
  sessionStorage.removeItem("tl_admin_name");
  backToLanding("La sessione è stata terminata dall'amministratore.");
});
socket.on("connect", () => {
  const key = sessionStorage.getItem("tl_admin_key");
  const token = sessionStorage.getItem("tl_admin_token");
  const name = sessionStorage.getItem("tl_admin_name");
  if (!currentKey && key && token && name) {
    socket.emit("room:resume", { key, token }, (result) => {
      if (result?.ok) enterRoom({ key, name: result.name || name, admin: true, token });
      else {
        sessionStorage.removeItem("tl_admin_key");
        sessionStorage.removeItem("tl_admin_token");
        sessionStorage.removeItem("tl_admin_name");
      }
    });
  }
});
socket.on("disconnect", () => {
  if (currentKey) showToast("Connessione interrotta.");
});

// Best-effort friction only. A browser page cannot reliably prevent screenshots,
// operating-system capture, external cameras, or all clipboard methods.
document.addEventListener("contextmenu", e => e.preventDefault());
document.addEventListener("copy", e => e.preventDefault());
document.addEventListener("cut", e => e.preventDefault());
document.addEventListener("paste", e => {
  if (e.target && e.target.id === "joinKey") return;
  e.preventDefault();
});
document.addEventListener("keydown", e => {
  const key = e.key.toLowerCase();
  if (e.ctrlKey || e.metaKey) {
    if (key === "v" && e.target && e.target.id === "joinKey") return;
    if (["c","x","v","s","p","u"].includes(key)) e.preventDefault();
  }
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden && currentKey) document.title = "SESSION HIDDEN";
  else document.title = "THELISS PRIVATE";
});
socket.on("connect_error", () => {
  showError("Server non raggiungibile. Il sito è online, ma il server chat deve essere pubblicato e configurato.");
});
