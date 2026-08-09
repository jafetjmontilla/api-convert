require('dotenv').config();

const crypto = require('crypto');
const express = require('express');
const puppeteer = require('puppeteer');
const cors = require('cors');

const PORT = Number(process.env.PORT ?? 4004);
const CONVERT_TOKEN = process.env.CONVERT_TOKEN ?? '';
const NAVIGATION_TIMEOUT_MS = Number(process.env.NAVIGATION_TIMEOUT_MS ?? 30_000);
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 3);
const MINIATURE_WIDTH = 180;
const MINIATURE_HEIGHT = 270;
const WEBP_QUALITY = Number(process.env.WEBP_QUALITY ?? 80);

const VALID_PDF_FORMATS = ['letter', 'A4', 'legal'];
const BLOCKED_MINIATURE_RESOURCE_TYPES = new Set([
  'media',
  'websocket',
  'manifest',
  'eventsource',
  'ping',
]);

const app = express();
app.use(express.json({ limit: '15mb' }));
app.use(cors());

let browser = null;
let browserInitPromise = null;
let isShuttingDown = false;

let activeJobs = 0;
const waitQueue = [];

function acquireSlot() {
  return new Promise((resolve, reject) => {
    if (isShuttingDown) {
      reject(new Error('Servicio en cierre'));
      return;
    }
    if (activeJobs < CONCURRENCY) {
      activeJobs += 1;
      resolve();
      return;
    }
    waitQueue.push({ resolve, reject });
  });
}

function releaseSlot() {
  activeJobs -= 1;
  const next = waitQueue.shift();
  if (next) {
    activeJobs += 1;
    next.resolve();
  }
}

async function withConcurrency(fn) {
  await acquireSlot();
  try {
    return await fn();
  } finally {
    releaseSlot();
  }
}

async function getBrowser() {
  if (browser?.connected) {
    return browser;
  }

  if (!browserInitPromise) {
    browserInitPromise = puppeteer
      .launch({
        headless: 'new',
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--disable-extensions',
          '--no-first-run',
          '--disable-background-networking',
          '--disable-sync',
        ],
      })
      .then((instance) => {
        browser = instance;
        browser.on('disconnected', () => {
          browser = null;
          browserInitPromise = null;
        });
        console.log('Navegador inicializado');
        return instance;
      })
      .catch((error) => {
        browserInitPromise = null;
        throw error;
      });
  }

  return browserInitPromise;
}

async function withPage(setupPage, work) {
  const browserInstance = await getBrowser();
  const page = await browserInstance.newPage();

  try {
    await page.setDefaultNavigationTimeout(NAVIGATION_TIMEOUT_MS);
    await page.setDefaultTimeout(NAVIGATION_TIMEOUT_MS);
    await setupPage(page);
    return await work(page);
  } finally {
    await page.close().catch(() => {});
  }
}

async function setupMiniaturePage(page) {
  await page.setViewport({
    width: MINIATURE_WIDTH,
    height: MINIATURE_HEIGHT,
    deviceScaleFactor: 1,
  });

  await page.setRequestInterception(true);
  page.on('request', (request) => {
    if (BLOCKED_MINIATURE_RESOURCE_TYPES.has(request.resourceType())) {
      request.abort();
      return;
    }
    request.continue();
  });
}

async function setupPdfPage(page) {
  await page.setViewport({
    width: 1200,
    height: 800,
    deviceScaleFactor: 1,
  });
}

function buildPdfOptions(format) {
  return {
    format,
    printBackground: true,
    margin: {
      top: '0.5in',
      right: '0.5in',
      bottom: '0.5in',
      left: '0.5in',
    },
    preferCSSPageSize: true,
  };
}

async function renderPdfFromPage(page, format) {
  return page.pdf(buildPdfOptions(format));
}

function sendError(res, status, message, details) {
  res.status(status).json({
    error: message,
    ...(details ? { details } : {}),
  });
}

function validateConvertToken(req, res, next) {
  const token = req.headers['x-convert-token'];

  if (!token || typeof token !== 'string') {
    return sendError(res, 401, 'Token de autenticación inválido');
  }

  const tokenBuffer = Buffer.from(token);
  const expectedBuffer = Buffer.from(CONVERT_TOKEN);

  if (
    tokenBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(tokenBuffer, expectedBuffer)
  ) {
    return sendError(res, 401, 'Token de autenticación inválido');
  }

  next();
}

