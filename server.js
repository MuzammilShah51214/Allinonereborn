const express = require('express');
const cors = require('cors');
const axios = require('axios');
const fs = require('fs');
const { execSync } = require('child_process');
const puppeteer = require('puppeteer');

const app = express();
app.use(cors());

const PORT = process.env.PORT || 3000;

// 🔐 SECURITY KEY
const SECRET_KEY = 'MUZAMMIL2026ARY';

const CHANNELS = {
    'k7x9p2m': { name: 'ARY News',    type: 'ary',     url: 'https://live.arynews.tv/',                        referer: 'https://live.arynews.tv/' },
    'q3n8z1v': { name: 'ARY News 2',  type: 'ary',     url: 'https://live.arynews.tv/',                        referer: 'https://live.arynews.tv/' },
    'w5r2y9t': { name: 'ARY Musik',   type: 'ary',     url: 'https://live.arymusik.tv/',                       referer: 'https://live.arymusik.tv/' },
    'a8f4h6j': { name: 'ARY Digital', type: 'ary',     url: 'https://live.arydigital.tv/',                     referer: 'https://live.arydigital.tv/' },
    'b2c7d9e': { name: 'ARY Zindagi', type: 'ary',     url: 'https://live.aryzindagi.tv/',                     referer: 'https://live.aryzindagi.tv/' },
    'm4k8n2p': { name: 'ARY Qtv',     type: 'ary',     url: 'https://live.aryqtv.tv/',                         referer: 'https://live.aryqtv.tv/' },
    's9p4x7w': { name: 'Sony Pal',    type: 'suniliv', channelId: 'sony-pal', jsonUrl: 'https://suniliv.pages.dev/sliv3.json', referer: 'https://suniliv.pages.dev/' }
};

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
    } catch (e) {}

    return null;
}

async function fetchSunilivStream(channel) {
    try {
        console.log(`📄 Fetching ${channel.jsonUrl} for ${channel.channelId}...`);
        const res = await axios.get(channel.jsonUrl, {
            headers: {
                'Referer': channel.referer,
                'Origin': 'https://suniliv.pages.dev',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'
            },
            timeout: 20000
        });

        const item = res.data && res.data[channel.channelId];
        if (item && item.m3u8) {
            console.log(`✅ Found m3u8 in sliv3.json for ${channel.channelId}`);
            return {
                url: item.m3u8,
                referer: channel.referer,
                proxyFallbackUrl: `https://allinonereborn2.online/livtest3/stream_proxy.php?url=${encodeURIComponent(item.m3u8)}`
            };
        }
    } catch (err) {
        console.warn(`⚠️ sliv3.json fetch failed: ${err.message}`);
    }
    return null;
}

