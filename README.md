# Praxis für Ergotherapie – Website mit Terminbuchung & Admin-Panel

Schlanke Node.js-Anwendung ohne Build-Schritt: **Express + SQLite (better-sqlite3)** im Backend, reines HTML/CSS/JS im Frontend.

## Start

```bash
npm install
npm start            # http://localhost:3000   (Admin: /admin)
```

Beim ersten Start wird ein Admin-Zugang angelegt. Das zufällige Passwort steht in der Konsole.
Eigene Werte: `ADMIN_USER=… ADMIN_PASSWORD=… npm start`. Weitere Variablen: `PORT`, `DATA_DIR`, `TZ` (Standard `Europe/Berlin`), `NODE_ENV=production` (Secure-Cookie, hinter HTTPS).

## Funktionen

**Website:** Startseite, Leistungen (aus der DB), Ablauf, Über uns, Öffnungszeiten, Kontakt, Impressum/Datenschutz (Platzhalter!),
Buchungsassistent (Leistung → Kalender/Uhrzeit → Daten), Termin-Link zum Verwalten/Absagen (`/termin?t=…`).

**Admin (`/admin`):** Übersicht mit Kennzahlen, Terminliste mit Filter/Suche, bestätigen/absagen/löschen, Termine manuell anlegen,
Leistungen verwalten, Öffnungszeiten & Urlaubstage, Praxisdaten, Buchungs-Einstellungen (Raster, Vorlauf, Auto-Bestätigung), Passwort ändern.

**Sicherheit:** bcrypt-Passwörter, HttpOnly/SameSite-Cookie, Rate-Limiting, Helmet/CSP, Honeypot, Doppelbuchungs-Schutz per Transaktion.

## Hinweise

- Es werden keine E-Mails versendet (Bestätigung erfolgt auf der Seite). Für Mailversand z. B. `nodemailer` in `POST /api/appointments` ergänzen.
- Impressum und Datenschutz sind nur Platzhalter und müssen rechtlich geprüft/ersetzt werden.
- Daten liegen in `data/praxis.db` (per Backup sichern).