if (!CONVERT_TOKEN || CONVERT_TOKEN.length < 32) {
  console.error('CONVERT_TOKEN debe estar definido y tener al menos 32 caracteres');
  process.exit(1);
}

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    browserReady: Boolean(browser?.connected),
    activeJobs,
    concurrency: CONCURRENCY,
  });
});

app.use('/html-to-webp-miniature', validateConvertToken);
app.use('/html-to-pdf', validateConvertToken);
app.use('/url-to-pdf', validateConvertToken);

app.post('/html-to-webp-miniature', async (req, res) => {
  const { html } = req.body;
  if (!html || typeof html !== 'string') {
    return sendError(res, 400, 'Falta el campo html en el body.');
  }

  try {
    const buffer = await withConcurrency(() =>
      withPage(setupMiniaturePage, async (page) => {
        await page.setContent(html, { waitUntil: 'domcontentloaded' });
        return page.screenshot({
          type: 'webp',
          quality: WEBP_QUALITY,
          fullPage: false,
        });
      }),
    );

    res.set({
      'Content-Type': 'image/webp',
      'Content-Length': String(buffer.length),
      'Cache-Control': 'no-store',
    });
    res.send(buffer);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error desconocido';
    sendError(res, 500, 'Error al generar la imagen', message);
  }
});

app.post('/html-to-pdf', async (req, res) => {
  const { html, format = 'A4' } = req.body;

  if (!html || typeof html !== 'string') {
    return sendError(res, 400, 'Falta el campo html en el body.');
  }

  if (!VALID_PDF_FORMATS.includes(format)) {
    return sendError(res, 400, 'Formato no válido. Use: letter, A4, u legal.');
  }

  try {
    const buffer = await withConcurrency(() =>
      withPage(setupPdfPage, async (page) => {
        await page.setContent(html, { waitUntil: "networkidle0" });
        // Esperar tipografías (Google Fonts / @font-face) antes de imprimir.
        await page.evaluate(async () => {
          if (document.fonts?.ready) {
            await document.fonts.ready;
          }
        });
        // Pequeña holgura por si el CSS de fuentes llega tarde.
        await new Promise((resolve) => setTimeout(resolve, 300));
        return renderPdfFromPage(page, format);
      }),
    );

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Length': String(buffer.length),
      'Cache-Control': 'no-store',
    });
    res.send(buffer);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error desconocido';
    sendError(res, 500, 'Error al generar el PDF', message);
  }
});

app.post('/url-to-pdf', async (req, res) => {
  const { url, format = 'A4' } = req.body;

  if (!url || typeof url !== 'string') {
    return sendError(res, 400, 'Falta el campo url en el body.');
  }

  if (!VALID_PDF_FORMATS.includes(format)) {
    return sendError(res, 400, 'Formato no válido. Use: letter, A4, u legal.');
  }

  try {
    const parsedUrl = new URL(url);
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      return sendError(res, 400, 'La url debe usar http o https.');
    }
  } catch {
    return sendError(res, 400, 'La url no es válida.');
  }

  try {
    const buffer = await withConcurrency(() =>
      withPage(setupPdfPage, async (page) => {
        await page.goto(url, { waitUntil: 'networkidle2' });
        return renderPdfFromPage(page, format);
      }),
    );

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Length': String(buffer.length),
      'Cache-Control': 'no-store',
    });
    res.send(buffer);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error desconocido';
    sendError(res, 500, 'Error al generar el PDF', message);
  }
});

const server = app.listen(PORT, () => {
  getBrowser().catch((error) => {
    console.error('Error al inicializar el navegador:', error.message);
  });
  console.log(`API escuchando en puerto ${PORT} (concurrencia: ${CONCURRENCY})`);
});

async function shutdown(signal) {
  if (isShuttingDown) {
    return;
  }
  isShuttingDown = true;

  console.log(`Cerrando aplicación (${signal})...`);

  while (waitQueue.length > 0) {
    const pending = waitQueue.shift();
    pending?.reject(new Error('Servicio en cierre'));
  }

  server.close(() => {
    console.log('Servidor HTTP cerrado');
  });

  while (activeJobs > 0) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  if (browser) {
    await browser.close().catch(() => {});
    browser = null;
    browserInitPromise = null;
    console.log('Navegador cerrado');
  }

  process.exit(0);
}

process.on('SIGINT', () => {
  shutdown('SIGINT').catch(console.error);
});

process.on('SIGTERM', () => {
  shutdown('SIGTERM').catch(console.error);
});
