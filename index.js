const express = require('express');
const puppeteer = require('puppeteer');
const cors = require('cors');
const sharp = require('sharp');

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(cors());

app.post('/html-to-png', async (req, res) => {
  const { html } = req.body;
  if (!html) {
    return res.status(400).json({ error: 'Falta el campo html en el body.' });
  }
  try {
    const browser = await puppeteer.launch({ headless: "new", args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const page = await browser.newPage();
    await page.setViewport({ width: 768, height: 1152 });
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const buffer = await page.screenshot({ type: 'png', fullPage: false });
    await browser.close();
    const resized = await sharp(buffer).resize(180, 270).webp().toBuffer();
    res.set('Content-Type', 'image/webp');
    res.send(resized);
  } catch (error) {
    res.status(500).json({ error: 'Error al generar la imagen', details: error.message });
  }
});

const PORT = process.env.PORT || 4004;
app.listen(PORT, () => {
  console.log(`API escuchando en puerto ${PORT}`);
}); 