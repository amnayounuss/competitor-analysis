import puppeteer from 'puppeteer';
import * as fs from 'fs';
import * as path from 'path';

async function run() {
  const url = `https://maps.google.com/maps?cid=13163844273258547435`;
  console.log(`Navigating directly to branch CID URL: ${url}`);

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

    // Wait for the page redirection and content load
    console.log('Waiting 10 seconds for redirection and full load...');
    await new Promise(r => setTimeout(r, 10000));

    // Try to get APP_INITIALIZATION_STATE
    const stateExists = await page.evaluate(() => {
      return typeof (window as any).APP_INITIALIZATION_STATE !== 'undefined';
    });
    console.log('Does APP_INITIALIZATION_STATE exist?', stateExists);

    if (stateExists) {
      const rawState = await page.evaluate(() => {
        return JSON.stringify((window as any).APP_INITIALIZATION_STATE);
      });
      fs.writeFileSync(path.join(process.cwd(), 'scratch/state.json'), rawState);
      console.log('Saved window.APP_INITIALIZATION_STATE to scratch/state.json');
    } else {
      // Dump raw HTML to see what Google returned
      const html = await page.content();
      fs.writeFileSync(path.join(process.cwd(), 'scratch/page.html'), html);
      console.log('Saved page HTML to scratch/page.html');
    }

  } catch (err: any) {
    console.error('Error:', err.message);
  } finally {
    await browser.close();
  }
}

run();