async function fetchFreshUrl(channelKey) {
    const channel = CHANNELS[channelKey];
    if (!channel) return null;

    if (channel.type === 'suniliv') {
        const directFromJson = await fetchSunilivStream(channel);
        if (directFromJson) return directFromJson;
    }

    console.log(`🔍 Fetching fresh URL for ${channel.name}...`);

    let browser;
    try {
        const executablePath = findExecutablePath();

        browser = await puppeteer.launch({
            headless: 'new',
            ...(executablePath ? { executablePath } : {}),
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--single-process',
                '--disable-web-security',
                '--autoplay-policy=no-user-gesture-required'
            ]
        });

        const page = await browser.newPage();
        await page.setUserAgent(
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'
        );

        let m3u8Url = null;
        let allUrls = [];

        const captureM3u8 = (url) => {
            if (!url || url.includes('stream_proxy.php')) return;
            if (url.includes('.m3u8')) {
                allUrls.push(url);
                if (!m3u8Url) {
                    m3u8Url = url;
                }
                if (
                    url.includes('main.m3u8') ||
                    url.includes('playlist.m3u8') ||
                    url.includes('master.m3u8') ||
                    url.includes('index.m3u8')
                ) {
                    m3u8Url = url;
                }
            }
        };

        page.on('request', (req) => captureM3u8(req.url()));
        page.on('response', (res) => captureM3u8(res.url()));
        page.on('frameattached', (frame) => {
            frame.on('request', (req) => captureM3u8(req.url()));
            frame.on('response', (res) => captureM3u8(res.url()));
        });

        console.log(`🌐 Opening ${channel.url}...`);
        await page.goto(channel.url, {
            waitUntil: 'domcontentloaded',
            timeout: 30000
        });

        await new Promise((r) => setTimeout(r, 2000));

        try {
            await page.evaluate(() => {
                window.scrollTo(0, document.body.scrollHeight / 2);
            });
        } catch (e) {}

        const triggerPlayInAllFrames = async () => {
            for (const frame of page.frames()) {
                try {
                    await frame.evaluate(() => {
                        document.querySelectorAll('video').forEach((v) => {
                            v.muted = true;
                            v.play().catch(() => {});
                        });

                        const buttons = document.querySelectorAll('button, [role="button"], .play, .play-button, [class*="play"]');
                        buttons.forEach((b) => {
                            try {
                                const text = (b.textContent || '').toLowerCase();
                                if (text.includes('play') || text === '') {
                                    b.click();
                                }
                            } catch (e) {}
                        });
                    });
                } catch (e) {}
            }
        };

        await triggerPlayInAllFrames();

        console.log(`⏳ Waiting up to 25s for m3u8 URL...`);
        for (let i = 0; i < 25; i++) {
            await new Promise((r) => setTimeout(r, 1000));
            if (m3u8Url) break;

            if (i % 5 === 4) {
                await triggerPlayInAllFrames();
            }
        }

        if (m3u8Url) {
            console.log(`✅ Got URL: ${m3u8Url.substring(0, 100)}...`);
            return { url: m3u8Url, referer: channel.referer };
        }

        console.log(`❌ No m3u8 URL for ${channel.name}`);
        console.log(`   URLs captured: ${allUrls.length}`);
        return null;
    } catch (err) {
        console.error(`❌ Error: ${err.message}`);
        return null;
    } finally {
        if (browser) await browser.close();
    }
}

async function fetchPlaylistWithFallback(streamObj, channel) {
    const headersList = [
        {
            'Referer': channel.referer,
            'Origin': new URL(channel.referer).origin,
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
            'Accept': '*/*'
        },
        {
            'Referer': 'https://allinonereborn2.online/',
            'Origin': 'https://allinonereborn2.online',
            'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
            'Accept': '*/*'
        }
    ];

    for (const headers of headersList) {
        try {
            const res = await axios.get(streamObj.url, {
                headers,
                responseType: 'arraybuffer',
                timeout: 30000,
                maxRedirects: 5
            });
            return { response: res, sourceUrl: streamObj.url, referer: headers.Referer };
        } catch (err) {
            if (err.response && err.response.status === 403) {
                continue;
            }
            throw err;
        }
    }

    if (streamObj.proxyFallbackUrl) {
        const res = await axios.get(streamObj.proxyFallbackUrl, {
            headers: {
                'Referer': 'https://suniliv.pages.dev/',
                'Origin': 'https://suniliv.pages.dev',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
                'Accept': '*/*'
            },
            responseType: 'arraybuffer',
            timeout: 30000,
            maxRedirects: 5
        });
        return { response: res, sourceUrl: streamObj.url, referer: 'https://suniliv.pages.dev/' };
    }

    throw new Error('Request failed with status code 403');
}

app.get('/', (req, res) => {
    res.json({ status: 'ok', message: 'ARY Proxy running' });
});

