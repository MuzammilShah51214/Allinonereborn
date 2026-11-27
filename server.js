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

// ⚡ URL Cache (8 minutes)
const CACHE_TTL_MS = 8 * 60 * 1000;
const streamCache = new Map();

const CHANNELS = {
    'k7x9p2m': { name: 'ARY News',     type: 'ary',     url: 'https://live.arynews.tv/',                                       referer: 'https://live.arynews.tv/' },
    'q3n8z1v': { name: 'ARY News 2',   type: 'ary',     url: 'https://live.arynews.tv/',                                       referer: 'https://live.arynews.tv/' },
    'w5r2y9t': { name: 'ARY Musik',    type: 'ary',     url: 'https://live.arymusik.tv/',                                      referer: 'https://live.arymusik.tv/' },
    'a8f4h6j': { name: 'ARY Digital',  type: 'ary',     url: 'https://live.arydigital.tv/',                                    referer: 'https://live.arydigital.tv/' },
    'b2c7d9e': { name: 'ARY Zindagi',  type: 'ary',     url: 'https://live.aryzindagi.tv/',                                    referer: 'https://live.aryzindagi.tv/' },
    'm4k8n2p': { name: 'ARY Qtv',      type: 'ary',     url: 'https://live.aryqtv.tv/',                                        referer: 'https://live.aryqtv.tv/' },
    's9p4x7w': { name: 'Sony Pal',     type: 'suniliv', channelId: 'sony-pal', jsonUrl: 'https://suniliv.pages.dev/sliv3.json',  referer: 'https://suniliv.pages.dev/' },
    'h4s8t2m': { name: 'Hum Sitaray',  type: 'tamasha', slug: 'hum-sitaray-live', url: 'https://tamashaweb.com/live-tv?channel=hum-sitaray-live', referer: 'https://tamashaweb.com/' },
    'm7v2c9x': { name: 'MunTV',        type: 'myco',    videoId: '683074438dfcfbbcde5c20d6', url: 'https://myco.io/videohome/683074438dfcfbbcde5c20d6', referer: 'https://myco.io/' }
};

function getCachedStream(channelKey) {
    const entry = streamCache.get(channelKey);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
        streamCache.delete(channelKey);
        return null;
    }
    return entry.data;
}

function setCachedStream(channelKey, data) {
    if (!data || !data.url) return;
    streamCache.set(channelKey, {
        data,
        expiresAt: Date.now() + CACHE_TTL_MS
    });
}

function clearCachedStream(channelKey) {
    streamCache.delete(channelKey);
}

