# Duet Production Deployment Runbook

Deploy Duet on a Linux server and publish it through Cloudflare Tunnel. The app binds to host loopback port **10000** and is not exposed directly to the Internet.

## Architecture

```
Client -> https://chat.example.com (Cloudflare)
       -> Cloudflare Tunnel
       -> cloudflared on server
       -> http://127.0.0.1:10000
       -> Duet container (port 3000)
```

## 1. Prerequisites

- Debian/Ubuntu server
- Docker Engine and Docker Compose plugin
- Domain managed by Cloudflare DNS
- Cloudflare Zero Trust access

```bash
docker --version
docker compose version
```

## 2. Deploy Duet

```bash
cd /opt
git clone https://github.com/adourix/ayad-chat.git
cd ayad-chat
cp .env.example .env
nano .env
```

Set the exact public origin (no trailing slash):

```env
ALLOWED_ORIGINS=https://chat.example.com
SESSION_COOKIE_NAME=__Host-duet_session
SESSION_TTL_DAYS=30
LOG_LEVEL=info
```

Create data storage and set permissions:

```bash
mkdir -p data
sudo chown -R 10001:10001 data
chmod 600 .env
```

Host port mapping in `docker-compose.yml`:

```yaml
ports:
  - "127.0.0.1:10000:3000"
```

Start and inspect:

```bash
docker compose up -d --build
docker compose ps
docker compose logs -f app
```

Local health test:

```bash
curl -fsS http://127.0.0.1:10000/healthz
```

## 3. Create Cloudflare Tunnel

1. Cloudflare Dashboard -> **Zero Trust** -> **Networks** -> **Tunnels** (labels may vary).
2. Create a tunnel using **Cloudflared**; name it `duet-server`.
3. Select the Linux connector instructions for your server architecture and copy the tunnel token. Keep this token private.
4. Add a Public Hostname:
   - Subdomain: `chat`
   - Domain: your Cloudflare-managed domain
   - Service: `HTTP`
   - Origin URL: `127.0.0.1:10000`
5. Save. Cloudflare will associate/manage the hostname DNS route for the tunnel.

## 4. Install cloudflared on Debian/Ubuntu

Use the official Cloudflare installation instructions for your OS and CPU architecture. After installing the `cloudflared` package, install the connector service using the token from the tunnel page:

```bash
sudo cloudflared service install YOUR_TUNNEL_TOKEN
```

Do not commit the token or put it in project files. Avoid leaving it in shell history.

Check service and logs:

```bash
sudo systemctl status cloudflared --no-pager
sudo journalctl -u cloudflared -n 100 --no-pager
```

## 5. Verify from end to end

Server-side:

```bash
curl -fsS http://127.0.0.1:10000/healthz
```

From another device/network, open `https://chat.example.com` and test:

- HTTPS with no certificate warning
- Login
- Direct and group messages
- Live delivery (WebSocket)
- Refresh/reconnect and history sync
- PWA install, where supported

Cloudflare Tunnel supports WebSocket proxying; no extra WebSocket port is needed. Route the hostname to the app's local HTTP listener.

## 6. Create accounts

```bash
cd /opt/ayad-chat
docker compose exec -it app node server/dist/cli/createUser.js
```

Create accounts only for trusted users. Public signup is intentionally disabled.

## 7. Operations

Status:

```bash
cd /opt/ayad-chat
docker compose ps
sudo systemctl status cloudflared --no-pager
```

Logs:

```bash
docker compose logs --tail=200 app
sudo journalctl -u cloudflared -n 200 --no-pager
```

Restart:

```bash
docker compose restart app
sudo systemctl restart cloudflared
```

Update:

```bash
cd /opt/ayad-chat
git pull
docker compose up -d --build
docker compose ps
curl -fsS http://127.0.0.1:10000/healthz
```

## 8. Backup and restore

```bash
chmod +x deploy/backup.sh deploy/restore.sh
./deploy/backup.sh
```

Backups are saved under `./backups`; copy them off-server regularly.

Restore (the script first preserves the current data directory):

```bash
./deploy/restore.sh ./backups/duet-YYYYMMDDTHHMMSSZ.tar.gz
```

Verify after restoring:

```bash
docker compose ps
curl -fsS http://127.0.0.1:10000/healthz
```

## 9. Security checklist

- [ ] `ALLOWED_ORIGINS` is the exact HTTPS origin.
- [ ] `.env` is not committed and has restricted permissions.
- [ ] Cloudflare Tunnel token is secret and never committed.
- [ ] Duet listens on `127.0.0.1:10000`, not a public interface.
- [ ] No router port-forward is configured for Duet.
- [ ] Accounts are provisioned only with the CLI.
- [ ] Off-server backup exists and restore has been tested.
- [ ] OS and Docker are updated regularly.

## 10. Troubleshooting

### Tunnel connected, hostname unavailable
- Verify the Public Hostname origin is `http://127.0.0.1:10000`.
- Test local app: `curl -v http://127.0.0.1:10000/healthz`.
- Check: `sudo journalctl -u cloudflared -n 100 --no-pager`.

### App health fails
```bash
docker compose ps
docker compose logs --tail=200 app
```

### Live messaging/WebSocket fails
- Confirm the hostname routes to the app HTTP listener.
- Inspect browser developer tools for WebSocket errors.
- Review app and cloudflared logs.

### DNS/hostname fails
- Confirm hostname is assigned to the intended Tunnel and DNS record exists.
- Retry after DNS propagation.

---

Replace `chat.example.com` with the real hostname before deployment.
