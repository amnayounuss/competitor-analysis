import * as fs from 'fs';
import * as path from 'path';

function run() {
  const filePath = path.join(process.cwd(), 'scratch/state.json');
  if (!fs.existsSync(filePath)) {
    console.log('state.json does not exist');
    return;
  }

  const raw = fs.readFileSync(filePath, 'utf-8');
  console.log('File size:', raw.length, 'bytes');
  let data: any;
  try {
    data = JSON.parse(raw);
  } catch (e: any) {
    console.error('Failed to parse state.json:', e.message);
    return;
  }

  console.log('Type of data:', typeof data);
  if (Array.isArray(data)) {
    console.log('Root array length:', data.length);
  }

  // Search recursively for ANY array containing numbers between 0 and 100
  const matches: any[] = [];
  function search(node: any, pathStr: string, depth: number) {
    if (depth > 40) return;
    if (Array.isArray(node)) {
      // Is it a number array?
      const isNumArray = node.length > 0 && node.every(v => typeof v === 'number');
      if (isNumArray) {
        matches.push({ path: pathStr, length: node.length, values: node });
      } else {
        node.forEach((item, idx) => {
          search(item, `${pathStr}[${idx}]`, depth + 1);
        });
      }
    } else if (node && typeof node === 'object') {
      for (const [key, val] of Object.entries(node)) {
        search(val, `${pathStr}.${key}`, depth + 1);
      }
    }
  }

  search(data, 'root', 0);
  console.log(`Found ${matches.length} number-only arrays in state.json.`);
  
  // Filter for arrays that look like they could represent hourly curves or are of length 24
  const possibleHours = matches.filter(m => m.length === 24 || m.length === 7 || m.length === 168);
  console.log(`\nPossible popular times candidates (length 7, 24, or 168):`);
  possibleHours.forEach((m, idx) => {
    console.log(`\nCandidate #${idx + 1} at ${m.path} (length ${m.length}):`);
    console.log('  values:', m.values.slice(0, 12));
  });

  // Let's also search for ANY array of length 7 containing arrays
  const arraysOfArrays: any[] = [];
  function searchArraysOfArrays(node: any, pathStr: string, depth: number) {
    if (depth > 40) return;
    if (Array.isArray(node)) {
      if (node.length === 7 && node.every(item => Array.isArray(item))) {
        arraysOfArrays.push({ path: pathStr, node });
      } else {
        node.forEach((item, idx) => {
          searchArraysOfArrays(item, `${pathStr}[${idx}]`, depth + 1);
        });
      }
    } else if (node && typeof node === 'object') {
      for (const [key, val] of Object.entries(node)) {
        searchArraysOfArrays(val, `${pathStr}.${key}`, depth + 1);
      }
    }
  }

  searchArraysOfArrays(data, 'root', 0);
  console.log(`\nFound ${arraysOfArrays.length} arrays of length 7 containing nested arrays.`);
  arraysOfArrays.forEach((a, idx) => {
    console.log(`\nArray of Arrays #${idx + 1} at ${a.path}:`);
    const lengths = a.node.map((item: any) => item.length);
    console.log('  nested array lengths:', lengths);
    if (lengths.every((l: number) => l === 24)) {
      console.log('  ⚠️ Length is exactly 7x24! Values for day 0:', a.node[0].slice(0, 12));
    } else {
      console.log('  First few values of sub-array 0:', a.node[0] ? a.node[0].slice(0, 5) : 'empty');
    }
  });
}

run();
