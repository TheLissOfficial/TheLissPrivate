# THELISS PRIVATE — Web Edition

Responsive web chat for desktop and mobile. Node.js + Express + Socket.IO.

## Requisiti
- Node.js 20 o superiore
- Una macchina/server raggiungibile dagli utenti
- HTTPS in produzione (necessario per proteggere la chiave in transito e per alcune API del browser)

## Avvio in locale
```bash
npm install
npm start
```
Apri `http://localhost:3000`.

Per far collegare altre persone, il server deve essere pubblicato su un hosting accessibile via HTTPS. Non basta avviare il progetto sul proprio PC se gli altri sono fuori dalla rete locale.

## Funzioni
- Creazione stanza con chiave casuale ad alta entropia
- Accesso con chiave e nickname
- Chat in tempo reale
- Lista e conteggio partecipanti
- Solo l'amministratore può terminare la stanza
- Messaggi non archiviati: il server li inoltra e non mantiene una cronologia
- Stanze e membri conservati solo in memoria del processo
- Layout responsive per smartphone, tablet e PC

## Limiti di sicurezza da conoscere
- **Screenshot:** una web app non può bloccare in modo affidabile gli screenshot su tutti i browser e sistemi operativi. Le scorciatoie e il menu contestuale vengono limitati come deterrente, ma non impediscono screenshot di sistema, strumenti di cattura, registrazioni esterne o fotografie con un altro dispositivo.
- **Copia/incolla:** il blocco lato browser è un deterrente, non una garanzia assoluta.
- **“Nessuna traccia”:** il progetto non salva messaggi o stanze su database e li tiene solo in RAM. Tuttavia non può cancellare eventuali screenshot, copie fatte dagli utenti, cache/telemetria del dispositivo, log del provider di hosting, log di rete o backup del server. In produzione occorre configurare l'hosting per non registrare IP/URL oltre quanto strettamente necessario, disabilitare analytics e verificare i log del reverse proxy.
- **Riavvio:** se il processo Node si riavvia, tutte le stanze in memoria vengono perse.
- **Amministratore offline:** se l'amministratore si disconnette temporaneamente, la stanza resta in memoria mentre ci sono partecipanti; può riprendere la sessione dallo stesso browser tramite sessionStorage. Se chiude la scheda o perde i dati di sessione, potrebbe non riuscire a terminare la stanza. Per una versione pubblica è consigliabile aggiungere una scadenza automatica lato server.

## Prima della pubblicazione
1. Pubblicare dietro HTTPS.
2. Impostare un limite di richieste/connessioni e protezione anti-abuso a livello hosting.
3. Configurare i log del server e del reverse proxy in modo coerente con l'informativa privacy.
4. Aggiungere una scadenza automatica delle stanze e un heartbeat amministratore.
5. Fare un audit di sicurezza prima di usare il servizio per comunicazioni sensibili.

Questa è una base funzionante per prototipo, non una piattaforma sottoposta ad audit di sicurezza.
