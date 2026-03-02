# 🎭 Secret Hitler Online

Vollständige Online-Multiplayer-Version von Secret Hitler – gebaut mit Node.js, Socket.io und deployt auf Fly.io.

## Features
- Echtzeit-Multiplayer für 5–10 Spieler
- Raum-System mit Einladungscode
- Vollständige Spiellogik (Nominierung, Abstimmung, Gesetze, Sondermächte)
- Geheime Rollenzuweisung (Liberal, Faschist, Hitler)
- Alle Sondermächte: Exekution, Untersuchung, Sonderwahl
- Mobile-friendly Design

---

## 🚀 Auf Fly.io deployen (Schritt für Schritt)

### 1. Fly.io Account erstellen
👉 https://fly.io → "Sign Up" → Kreditkarte hinterlegen (für Hobby-Plan)

### 2. Flyctl installieren

**Windows (PowerShell):**
```powershell
iwr https://fly.io/install.ps1 -useb | iex
```

**Mac:**
```bash
brew install flyctl
```

**Linux:**
```bash
curl -L https://fly.io/install.sh | sh
```

### 3. Einloggen
```bash
flyctl auth login
```

### 4. In den Projektordner wechseln
```bash
cd secret-hitler
```

### 5. App erstellen (einmalig)
```bash
flyctl launch --name secret-hitler-online --region fra --no-deploy
```
> `fra` = Frankfurt (für deutsche Nutzer am schnellsten)
> Du kannst den Namen frei wählen, muss aber einzigartig sein!

### 6. fly.toml anpassen
Öffne `fly.toml` und ändere die erste Zeile:
```toml
app = "DEIN-APP-NAME"  # z.B. "mein-secret-hitler"
```

### 7. Deployen!
```bash
flyctl deploy
```

### 8. Spiel öffnen
```bash
flyctl open
```
Oder direkt: `https://DEIN-APP-NAME.fly.dev`

---

## 🔄 Updates deployen
```bash
flyctl deploy
```
Das ist alles! Fly.io baut und deployt automatisch.

---

## 💰 Kosten
- Fly.io Hobby-Plan: **$0–5/Monat** (abhängig vom Traffic)
- Auto-Stop wenn niemand spielt → minimale Kosten
- Für mehr Traffic: `fly scale vm shared-cpu-2x`

---

## 🛠 Lokal testen
```bash
npm install
npm start
# Öffne http://localhost:3000
```

---

## 📁 Projektstruktur
```
secret-hitler/
├── server.js        # Backend (Node.js + Socket.io)
├── package.json
├── fly.toml         # Fly.io Konfiguration
├── Dockerfile
└── public/
    └── index.html   # Frontend
```

---

## ⚖️ Hinweis
Secret Hitler ist ein Brettspiel von Goat, Wolf & Cabbage. Dieses Projekt ist eine inoffizielle Online-Implementierung für privaten Gebrauch.
