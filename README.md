# 🎙️ YouTube AI Voiceover Bot

Telegram bot that generates professional English voiceovers for YouTube cooking videos using **Google Gemini 2.5 Pro TTS**.

**Bot:** [@ForYoutube_AI_bot](https://t.me/ForYoutube_AI_bot)

---

## 🚀 Features

- Receives text/recipe scripts via Telegram
- Generates natural American English voiceovers using Gemini 2.5 Pro TTS
- Optimized for YouTube food & cooking content for US audience
- Whitelist-based access control by Telegram user ID
- Dockerized, runs on Ubuntu server
- Auto-deploys on push to `main` via GitHub Actions

---

## 🛠️ Tech Stack

- **Runtime:** Node.js 20
- **Bot framework:** Telegraf v4
- **TTS:** Google Gemini 2.5 Pro (`gemini-2.5-pro-preview-tts`)
- **Container:** Docker + Docker Compose
- **CI/CD:** GitHub Actions → SSH deploy

---

## ⚙️ Setup

### 1. Clone & configure

```bash
git clone https://github.com/Vladivals/telegramBotForYoutube_AI.git
cd telegramBotForYoutube_AI
cp .env.example .env
# Fill in your values in .env
```

### 2. Get your Telegram ID

Start the bot and send `/id` — it will reply with your Telegram user ID.

### 3. Add yourself to whitelist

In `.env`:
```
ALLOWED_TELEGRAM_IDS=your_telegram_id,another_id
```

### 4. Run locally

```bash
npm install
npm start
```

### 5. Run with Docker

```bash
docker build -t tg-youtube-bot:latest .
docker compose up -d
```

---

## 🔐 GitHub Actions Secrets

Add these secrets to the GitHub repository (`Settings → Secrets → Actions`):

| Secret | Value |
|--------|-------|
| `SSH_PRIVATE_KEY` | Contents of `ytPosting.pem` |
| `SERVER_HOST` | `31.44.3.127` |
| `SERVER_USER` | `root` |

---

## 📦 Server Management

```bash
# SSH into server
ssh -i ytPosting/ytPosting.pem root@31.44.3.127

# View bot logs
docker logs -f tg-youtube-bot --tail=100

# Restart bot
docker restart tg-youtube-bot

# Check status
docker ps | grep tg-youtube-bot
```

---

## 🎤 Gemini TTS Voices

Available voices for `GEMINI_TTS_VOICE`:

| Voice | Style |
|-------|-------|
| `Kore` | Default, clear & professional |
| `Charon` | Warm, conversational |
| `Fenrir` | Deep, authoritative |
| `Aoede` | Smooth, melodic |
| `Puck` | Bright, energetic |

---

## 📝 Usage

1. Open [@ForYoutube_AI_bot](https://t.me/ForYoutube_AI_bot)
2. Send `/start`
3. Paste your cooking script
4. Receive the audio voiceover file (WAV format)
5. Use in your YouTube video editor

---

## 🔄 Auto-Deploy

Every push to `main` branch automatically:
1. SSHs into the server
2. Pulls latest code
3. Rebuilds Docker image
4. Restarts the container
