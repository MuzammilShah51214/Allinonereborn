const express = require('express');
const puppeteer = require('puppeteer');

const app = express();
const PORT = process.env.PORT || 3000;
const TARGET_URL = 'https://suniliv.pages.dev/pworld?id=sony-pal';

let browserInstance = null;

async function getBrowser() {
  if (browserInstance && browserInstance.connected) {
    return browserInstance;
  }

  browserInstance = await puppeteer.launch({
    headless: 'new',
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
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'
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

    // Agar stream thori der baad load hoti hai to 6 seconds tak wait karein
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
  res.json({
    status: 'running',
    target: TARGET_URL,
    stream_endpoint: '/play.m3u8',
    info_endpoint: '/stream-info'
  });
});

app.get('/stream-info', async (req, res) => {
  try {
    const m3u8Url = await extractM3u8Url(TARGET_URL);
    if (!m3u8Url) {
      return res.status(404).json({ error: 'M3U8 stream nahi mila' });
    }
    res.json({ source: TARGET_URL, m3u8: m3u8Url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Direct M3U8 stream ke tour par open karne ke liye
app.get('/play.m3u8', async (req, res) => {
  try {
    const m3u8Url = await extractM3u8Url(TARGET_URL);
    if (!m3u8Url) {
      return res.status(404).send('M3U8 stream not found');
    }

    const upstream = await fetch(m3u8Url, {
      headers: {
        'Referer': TARGET_URL,
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'
      }
    });

    if (!upstream.ok) {
      return res.redirect(302, m3u8Url);
    }

    const body = await upstream.text();
    const baseUrl = new URL(m3u8Url);

    // Relative segment/playlist links ko full URLs mein convert karein taake player mein chal sakein
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
  console.log(`Server listening on port ${PORT}`);
});
