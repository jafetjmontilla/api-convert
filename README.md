# api-convert

Microservicio HTTP independiente para conversión síncrona de documentos:

- **HTML → miniatura WebP** (180×270 px)
- **HTML → PNG** (captura rectangular, p. ej. QR para WhatsApp)
- **URL → PDF** (formatos `A4`, `letter`, `legal`)

No persiste archivos ni usa caché: cada petición devuelve el binario generado en la misma respuesta.

## Requisitos

- **Node.js** >= 20
- **yarn** >= 1.22
- Dependencias del sistema para Chromium (Puppeteer)

En Debian/Ubuntu:

```bash
sudo apt-get update && sudo apt-get install -y \
  ca-certificates fonts-liberation libasound2 libatk-bridge2.0-0 libatk1.0-0 \
  libc6 libcairo2 libcups2 libdbus-1-3 libexpat1 libfontconfig1 libgbm1 \
  libgcc1 libglib2.0-0 libgtk-3-0 libnspr4 libnss3 libpango-1.0-0 \
  libpangocairo-1.0-0 libstdc++6 libx11-6 libx11-xcb1 libxcb1 libxcomposite1 \
  libxcursor1 libxdamage1 libxext6 libxfixes3 libxi6 libxrandr2 libxrender1 \
  libxss1 libxtst6 lsb-release wget xdg-utils
```

## Instalación

```bash
yarn install
cp .env.example .env
# Editar .env y definir CONVERT_TOKEN (mín. 32 caracteres)
```

## Desarrollo

```bash
yarn start
```

Por defecto escucha en `http://localhost:4004`.

## Producción (PM2)

Definir variables en `.env` (copiar desde `.env.example`). `ecosystem.config.js` solo configura PM2 (`NODE_ENV`, logs, memoria, etc.); la app carga el resto vía `dotenv` al arrancar.

```bash
mkdir -p logs
cp .env.example .env   # si aún no existe
# Editar .env (CONVERT_TOKEN obligatorio)
pm2 start ecosystem.config.js --env production
pm2 save
```

Comandos útiles:

```bash
pm2 logs api-convert
pm2 restart api-convert
pm2 stop api-convert
```

> Usar **una sola instancia** (`instances: 1`). Cada proceso levanta su propio Chromium; escalar con `CONCURRENCY`, no con cluster de PM2.

## Variables de entorno

Copiar `.env.example` a `.env` y definir valores reales. Es la **fuente de verdad** tanto para `yarn start` como para PM2 (`dotenv` al arrancar). Los defaults en `index.js` solo aplican si falta la variable.

| Variable | Default | Descripción |
|----------|---------|-------------|
| `CONVERT_TOKEN` | — | **Obligatorio.** Secret compartido (mín. 32 caracteres). Header `X-Convert-Token`. |
| `PORT` | `4004` | Puerto HTTP |
| `CONCURRENCY` | `3` | Conversiones simultáneas máximas |
| `NAVIGATION_TIMEOUT_MS` | `30000` | Timeout de navegación/render (ms) |
| `WEBP_QUALITY` | `80` | Calidad WebP (0–100) |

## Autenticación

Todas las rutas de conversión requieren el header:

```
X-Convert-Token: <CONVERT_TOKEN>
```

- Comparación en tiempo constante (`timingSafeEqual`).
- `GET /health` queda **sin auth** (monitoring / load balancer).
- El servicio **no arranca** si `CONVERT_TOKEN` falta o tiene menos de 32 caracteres.

## API

### `GET /health`

Estado del servicio.

**Respuesta 200:**

```json
{
  "status": "ok",
  "browserReady": true,
  "activeJobs": 0,
  "concurrency": 3
}
```

### `POST /html-to-webp-miniature`

Renderiza HTML y devuelve una miniatura WebP.

**Body (JSON):**

```json
{
  "html": "<html><body><h1>Hola</h1></body></html>"
}
```

**Respuesta 200:** binario `image/webp`

**Errores:** JSON `{ "error": "...", "details": "..." }`

```bash
curl -X POST http://localhost:4004/html-to-webp-miniature \
  -H "Content-Type: application/json" \
  -H "X-Convert-Token: $CONVERT_TOKEN" \
  -d '{"html":"<html><body><h1>Hola</h1></body></html>"}' \
  --output miniature.webp
```

### `POST /html-to-png`

Renderiza HTML y devuelve una captura PNG. WhatsApp Cloud API acepta `image/png` o `image/jpeg`, no SVG.

**Body (JSON):**

```json
{
  "html": "<html><body><div>QR</div></body></html>",
  "width": 512,
  "height": 512
}
```

| Campo | Requerido | Valores |
|-------|-----------|---------|
| `html` | Sí | Documento HTML |
| `width` | No | Entero 64–2000 (default `512`) |
| `height` | No | Entero 64–2000 (default `512`) |

**Respuesta 200:** binario `image/png`

