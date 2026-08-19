# Deploying on a VPS

Two processes: **Lavalink** (Java, does the audio) and **the bot** (Node, does
Discord). Both on the same box, Lavalink bound to localhost.

Sizing: 1 vCPU / 2 GB RAM handles roughly 20–40 simultaneous streams. The
constraint is bandwidth, not CPU — each stream is ~130 kbit/s out, so 30
concurrent players is ~4 Mbit/s sustained. Check your provider's traffic cap
before you scale up.

---

## 1. Base system

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl git ufw

# Java 17+ for Lavalink
sudo apt install -y openjdk-21-jre-headless
java -version

# Node 20 LTS for the bot
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node -v
```

Run services as a normal user, not root:

```bash
sudo adduser --disabled-password --gecos "" music
sudo su - music
```

## 2. Lavalink

```bash
mkdir -p ~/lavalink && cd ~/lavalink
# grab the latest Lavalink.jar from:
# https://github.com/lavalink-devs/Lavalink/releases
curl -L -o Lavalink.jar https://github.com/lavalink-devs/Lavalink/releases/latest/download/Lavalink.jar
```

Copy `lavalink/application.yml` from this project next to `Lavalink.jar`, then:

- change `password` to something long and random,
- put the same value in the bot's `.env` as `LAVALINK_PASSWORD`,
- fill in your Spotify client ID/secret if you want Spotify links to resolve,
- check the plugin versions against their release pages.

First run in the foreground so you can watch plugins download:

```bash
java -Xmx1G -jar Lavalink.jar
```

Wait for `Lavalink is ready to accept connections`, then Ctrl-C.

### systemd unit

`sudo nano /etc/systemd/system/lavalink.service`

```ini
[Unit]
Description=Lavalink audio node
After=network.target

[Service]
Type=simple
User=music
WorkingDirectory=/home/music/lavalink
ExecStart=/usr/bin/java -Xmx1G -jar /home/music/lavalink/Lavalink.jar
Restart=on-failure
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now lavalink
sudo systemctl status lavalink
journalctl -u lavalink -f      # live logs
```

## 3. The bot

```bash
cd ~ && git clone <your-repo> music-bot   # or scp the folder up
cd music-bot
npm install --omit=dev
cp .env.example .env && nano .env          # token, client id, lavalink password
npm run deploy                             # register slash commands
```

Run it under pm2 so it survives reboots:

```bash
sudo npm install -g pm2
pm2 start ecosystem.config.js
pm2 save
pm2 startup          # run the command it prints
pm2 logs music-bot
```

## 4. Firewall

Lavalink must **not** be reachable from the internet. It listens on
`127.0.0.1` in the supplied config; the firewall is the second layer.

```bash
sudo ufw allow OpenSSH
sudo ufw enable
sudo ufw status          # 2333 must NOT appear
```

If you ever see 2333 open to the world, close it immediately — an open Lavalink
node with a known password is an open proxy.

## 5. Updating

```bash
cd ~/music-bot && git pull && npm install --omit=dev
pm2 restart music-bot
# Lavalink: replace Lavalink.jar, then
sudo systemctl restart lavalink
```

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `Connection refused 127.0.0.1:2333` | Lavalink not running | `systemctl status lavalink`, check `journalctl -u lavalink -n 50` |
| Node connects, all searches return nothing | plugin failed to load | check Lavalink startup log for plugin download errors |
| Bot joins but there is silence | wrong Discord voice region or firewall blocking UDP | allow outbound UDP; try another voice region on the channel |
| Commands do not appear | not registered, or global propagation delay | run `npm run deploy` with `GUILD_ID` set for instant registration |
| `Missing Access` on join | bot lacks Connect/Speak in that channel | fix channel permission overrides |
| Audio stutters | CPU or bandwidth saturated | lower `opusEncodingQuality`, raise `bufferDurationMs`, or move to a bigger box |
| YouTube tracks fail to load, others work | YouTube changed something | update the youtube-source plugin to its newest release |
| Bot leaves immediately | `EMPTY_CHANNEL_TIMEOUT_MS` fired, or nobody in channel | raise the value or enable `/247` |

Logs to read first: `pm2 logs music-bot --lines 100` and
`journalctl -u lavalink -n 100`.
