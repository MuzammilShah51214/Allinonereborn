const express = require('express');
const puppeteer = require('puppeteer');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 8080;

async function getFreshStreamUrl(channelId) {
    let browser;
    try {
        browser = await puppeteer.launch({
            headless: "new",
            args: [
                '--no-sandbox', 
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--single-process',
                '--no-zygote'
            ]
        });
        
        const page = await browser.newPage();
        
        // Browser jesa behavior dikhane ke liye User Agent set karein
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        let m3u8Url = null;

        await page.setRequestInterception(true);
        page.on('request', (request) => {
            const url = request.url();
            if (url.includes('.m3u8') && url.includes('hdntl=')) {
                m3u8Url = url;
            }
            request.continue();
        });

        const targetUrl = `https://suniliv.pages.dev/pworld?id=${channelId}`;
        console.log(`🌐 Opening: ${targetUrl}`);

        // Page load karein (Network idle 2 ka wait karein)
        await page.goto(targetUrl, { 
            waitUntil: 'networkidle2', 
            timeout: 60000 
        });
        
        console.log("Page loaded. Trying to trigger video...");

        // Page ke andar video ya play button ko click karne ki koshish karein
        try {
            // JW Player ka play button (agar ho to click karein)
            await page.evaluate(() => {
                const video = document.querySelector('video');
                if (video) {
                    video.play().catch(e => console.log('Video play failed'));
                }
                const playBtn = document.querySelector('.jw-icon-display');
                if (playBtn) playBtn.click();
            });
        } catch (e) {
            console.log("Click attempt failed, but continuing...");
        }

        // Ab thoda zyada wait karein (15 seconds) taake token zaroor generate ho jaye
        await new Promise(r => setTimeout(r, 15000)); 
        
        await browser.close();
        
        return m3u8Url;
    } catch (error) {
        console.error("Puppeteer Error:", error.message);
        if (browser) await browser.close();
        throw error;
    }
}

app.get('/:channel.m3u8', async (req, res) => {
    const channelId = req.params.channel; 
    console.log(`📺 Player ne "${channelId}" channel ki request ki...`);
    
    try {
        const realUrl = await getFreshStreamUrl(channelId);
        
        if (!realUrl) {
            console.log("❌ Stream URL nahi mila! (Bot protection ya time out)");
            return res.status(404).send(`Channel "${channelId}" ka link nahi mila. Page load hua lekin stream token nahi bana.`);
        }

        console.log(`✅ Stream URL Mil Gaya: ${realUrl}`);

        https.get(realUrl, (streamRes) => {
            res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
            streamRes.pipe(res);
        }).on('error', (err) => {
            res.status(500).send("Error fetching stream");
        });

    } catch (error) {
        res.status(500).send("Error: " + error.message);
    }
});

app.get('/', (req, res) => {
    res.send("Stream server chal raha hai. URL mein channel ka naam dalein, jaise: /sab-hd.m3u8");
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
