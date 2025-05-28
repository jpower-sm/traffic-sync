// index.js
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

// Calculate yesterday in local (Mountain) time
const now = new Date();
const localOffset = now.getTimezoneOffset() * 60000; // ms offset
const localTime = new Date(now - localOffset);
localTime.setDate(localTime.getDate() - 1); // subtract one day
const dateStr = `${localTime.getMonth() + 1}/${localTime.getDate()}/${localTime.getFullYear()}`;

const url = `https://www.smssoftware.net/tmas/manTrafExp?fromDate=${dateStr}&toDate=${dateStr}&interval=0&hours=0&reqType=tdd&apiKey=${TMAS_API_KEY}&locationId=${TMAS_LOCATION_ID}`;

console.log('🟢 Script started...');
console.log('🌐 Fetching:', url);

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

  const base = new Airtable({ apiKey: AIRTABLE_API_KEY }).base(AIRTABLE_BASE_ID);

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
}