function getBaseProxyUrl(req) {
    const proto = req.headers['x-forwarded-proto'] || req.protocol || 'https';
    return `${proto}://${req.get('host')}/proxy`;
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

function scoreStreamUrl(url, channel, clickedTargetChannel = false) {
    const lower = url.toLowerCase();
    let score = 0;

    if (channel.type === 'tamasha') {
        if (lower.includes('hum-sitaray') || lower.includes('humsitaray') || lower.includes('sitaray')) {
            score += 100;
        }
        if (lower.includes('hum') && lower.includes('live')) {
            score += 40;
        }
        if (clickedTargetChannel) {
            score += 25;
        }
    }

    if (channel.type === 'myco') {
        if (channel.videoId && lower.includes(channel.videoId.toLowerCase())) {
            score += 100;
        }
        if (lower.includes('muntv') || lower.includes('mun-tv') || lower.includes('mun')) {
            score += 60;
        }
        if (lower.includes('myco')) {
            score += 25;
        }
    }

    if (
        lower.includes('main.m3u8') ||
        lower.includes('playlist.m3u8') ||
        lower.includes('master.m3u8') ||
        lower.includes('index.m3u8')
    ) {
        score += 15;
    }

    return score;
}

async function selectTamashaChannel(page) {
    try {
        return await page.evaluate(() => {
            const targets = ['hum-sitaray-live', 'hum-sitaray', 'hum sitaray', 'sitaray'];

            const links = Array.from(document.querySelectorAll('a[href]'));
            for (const a of links) {
                const href = (a.getAttribute('href') || '').toLowerCase();
                const text = (a.innerText || a.textContent || '').toLowerCase();
                if (targets.some((t) => href.includes(t) || text.includes(t))) {
                    a.scrollIntoView({ block: 'center' });
                    a.click();
                    return true;
                }
            }

            const clickables = Array.from(document.querySelectorAll('button, [role="button"], div, span, li, p'));
            for (const el of clickables) {
                const text = (el.innerText || el.textContent || '').trim().toLowerCase();
                if (text.length > 0 && text.length < 80 && targets.some((t) => text.includes(t))) {
                    el.scrollIntoView({ block: 'center' });
                    el.click();
                    return true;
                }
            }

            return false;
        });
    } catch (e) {
        return false;
    }
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

        let bestM3u8Url = null;
        let bestScore = -1;
        let m3u8Referer = channel.referer;
        let allUrls = [];
        let clickedTargetChannel = false;

        const captureM3u8 = (url, headers = {}) => {
            if (!url || url.includes('stream_proxy.php')) return;
            if (url.includes('.m3u8') || url.includes('m3u8')) {
                allUrls.push(url);
                const reqReferer = headers['referer'] || headers['Referer'] || channel.referer;
                const score = scoreStreamUrl(url, channel, clickedTargetChannel);

                if (score >= bestScore) {
                    bestScore = score;
                    bestM3u8Url = url;
                    m3u8Referer = reqReferer;
                }
            }
        };

        page.on('request', (req) => captureM3u8(req.url(), req.headers()));
        page.on('response', (res) => captureM3u8(res.url(), res.request().headers()));
        page.on('frameattached', (frame) => {
            frame.on('request', (req) => captureM3u8(req.url(), req.headers()));
            frame.on('response', (res) => captureM3u8(res.url(), res.request().headers()));
        });

        console.log(`🌐 Opening ${channel.url}...`);
        await page.goto(channel.url, {
            waitUntil: 'domcontentloaded',
            timeout: 25000
        });

        await new Promise((r) => setTimeout(r, 3000));

        if (channel.type === 'tamasha') {
            clickedTargetChannel = await selectTamashaChannel(page);
            if (clickedTargetChannel) {
                console.log(`🎯 Clicked Hum Sitaray element on Tamasha`);
                await new Promise((r) => setTimeout(r, 1500));
            }
        }

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

        const findStreamInFrames = async () => {
            for (const frame of page.frames()) {
                try {
                    const found = await frame.evaluate(() => {
                        const video = document.querySelector('video');
                        if (video && (video.currentSrc || video.src)) {
                            const src = video.currentSrc || video.src;
                            if (src.includes('.m3u8')) return src;
                        }
                        const source = document.querySelector('video source[src]');
                        if (source && source.src && source.src.includes('.m3u8')) {
                            return source.src;
                        }
                        return null;
                    });
                    if (found && found.includes('.m3u8')) {
                        captureM3u8(found);
                    }
                } catch (e) {}
            }
        };

        await triggerPlayInAllFrames();

        console.log(`⏳ Waiting up to 22s for m3u8 URL...`);
        let foundAtSecond = null;

        for (let i = 0; i < 22; i++) {
            await new Promise((r) => setTimeout(r, 1000));
            await findStreamInFrames();

            if (channel.type === 'tamasha' && !clickedTargetChannel && i === 4) {
                clickedTargetChannel = await selectTamashaChannel(page);
            }

            if (bestM3u8Url && foundAtSecond === null) {
                foundAtSecond = i;
            }

            if (bestM3u8Url) {
                if (channel.type === 'tamasha' && bestScore < 100 && (i - foundAtSecond) < 8) {
                    continue;
                }
                break;
            }

            if (i % 4 === 3) {
                await triggerPlayInAllFrames();
            }
        }

        if (bestM3u8Url) {
            console.log(`✅ Got URL for ${channel.name} (score ${bestScore}): ${bestM3u8Url.substring(0, 120)}...`);
            return { url: bestM3u8Url, referer: m3u8Referer || channel.referer };
        }

        console.log(`❌ No m3u8 URL for ${channel.name}. Captured: ${allUrls.length}`);
        return null;
    } catch (err) {
        console.error(`❌ Error for ${channel.name}: ${err.message}`);
        return null;
    } finally {
        if (browser) await browser.close();
    }
}

