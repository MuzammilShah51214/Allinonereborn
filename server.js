const express = require('express');
const puppeteer = require('puppeteer');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 3000;

// Puppeteer chalane ka function (Channel Name leta hai)
async function getFreshStreamUrl(channelId) {
    let browser;
    try {
        browser = await puppeteer.launch({
            headless: "new",
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
        });
        
        const page = await browser.newPage();
        let m3u8Url = null;

        await page.setRequestInterception(true);
        page.on('request', (request) => {
            const url = request.url();
            if (url.includes('.m3u8') && url.includes('hdntl=')) {
                m3u8Url = url;
            }
            request.continue();
        });

        // Yahan hum dynamic channel ID use kar rahe hain
        const targetUrl = `https://suniliv.pages.dev/pworld?id=${channelId}`;
        console.log(`🌐 Opening: ${targetUrl}`);

        await page.goto(targetUrl, { 
            waitUntil: 'networkidle2', 
            timeout: 60000 
        });
        
        await new Promise(r => setTimeout(r, 10000)); // Wait for player to generate token
        await browser.close();
        return m3u8Url;
    } catch (error) {
        if (browser) await browser.close();
        throw error;
    }
}

// API Endpoint jo URL se channel name uthayega
// Example: /sab-hd.m3u8 ya /star-plus.m3u8
app.get('/:channel.m3u8', async (req, res) => {
    const channelId = req.params.channel; 
    console.log(`📺 Player ne "${channelId}" channel ki request ki...`);
    
    try {
        // Us channel ka fresh stream link nikalain
        const realUrl = await getFreshStreamUrl(channelId);
        
        if (!realUrl) {
            return res.status(404).send(`Channel "${channelId}" ka link nahi mila.`);
        }

        // Player ko m3u8 file bhej dein
        https.get(realUrl, (streamRes) => {
            res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
            streamRes.pipe(res);
        }).on('error', (err) => {
            res.status(500).send("Error fetching stream");
        });

    } catch (error) {
        console.error("Error:", error);
        res.status(500).send("Error: " + error.message);
    }
});

app.get('/', (req, res) => {
    res.send("Stream server chal raha hai. URL mein channel ka naam dalein, jaise: /sab-hd.m3u8");
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
