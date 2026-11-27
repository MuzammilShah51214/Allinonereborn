const express = require('express');
const fs = require('fs');
const { execSync } = require('child_process');
const puppeteer = require('puppeteer');

const app = express();
const PORT = process.env.PORT || 3000;
const PUBLIC_BASE_URL = process.env.PUBLIC_URL || 'https://allinonereborn-production.up.railway.app';
const DEFAULT_CHANNEL_ID = process.env.CHANNEL_ID || 'sony-pal';

function buildTargetUrl(channelId) {
  const cleanId = String(channelId || DEFAULT_CHANNEL_ID).trim();
  return `https://suniliv.pages.dev/pworld?id=${encodeURIComponent(cleanId)}`;
}

function findExecutablePath() {
  if (process.env.PUPPETEER_EXECUTABLE_PATH && fs.existsSync(process.env.PUPPETEER_EXECUTABLE_PATH)) {
    return process.env.PUPPETEER_EXECUTABLE_PATH;
  }

  const candidates = [
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable'
  ];

  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }

  try {
    const found = execSync('which chromium chromium-browser google-chrome 2>/dev/null || true')
      .toString()
      .trim()
      .split('\n')[0];
    if (found && fs.existsSync(found)) return found;
  } catch {}

  return null;
}

let browserInstance = null;

async function getBrowser() {
  if (browserInstance && browserInstance.connected) {
    return browserInstance;
  }

  const executablePath = findExecutablePath();

  browserInstance = await puppeteer.launch({
    headless: 'new',
    ...(executablePath ? { executablePath } : {}),
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-zygote',
      '--single-process',
      '--autoplay-policy=no-user-gesture-required'
    ]
  });

  return browserInstance;
}

async function extractM3u8Url(targetUrl) {
  const browser = await getBrowser();
  const page = await browser.newPage();

  let foundM3u8 = null;

  await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
  );

  await page.setRequestInterception(true);

  page.on('request', (req) => {
    const url = req.url();
    if (!foundM3u8 && url.includes('.m3u8')) {
      foundM3u8 = url;
    }

    const resourceType = req.resourceType();
    if (['image', 'font', 'stylesheet'].includes(resourceType)) {
      req.abort();
    } else {
      req.continue();
    }
  });

  page.on('response', (res) => {
    const url = res.url();
    if (!foundM3u8 && url.includes('.m3u8')) {
      foundM3u8 = url;
    }
  });

  try {
    await page.goto(targetUrl, {
      waitUntil: 'networkidle2',
      timeout: 30000
    });

    const startTime = Date.now();
    while (!foundM3u8 && Date.now() - startTime < 6000) {
      const domStream = await page.evaluate(() => {
        const video = document.querySelector('video');
        if (video && video.src && video.src.includes('.m3u8')) {
          return video.src;
        }
        const source = document.querySelector('video source[src*=".m3u8"]');
        return source ? source.src : null;
      });

      if (domStream) {
        foundM3u8 = domStream;
        break;
      }

      await new Promise((r) => setTimeout(r, 500));
    }

    return foundM3u8;
  } finally {
    await page.close();
  }
}

app.get('/', (req, res) => {
  const channelId = req.query.id || DEFAULT_CHANNEL_ID;
  res.json({
    status: 'running',
    base_url: PUBLIC_BASE_URL,
    channel_id: channelId,
    target: buildTargetUrl(channelId),
    m3u8_url: `${PUBLIC_BASE_URL}/play.m3u8?id=${encodeURIComponent(channelId)}`,
    info_url: `${PUBLIC_BASE_URL}/stream-info?id=${encodeURIComponent(channelId)}`
  });
});

app.get('/stream-info', async (req, res) => {
  const channelId = req.query.id || DEFAULT_CHANNEL_ID;
  const targetUrl = buildTargetUrl(channelId);
  try {
    const m3u8Url = await extractM3u8Url(targetUrl);
    if (!m3u8Url) {
      return res.status(404).json({ error: 'M3U8 stream nahi mila', channel_id: channelId, target: targetUrl });
    }
    res.json({
      base_url: PUBLIC_BASE_URL,
      channel_id: channelId,
      source: targetUrl,
      m3u8: m3u8Url,
      proxy_m3u8: `${PUBLIC_BASE_URL}/play.m3u8?id=${encodeURIComponent(channelId)}`
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/play.m3u8', async (req, res) => {
  const channelId = req.query.id || DEFAULT_CHANNEL_ID;
  const targetUrl = buildTargetUrl(channelId);
  try {
    const m3u8Url = await extractM3u8Url(targetUrl);
    if (!m3u8Url) {
      return res.status(404).send('M3U8 stream not found');
    }

    const upstream = await fetch(m3u8Url, {
      headers: {
        'Referer': targetUrl,
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
      }
    });

    if (!upstream.ok) {
      return res.redirect(302, m3u8Url);
    }

    const body = await upstream.text();
    const baseUrl = new URL(m3u8Url);

    const rewrittenPlaylist = body
      .split('\n')
      .map((line) => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) return line;
        try {
          return new URL(trimmed, baseUrl).toString();
        } catch {
          return line;
        }
      })
      .join('\n');

    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.send(rewrittenPlaylist);
  } catch (err) {
    res.status(500).send(`Error: ${err.message}`);
  }
});

app.listen(PORT, () => {
  console.log(`Server running at ${PUBLIC_BASE_URL} on port ${PORT} (default channel: ${DEFAULT_CHANNEL_ID})`);
});
