const express = require('express');
const puppeteer = require('puppeteer');
const cors = require('cors');
const sharp = require('sharp');

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(cors());

// Variable global para mantener la instancia del navegador
let browser = null;

// Función para inicializar el navegador
async function initializeBrowser() {
  if (!browser) {
    browser = await puppeteer.launch({
      headless: "new",
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    console.log('Navegador inicializado');
  }
  return browser;
}

// Inicializar el navegador al arrancar la aplicación
initializeBrowser().catch(console.error);

app.post('/html-to-webp-miniature', async (req, res) => {
  const { html } = req.body;
  if (!html) {
    return res.status(400).json({ error: 'Falta el campo html en el body.' });
  }
  try {
    const browserInstance = await initializeBrowser();
    const page = await browserInstance.newPage();
    await page.setViewport({ width: 768, height: 1152 });
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const buffer = await page.screenshot({ type: 'png', fullPage: false });
    await page.close();
    const resized = await sharp(buffer).resize(180, 270).webp().toBuffer();
    res.set('Content-Type', 'image/webp');
    res.send(resized);
  } catch (error) {
    res.status(500).json({ error: 'Error al generar la imagen', details: error.message });
  }
});

app.post('/url-to-pdf', async (req, res) => {
  const { url, format = 'A4' } = req.body;
  console.log(url, format)
  if (!url) {
    return res.status(400).json({ error: 'Falta el campo url en el body.' });
  }
  // Validar formato
  const validFormats = ['letter', 'A4', 'legal'];
  if (!validFormats.includes(format)) {
    return res.status(400).json({ error: 'Formato no válido. Use: letter, A4, u legal.' });
  }
  try {
    const browserInstance = await initializeBrowser();
    const page = await browserInstance.newPage();
    // Configurar viewport para mejor renderizado de PDF
    await page.setViewport({ width: 1200, height: 800 });
    await page.goto(url, { waitUntil: 'networkidle0' });
    // Configuraciones adicionales para PDF con múltiples páginas
    const pdfOptions = {
      format: format,
      printBackground: true,
      margin: {
        top: '0.5in',
        right: '0.5in',
        bottom: '0.5in',
        left: '0.5in'
      },
      preferCSSPageSize: true
    };
    const buffer = await page.pdf(pdfOptions);
    await page.close();
    res.set('Content-Type', 'application/pdf');
    res.send(buffer);
  } catch (error) {
    res.status(500).json({ error: 'Error al generar el PDF', details: error.message });
  }
});

const PORT = process.env.PORT || 4004;
const server = app.listen(PORT, () => {
  console.log(`API escuchando en puerto ${PORT}`);
});

// Manejar el cierre graceful de la aplicación
process.on('SIGINT', async () => {
  console.log('Cerrando aplicación...');
  if (browser) {
    await browser.close();
    console.log('Navegador cerrado');
  }
  server.close(() => {
    console.log('Servidor cerrado');
    process.exit(0);
  });
});

process.on('SIGTERM', async () => {
  console.log('Cerrando aplicación...');
  if (browser) {
    await browser.close();
    console.log('Navegador cerrado');
  }
  server.close(() => {
    console.log('Servidor cerrado');
    process.exit(0);
  });
}); 