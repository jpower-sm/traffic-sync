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

// Get yesterday's date in MM/DD/YYYY
const yesterday = new Date(Date.now() - 86400000);
const dateStr = `${yesterday.getMonth() + 1}/${yesterday.getDate()}/${yesterday.getFullYear()}`;

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

  console.log('📊 Summary:', summary);

  const base = new Airtable({ apiKey: AIRTABLE_API_KEY }).base(AIRTABLE_BASE_ID);

  // Check for existing record with the same Date
  const existingRecords = await base(AIRTABLE_TABLE_NAME)
    .select({
      filterByFormula: `{Date} = '${summary.date}'`
    })
    .firstPage();

  if (existingRecords.length > 0) {
    const recordId = existingRecords[0].id;
    await base(AIRTABLE_TABLE_NAME).update([
      {
        id: recordId,
        fields: {
          'Traffic In': summary.trafficIn,
          'Traffic Out': summary.trafficOut,
          Total: summary.total,
        },
      },
    ]);
    console.log(`♻️ Updated existing record for ${summary.date}.`);
  } else {
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
    console.log(`✅ Created new record for ${summary.date}.`);
  }
} catch (err) {
  console.error('🔥 Error:', err.message || err);
  process.exit(1); // Ensure GitHub Actions fails visibly
}