```bash
curl -X POST http://localhost:4004/html-to-png \
  -H "Content-Type: application/json" \
  -H "X-Convert-Token: $CONVERT_TOKEN" \
  -d '{"html":"<html><body style=\"margin:0;background:#fff\"><h1>QR</h1></body></html>","width":512,"height":512}' \
  --output qr.png
```

### `POST /html-to-pdf`

Renderiza HTML y devuelve un PDF (misma lógica de impresión que `/url-to-pdf`).

**Body (JSON):**

```json
{
  "html": "<!DOCTYPE html><html><body><h1>Informe</h1></body></html>",
  "format": "A4"
}
```

| Campo | Requerido | Valores |
|-------|-----------|---------|
| `html` | Sí | Documento HTML completo |
| `format` | No | `A4` (default), `letter`, `legal` |

**Respuesta 200:** binario `application/pdf`

```bash
curl -X POST http://localhost:4004/html-to-pdf \
  -H "Content-Type: application/json" \
  -H "X-Convert-Token: $CONVERT_TOKEN" \
  -d '{"html":"<!DOCTYPE html><html><body><h1>Informe</h1></body></html>","format":"A4"}' \
  --output document.pdf
```

### `POST /url-to-pdf`

Navega a una URL y genera un PDF.

**Body (JSON):**

```json
{
  "url": "https://example.com",
  "format": "A4"
}
```

| Campo | Requerido | Valores |
|-------|-----------|---------|
| `url` | Sí | `http://` o `https://` |
| `format` | No | `A4` (default), `letter`, `legal` |

**Respuesta 200:** binario `application/pdf`

```bash
curl -X POST http://localhost:4004/url-to-pdf \
  -H "Content-Type: application/json" \
  -H "X-Convert-Token: $CONVERT_TOKEN" \
  -d '{"url":"https://example.com","format":"A4"}' \
  --output document.pdf
```

## Integración recomendada (Next.js BFF)

No exponer este servicio directamente al navegador. El flujo debe ser:

```
Browser → Next.js /api/convert/* → api-convert:4004
              ↑ sesión usuario          ↑ X-Convert-Token (solo servidor)
```

### Responsabilidades por capa

| Capa | Qué debe hacer |
|------|----------------|
| **api-convert** | Token `X-Convert-Token`, conversión sync, límite de concurrencia |
| **Next.js (BFF)** | Validar sesión del usuario, validar inputs, reenviar binario al cliente |
| **nginx** (opcional) | Rate limit, timeouts largos, `client_max_body_size 2m` |
| **Cloudflare** | HTTPS, WAF; sin caché en POST |

### En Next.js (obligatorio en integración)

1. **Validar sesión** antes de proxyar (cookie httpOnly / Firebase session). Sin sesión → `401`.
2. **Nunca enviar `X-Convert-Token` al navegador** — solo en `fetch` server-side desde la API route.
3. **Validar inputs:**
   - `html`: string no vacío, tamaño máximo ~2 MB.
   - `url`: solo `http`/`https`; **bloquear SSRF** (rechazar `localhost`, `127.0.0.1`, `10.x`, `172.16–31.x`, `192.168.x`, metadata cloud `169.254.169.254`, etc.).
   - `format`: whitelist `A4` | `letter` | `legal`.
4. **Rate limit** por usuario o IP en la API route de Next (o en nginx delante del BFF), p. ej. 10–30 conversiones/minuto. El token evita acceso anónimo; el rate limit evita abuso por usuarios autenticados o token filtrado.

### Ejemplo de proxy en Next (esquema)

```typescript
// app/api/convert/pdf/route.ts
const CONVERT_URL = process.env.CONVERT_API_URL ?? 'http://127.0.0.1:4004';
const CONVERT_TOKEN = process.env.CONVERT_TOKEN!;

export async function POST(request: Request) {
  // 1. Validar sesión (cookie / Firebase Admin)
  // 2. Parsear y validar body (url, format, anti-SSRF)
  // 3. Proxy sync
  const upstream = await fetch(`${CONVERT_URL}/url-to-pdf`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Convert-Token': CONVERT_TOKEN,
    },
    body: JSON.stringify({ url, format }),
  });
  if (!upstream.ok) {
    const err = await upstream.json().catch(() => ({}));
    return Response.json(err, { status: upstream.status });
  }
  return new Response(upstream.body, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Cache-Control': 'no-store',
    },
  });
}
```

Variables en Next: `CONVERT_API_URL`, `CONVERT_TOKEN` (mismo valor que en api-convert).

### Despliegue de red

- Preferir `api-convert` escuchando en **`127.0.0.1`** (solo mismo host que Next).
- Si va detrás de nginx + Cloudflare, HTTPS en el borde; token como segunda barrera server-to-server.

## Arquitectura

- **Express** + **Puppeteer** (Chromium headless reutilizado)
- Cola in-process con límite de concurrencia
- Cierre graceful en `SIGINT` / `SIGTERM` (espera jobs activos y cierra el navegador)
- `kill_timeout: 15000` en PM2 para permitir el shutdown limpio

## Licencia

Privado / uso interno.
