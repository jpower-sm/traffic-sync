import fetch from 'node-fetch';
import { config } from 'dotenv';
import { parseStringPromise } from 'xml2js';
import Airtable from 'airtable';

config();

const {
  TMAS_API_KEY,
  TMAS_LOCATION_ID,
  AIRTABLE_API_KEY,
  AIRTABLE_BASE_ID,
  AIRTABLE_TABLE_NAME,
} = process.env;

if (!TMAS_API_KEY || !TMAS_LOCATION_ID || !AIRTABLE_API_KEY || !AIRTABLE_BASE_ID || !AIRTABLE_TABLE_NAME) {
  throw new Error('Missing environment variables.');
}

// Use Mountain Time (America/Denver) for accurate "yesterday"
const tz = 'America/Denver';
const nowInMT = new Date(new Date().toLocaleString('en-US', { timeZone: tz }));
nowInMT.setDate(nowInMT.getDate() - 1);

const mdy = nowInMT.toLocaleDateString('en-US', { timeZone: tz }); // MM/DD/YYYY for TMAS API
const iso = nowInMT.toLocaleDateString('en-CA', { timeZone: tz }); // YYYY-MM-DD for Airtable

const url = `https://www.smssoftware.net/tmas/manTrafExp?fromDate=${mdy}&toDate=${mdy}&interval=0&hours=0&reqType=tdd&apiKey=${TMAS_API_KEY}&locationId=${TMAS_LOCATION_ID}`;

console.log('🟢 Script started...');
console.log('🌐 Fetching:', url);

(async () => {
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
      { date: iso, trafficIn: 0, trafficOut: 0 }
    );
    summary.total = summary.trafficIn + summary.trafficOut;

    console.log('📊 Summary:', summary);

    const base = new Airtable({ apiKey: AIRTABLE_API_KEY }).base(AIRTABLE_BASE_ID);

    // Check for existing record with the same date
    const existing = await base(AIRTABLE_TABLE_NAME).select({
      filterByFormula: `IS_SAME({Date}, '${summary.date}', 'day')`,
      maxRecords: 1,
    }).firstPage();

    if (existing.length > 0) {
      console.log(`⚠️ Record already exists for ${summary.date}, skipping.`);
      return;
    }

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

    console.log('✅ Uploaded to Airtable successfully.');
  } catch (err) {
    console.error('🔥 Error:', err.message || err);
    process.exit(1);
  }
})();