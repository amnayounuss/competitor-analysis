import { createClient } from '@supabase/supabase-js';
import puppeteer from 'puppeteer';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(process.cwd(), '.env') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

async function run() {
  const admin = createClient(supabaseUrl, serviceRoleKey);
  const userId = '1a36f301-9ce6-41bc-a313-3a0d53e080a6';

  const { data: dbRecs } = await admin
    .from('client_databases')
    .select('supabase_url, service_role_key')
    .eq('user_id', userId)
    .single();

  if (!dbRecs) return;
  const cdb = createClient(dbRecs.supabase_url, dbRecs.service_role_key);

  const { data: branches } = await cdb
    .from('branch_analytics')
    .select('branch_name, google_maps_link')
    .not('google_maps_link', 'is', null)
    .limit(2);

  if (!branches || branches.length === 0) {
    console.log('No branches found in branch_analytics with google_maps_link');
    return;
  }

  const branch = branches[0];
  const url = branch.google_maps_link;
  console.log(`Testing with branch "${branch.branch_name}" at URL: ${url}`);

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

    const allGrids = await page.evaluate(() => {
      const grids: any[] = [];

      function looksLikePopularTimesGrid(v: any) {
        if (!Array.isArray(v) || v.length !== 7) return false;
        for (const day of v) {
          if (!Array.isArray(day)) return false;
          if (day.length !== 24 && day.length !== 0) return false;
          for (const n of day) {
            if (typeof n !== 'number' || n < 0 || n > 100) return false;
          }
        }
        return v.some((day: number[]) => day.some((n: number) => n > 0));
      }

      function findGrids(node: any, pathStr: string, depth: number) {
        if (depth > 30) return;
        if (looksLikePopularTimesGrid(node)) {
          grids.push({ path: pathStr, value: node });
          return;
        }
        if (Array.isArray(node)) {
          node.forEach((item, index) => {
            findGrids(item, `${pathStr}[${index}]`, depth + 1);
          });
        } else if (node && typeof node === 'object') {
          for (const [key, val] of Object.entries(node)) {
            findGrids(val, `${pathStr}.${key}`, depth + 1);
          }
        }
      }

      // Check window level variables
      if ((window as any).APP_INITIALIZATION_STATE) {
        findGrids((window as any).APP_INITIALIZATION_STATE, 'APP_INITIALIZATION_STATE', 0);
      }

      return grids;
    });

    console.log(`Found ${allGrids.length} grids matching the popular times shape.`);
    allGrids.forEach((g, idx) => {
      console.log(`\nGrid #${idx + 1} at Path: ${g.path}`);
      const val = g.value;
      const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      let isAllIdentical = true;
      const firstDayStr = JSON.stringify(val[0]);
      for (let i = 1; i < 7; i++) {
        if (JSON.stringify(val[i]) !== firstDayStr) {
          isAllIdentical = false;
        }
      }
      console.log(`  Is All Days Identical? ${isAllIdentical}`);
      val.forEach((day: any, dIdx: number) => {
        const sum = day.reduce((a: number, b: number) => a + b, 0);
        console.log(`    - Day ${dIdx} (${days[dIdx]}): sum=${sum}, values (first 6):`, day.slice(0, 6));
      });
    });

  } catch (err: any) {
    console.error('Error fetching/parsing:', err.message);
  } finally {
    await browser.close();
  }
}

run();
