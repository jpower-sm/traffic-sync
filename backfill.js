// backfill.js
import fetch from 'node-fetch';
import { config } from 'dotenv';
import { parseStringPromise } from 'xml2js';
import Airtable from 'airtable';

config(); // Load .env variables

const {
  TMAS_API_KEY,
  TMAS_LOCATION_ID,
  AIRTABLE_API_KEY,
  AIRTABLE_BASE_ID,
  AIRTABLE_TABLE_NAME,
} = process.env;

if (!TMAS_API_KEY || !TMAS_LOCATION_ID || !AIRTABLE_API_KEY || !AIRTABLE_BASE_ID || !AIRTABLE_TABLE_NAME) {
  throw new Error('Missing one or more environment variables. Please check your .env file.');
}

const base = new Airtable({ apiKey: AIRTABLE_API_KEY }).base(AIRTABLE_BASE_ID);

function formatDate(date) {
  return `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()}`;
}

async function fetchAndUpload(date) {
  const dateStr = formatDate(date);
  const url = `https://www.smssoftware.net/tmas/manTrafExp?fromDate=${dateStr}&toDate=${dateStr}&interval=0&hours=0&reqType=tdd&apiKey=${TMAS_API_KEY}&locationId=${TMAS_LOCATION_ID}`;
  
  console.log(`📅 Fetching: ${dateStr}`);
  try {
    const response = await fetch(url);
    const xml = await response.text();
    const json = await parseStringPromise(xml);

    const records = json.TRAFFIC?.data || [];
    if (!records.length) throw new Error('No traffic data returned.');

    const summary = records.reduce(
      (acc, r) => {
        const { trafficIn = '0', trafficOut = '0' } = r['$'];
        acc.trafficIn += parseFloat(trafficIn);
        acc.trafficOut += parseFloat(trafficOut);
        return acc;
      },
      { date: dateStr, trafficIn: 0, trafficOut: 0 }
    );
    summary.total = summary.trafficIn + summary.trafficOut;

    console.log('📊 Daily Summary:', summary);

    await base(AIRTABLE_TABLE_NAME).create([
      {
        fields: {
          Date: summary.date,
          'Traffic In': summary.trafficIn,
          'Traffic Out': summary.trafficOut,
          Total: summary.total,
        },
      },
    ]);

    console.log('✅ Uploaded to Airtable.');
  } catch (err) {
    console.error(`🔥 Error on ${dateStr}:`, err.message || err);
  }
}

// Main loop
async function runBackfill() {
  const start = new Date('2023-01-01');
  const end = new Date(Date.now() - 86400000); // yesterday
  let current = new Date(start);

  while (current <= end) {
    await fetchAndUpload(current);
    current.setDate(current.getDate() + 1);
    await new Promise((r) => setTimeout(r, 200)); // throttle
  }

  console.log('🎉 Backfill complete!');
}

runBackfill();