async function getStreamWithCache(channelKey, forceRefresh = false) {
    if (!forceRefresh) {
        const cached = getCachedStream(channelKey);
        if (cached) {
            console.log(`⚡ Cache hit for ${CHANNELS[channelKey].name}`);
            return cached;
        }
    }

    const fresh = await fetchFreshUrl(channelKey);
    if (fresh && fresh.url) {
        setCachedStream(channelKey, fresh);
    }
    return fresh;
}

async function fetchPlaylistWithFallback(streamObj, channel) {
    const primaryReferer = streamObj.referer || channel.referer;
    const headersList = [
        {
            'Referer': primaryReferer,
            'Origin': new URL(primaryReferer).origin,
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
            'Accept': '*/*'
        },
        {
            'Referer': channel.referer,
            'Origin': new URL(channel.referer).origin,
            'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
            'Accept': '*/*'
        }
    ];

    for (const headers of headersList) {
        try {
            const res = await axios.get(streamObj.url, {
                headers,
                responseType: 'arraybuffer',
                timeout: 25000,
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
            timeout: 25000,
            maxRedirects: 5
        });
        return { response: res, sourceUrl: streamObj.url, referer: 'https://suniliv.pages.dev/' };
    }

    throw new Error('Request failed with status code 403');
}

app.get('/', (req, res) => {
    res.json({ status: 'ok', message: 'ARY Proxy running', cacheTtlSec: CACHE_TTL_MS / 1000 });
});

app.get('/:code', async (req, res, next) => {
    const code = req.params.code.replace(/\.m3u8$/i, '');
    const channel = CHANNELS[code];

    if (!channel) return next();

    const providedKey = req.query.key;
    if (!providedKey || providedKey !== SECRET_KEY) {
        return res.status(403).json({ error: 'Forbidden' });
    }

    const forceRefresh = req.query.refresh === '1';
    console.log(`✅ Request: ${channel.name}${forceRefresh ? ' (force refresh)' : ''}`);

    let streamObj = await getStreamWithCache(code, forceRefresh);

    if (!streamObj || !streamObj.url) {
        return res.status(503).json({
            error: 'Stream unavailable',
            channel: channel.name
        });
    }

    try {
        let fetched;
        try {
            fetched = await fetchPlaylistWithFallback(streamObj, channel);
        } catch (firstErr) {
            if (!forceRefresh) {
                console.warn(`⚠️ Cached stream failed (${firstErr.message}), refreshing...`);
                clearCachedStream(code);
                streamObj = await getStreamWithCache(code, true);
                if (!streamObj || !streamObj.url) throw firstErr;
                fetched = await fetchPlaylistWithFallback(streamObj, channel);
            } else {
                throw firstErr;
            }
        }

        const { response, sourceUrl, referer } = fetched;

        const contentType = response.headers['content-type'] || 'application/vnd.apple.mpegurl';
        res.set('Content-Type', contentType);
        res.set('Access-Control-Allow-Origin', '*');

        let text = Buffer.from(response.data).toString('utf-8');
        const baseUrl = sourceUrl.substring(0, sourceUrl.lastIndexOf('/') + 1);
        const proxyBase = getBaseProxyUrl(req);

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
        clearCachedStream(code);
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
    const referer = req.query.referer || 'https://myco.io/';

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
            timeout: 25000,
            maxRedirects: 5
        });

        const contentType = response.headers['content-type'] || 'application/octet-stream';
        res.set('Content-Type', contentType);
        res.set('Access-Control-Allow-Origin', '*');

        let data = response.data;

        if (targetUrl.includes('.m3u8') || contentType.includes('mpegurl')) {
            let text = Buffer.from(data).toString('utf-8');
            const baseUrl = targetUrl.substring(0, targetUrl.lastIndexOf('/') + 1);
            const proxyBase = getBaseProxyUrl(req);

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
        const status = err.response && err.response.status ? err.response.status : 500;
        console.error(`❌ Proxy error (${status}) for ${targetUrl}: ${err.message}`);
        res.status(status).json({ error: err.message, status });
    }
});

app.listen(PORT, () => {
    console.log(`✅ ARY Proxy on port ${PORT}`);
    console.log(`🔐 Key: ${SECRET_KEY}`);
    console.log(`🔒 HTTPS enforced`);
});
