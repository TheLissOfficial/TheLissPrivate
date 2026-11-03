# THELISS PRIVATE

## Pubblicazione GitHub Pages + server

GitHub Pages pubblica soltanto l'interfaccia statica: **non esegue `server.js`**. Per la chat in tempo reale serve anche un hosting Node.js.

### 1. GitHub Pages
1. Carica nella radice del repository `index.html`, `styles.css`, `app.js` e `config.js`.
2. In GitHub apri **Settings → Pages**.
3. Scegli **Deploy from a branch**, branch `main`, cartella `/(root)`, poi Save.
4. Attendi la pubblicazione del sito.

### 2. Pubblica il server Node
Pubblica il repository su un hosting che supporti Node.js. Imposta:
- Build command: `npm install`
- Start command: `npm start`
- `CLIENT_ORIGIN`: origine del sito GitHub Pages, ad esempio `https://TUO-UTENTE.github.io`

Il server richiede Node.js 20 o superiore. Le stanze sono conservate solo nella RAM del processo: un riavvio le elimina.

### 3. Collega l'interfaccia al server
Quando l'hosting fornisce l'URL HTTPS del server, apri `config.js` nella radice e imposta:
```js
window.TL_SERVER_URL = "https://URL-DEL-TUO-SERVER";
```
Fai commit e attendi l'aggiornamento di GitHub Pages.

### Avvio locale
`npm install` poi `npm start`, quindi apri `http://localhost:3000`.

## Note importanti
- Una pagina web non può impedire in modo affidabile screenshot o registrazioni di sistema.
- Il blocco copia/incolla è solo un deterrente del browser. L'incolla è consentito soltanto nel campo della chiave.
- Il progetto non archivia la cronologia dei messaggi su database, ma provider di hosting e rete possono generare log.
- Non usare questo prototipo per comunicazioni che richiedono garanzie di sicurezza o anonimato.
