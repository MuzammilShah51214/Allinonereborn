const express = require('express');
const puppeteer = require('puppeteer');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 8080;

async function getFreshStreamUrl(channelId) {
    let browser;
    try {
        // Railway ke liye Chrome ko stable banaya gaya hai
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
        let m3u8Url = null;

        await page.setRequestInterception(true);
        page.on('request', (request) => {
            const url = request.url();
            // Stream link pakadne ka logic
            if (url.includes('.m3u8') && url.includes('hdntl=')) {
                m3u8Url = url;
            }
            request.continue();
        });

        // Aapka diya hua exact link yahan hai
        const targetUrl = `https://suniliv.pages.dev/pworld?id=${channelId}`;
        console.log(`🌐 Opening: ${targetUrl}`);

        await page.goto(targetUrl, { 
            waitUntil: 'networkidle2', 
            timeout: 60000 
        });
        
        // 12 second wait taake JW Player load ho kar token generate kar sake
        await new Promise(r => setTimeout(r, 12000)); 
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
            console.log("❌ Stream URL nahi mila!");
            return res.status(404).send(`Channel "${channelId}" ka link nahi mila.`);
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
