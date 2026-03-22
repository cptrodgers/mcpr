# Deploying mcpr Relay Server

## Prerequisites

- VPS with public IP (Ubuntu 22.04+ recommended)
- Domain with DNS control (Cloudflare, Route53, etc.)
- Wildcard DNS support
- Docker installed on VPS (optional)

## 1. DNS

Add a wildcard A record pointing to your VPS. Example using Cloudflare:

| Type | Name | Content | Proxy status |
|------|------|---------|--------------|
| A | `tunnel` | `YOUR_VPS_IP` | DNS only (grey cloud) |
| A | `*.tunnel` | `YOUR_VPS_IP` | DNS only (grey cloud) |

**Important**: You need both records — the wildcard doesn't match the bare domain. If using Cloudflare, use "DNS only" (grey cloud), not "Proxied" — Cloudflare's proxy doesn't handle arbitrary WebSocket upgrades well.

## 2. TLS Certificate

You need a wildcard certificate for `*.tunnel.yourdomain.com`. Example with certbot + Cloudflare DNS:

```bash
apt update && apt install -y nginx certbot python3-certbot-dns-cloudflare

# Create credentials file
cat > /etc/cloudflare.ini << 'EOF'
dns_cloudflare_api_token = YOUR_CF_API_TOKEN
EOF
chmod 600 /etc/cloudflare.ini

# Obtain wildcard cert
certbot certonly \
  --dns-cloudflare \
  --dns-cloudflare-credentials /etc/cloudflare.ini \
  -d "*.tunnel.yourdomain.com" \
  -d "tunnel.yourdomain.com" \
  --agree-tos \
  -m you@example.com
```

Certbot auto-renews via systemd timer. Verify: `systemctl list-timers | grep certbot`

Other DNS providers: use the appropriate certbot DNS plugin or use Caddy for automatic TLS.

## 3. Reverse Proxy

### nginx

Create `/etc/nginx/conf.d/tunnel.conf`:

```nginx
server {
    listen 443 ssl;
    server_name tunnel.yourdomain.com *.tunnel.yourdomain.com;

    ssl_certificate /etc/letsencrypt/live/tunnel.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/tunnel.yourdomain.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:8081;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }
}

server {
    listen 80;
    server_name tunnel.yourdomain.com *.tunnel.yourdomain.com;
    return 301 https://$host$request_uri;
}
```

```bash
nginx -t && systemctl reload nginx
```

### Caddy (alternative)

```
*.tunnel.yourdomain.com {
    reverse_proxy localhost:8081
}
```

Caddy handles TLS automatically with wildcard certs via DNS challenge.

## 4. Run the Relay

### Direct

```bash
mcpr --relay --port 8081 --relay-domain tunnel.yourdomain.com
```

### With Docker

```bash
docker run -d \
  --name mcpr-relay \
  --restart unless-stopped \
  -p 8081:8080 \
  ghcr.io/cptrodgers/mcpr:latest \
  --relay --port 8080 --relay-domain tunnel.yourdomain.com
```

### Update

```bash
docker pull ghcr.io/cptrodgers/mcpr:latest
docker stop mcpr-relay && docker rm mcpr-relay
docker run -d \
  --name mcpr-relay \
  --restart unless-stopped \
  -p 8081:8080 \
  ghcr.io/cptrodgers/mcpr:latest \
  --relay --port 8080 --relay-domain tunnel.yourdomain.com
```

## 5. Verify

From your local machine:

```bash
# Check relay is reachable
curl -s https://tunnel.yourdomain.com/_tunnel/register

# Full test: start mcpr client
mcpr --relay-url https://tunnel.yourdomain.com --mcp http://localhost:9000
# Should print: Tunnel: https://xxxxxx.tunnel.yourdomain.com
```

## Troubleshooting

| Issue | Fix |
|-------|-----|
| `tunnel not found` | Client not connected. Check mcpr client logs. |
| SSL errors | Check cert: `sudo certbot certificates` |
| WebSocket timeout | Verify nginx `proxy_read_timeout` is set high |
| 502 from nginx | Check relay is running: `docker logs mcpr-relay` |
