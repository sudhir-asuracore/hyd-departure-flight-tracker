const express = require('express');
const cors = require('cors');
const path = require('path');
const cheerio = require('cheerio');
const puppeteer = require('puppeteer');

const app = express();
const PORT = process.env.PORT || 3000;

// --- In-Memory Cache ---
const cache = {
    data: null,
    lastFetch: 0,
};
const CACHE_DURATION = 15 * 60 * 1000; // 15 minutes in milliseconds

// --- Helper Functions for Parsing ---

function getAirlineNameFromUrl(url) {
    if (!url) return "Other";
    try {
        const filename = url.split('/').pop().split('.')[0]; 
        const parts = filename.split('_');
        let name = parts[0].replace(/-/g, ' ');
        return name || "Other";
    } catch (e) {
        return "Other";
    }
}

function calculateDelayMinutes(std, etd) {
    if (std === etd) return 0;
    const [stdH, stdM] = std.split(':').map(Number);
    const [etdH, etdM] = etd.split(':').map(Number);
    let stdMinutes = stdH * 60 + stdM;
    let etdMinutes = etdH * 60 + etdM;
    if (etdMinutes < stdMinutes - 12 * 60) etdMinutes += 24 * 60; // Handle overnight delays
    return Math.max(0, etdMinutes - stdMinutes);
}

function parseTimeAndDelay(rawText) {
    const times = rawText.match(/([0-9]{1,2}:[0-9]{2})/g);
    
    if (!times || times.length === 0) {
        return { std: "--:--", etd: "--:--", delayMins: 0 };
    }

    const std = times[0];
    const etd = times.length > 1 ? times[1] : std;
    const delayMins = calculateDelayMinutes(std, etd);
    return { std, etd, delayMins };
}

function parseFlights(html) {
    const $ = cheerio.load(html);
    const flights = [];

    $('tr').each((i, row) => {
        const cols = $(row).find('td');
        if (cols.length < 7) {
            return; // Skip rows that don't have enough columns
        }

        const destText = $(cols[2]).text().trim();

        // Intelligently skip the header row by checking its content
        if (destText.toLowerCase().includes('origin')) {
            return; 
        }

        const airlineImg = $(cols[0]).find('img').attr('src');
        const flightNo = $(cols[1]).text().trim();
        const timeRaw = $(cols[4]).text().trim();
        const gate = $(cols[5]).text().trim();
        const status = $(cols[6]).text().trim();

        const { std, etd, delayMins } = parseTimeAndDelay(timeRaw);
        const airlineName = getAirlineNameFromUrl(airlineImg);

        flights.push({
            airlineImg,
            airlineName,
            flightNo,
            dest: destText, // Reuse the trimmed text
            std,
            etd,
            delayMins,
            gate,
            status
        });
    });

    return flights;
}

// --- Express App Setup ---

// Set a Content Security Policy
app.use((req, res, next) => {
    res.setHeader(
        'Content-Security-Policy',
        "default-src 'self'; " +
        "script-src 'self' 'unsafe-inline' https://cdn.tailwindcss.com; " +
        "style-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com; " +
        "style-src-elem 'self' 'unsafe-inline' https://cdnjs.cloudflare.com; " +
        "font-src 'self' https://cdnjs.cloudflare.com; " +
        "img-src 'self' https://www.hyderabad.aero data:; " +
        "connect-src 'self';"
    );
    next();
});

app.use(cors());
app.use(express.static(__dirname));

// --- API Endpoint ---

app.get('/api/departures', async (req, res) => {
    const now = Date.now();
    const isCacheFresh = (now - cache.lastFetch) < CACHE_DURATION;

    if (cache.data && isCacheFresh) {
        console.log("Serving request from cache.");
        return res.json(cache.data);
    }

    console.log("Cache is stale or empty. Fetching new data...");
    let browser = null;
    try {
        const targetUrl = `https://www.hyderabad.aero/getFidsAllflightSch.aspx?FltWay=D&FltNum=&FltFrom=&rn=${Math.random()}`;
        console.log(`Launching headless browser to fetch: ${targetUrl}`);

        browser = await puppeteer.launch({ 
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        const page = await browser.newPage();
        
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36');
        
        const response = await page.goto(targetUrl, {
            waitUntil: 'networkidle0',
        });

        if (!response.ok()) {
            throw new Error(`Airport server responded with ${response.status()}`);
        }

        const body = await page.content();
        const flights = parseFlights(body);
        
        // Update cache
        cache.data = flights;
        cache.lastFetch = Date.now();
        console.log("Cache updated successfully.");

        res.json(flights);

    } catch (error) {
        console.error("Proxy/Scraping Error:", error.message);
        // If fetching fails, serve stale data if available, otherwise send error
        if (cache.data) {
            console.warn("Serving stale data due to fetch error.");
            res.json(cache.data);
        } else {
            res.status(500).json({ error: "Failed to fetch flight data", details: error.message });
        }
    } finally {
        if (browser) {
            await browser.close();
        }
    }
});

app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});