app.get('/:code', async (req, res, next) => {
    const code = req.params.code.replace(/\.m3u8$/i, '');
    const channel = CHANNELS[code];

    if (!channel) return next();

    const providedKey = req.query.key;
    if (!providedKey || providedKey !== SECRET_KEY) {
        return res.status(403).json({ error: 'Forbidden' });
    }

    console.log(`✅ Request: ${channel.name}`);
    const streamObj = await fetchFreshUrl(code);

    if (!streamObj || !streamObj.url) {
        return res.status(503).json({
            error: 'Stream unavailable',
            channel: channel.name
        });
    }

    try {
        const { response, sourceUrl, referer } = await fetchPlaylistWithFallback(streamObj, channel);

        const contentType = response.headers['content-type'] || 'application/vnd.apple.mpegurl';
        res.set('Content-Type', contentType);
        res.set('Access-Control-Allow-Origin', '*');

        let text = Buffer.from(response.data).toString('utf-8');
        const baseUrl = sourceUrl.substring(0, sourceUrl.lastIndexOf('/') + 1);
        const proxyBase = `https://${req.get('host')}/proxy`;

        text = text.split('\n').map((line) => {
            const trimmed = line.trim();
            if (trimmed && !trimmed.startsWith('#')) {
                const fullUrl = trimmed.startsWith('http') ? trimmed : baseUrl + trimmed;
                return `${proxyBase}?url=${encodeURIComponent(fullUrl)}&referer=${encodeURIComponent(referer)}&key=${SECRET_KEY}`;
            }
            return line.replace(/URI="([^"]+)"/g, (match, uri) => {
                const fullUrl = uri.startsWith('http') ? uri : baseUrl + uri;
                return `URI="${proxyBase}?url=${encodeURIComponent(fullUrl)}&referer=${encodeURIComponent(referer)}&key=${SECRET_KEY}"`;
            });
        }).join('\n');

        res.send(text);
    } catch (err) {
        console.error(`❌ Proxy error: ${err.message}`);
        res.status(500).json({ error: err.message });
    }
});

app.get('/proxy', async (req, res) => {
    const providedKey = req.query.key;
    if (providedKey && providedKey !== SECRET_KEY) {
        return res.status(403).json({ error: 'Forbidden' });
    }

    const targetUrl = req.query.url;
    const referer = req.query.referer || 'https://suniliv.pages.dev/';

    if (!targetUrl) return res.status(400).json({ error: 'url required' });

    try {
        const response = await axios.get(targetUrl, {
            headers: {
                'Referer': referer,
                'Origin': new URL(referer).origin,
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': '*/*'
            },
            responseType: 'arraybuffer',
            timeout: 30000,
            maxRedirects: 5
        });

        const contentType = response.headers['content-type'] || 'application/octet-stream';
        res.set('Content-Type', contentType);
        res.set('Access-Control-Allow-Origin', '*');

        let data = response.data;

        if (targetUrl.includes('.m3u8') || contentType.includes('mpegurl')) {
            let text = Buffer.from(data).toString('utf-8');
            const baseUrl = targetUrl.substring(0, targetUrl.lastIndexOf('/') + 1);
            const proxyBase = `https://${req.get('host')}/proxy`;

            text = text.split('\n').map((line) => {
                const trimmed = line.trim();
                if (trimmed && !trimmed.startsWith('#')) {
                    const fullUrl = trimmed.startsWith('http') ? trimmed : baseUrl + trimmed;
                    return `${proxyBase}?url=${encodeURIComponent(fullUrl)}&referer=${encodeURIComponent(referer)}&key=${SECRET_KEY}`;
                }
                return line.replace(/URI="([^"]+)"/g, (match, uri) => {
                    const fullUrl = uri.startsWith('http') ? uri : baseUrl + uri;
                    return `URI="${proxyBase}?url=${encodeURIComponent(fullUrl)}&referer=${encodeURIComponent(referer)}&key=${SECRET_KEY}"`;
                });
            }).join('\n');

            return res.send(text);
        }

        res.send(data);
    } catch (err) {
        console.error('Proxy error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

app.listen(PORT, () => {
    console.log(`✅ ARY Proxy on port ${PORT}`);
    console.log(`🔐 Key: ${SECRET_KEY}`);
    console.log(`🔒 HTTPS enforced`);
});
