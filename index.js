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

// Get yesterday in local time
const yesterday = new Date();
yesterday.setDate(yesterday.getDate() - 1);

// Format dates
const mdy = yesterday.toLocaleDateString('en-US'); // MM/DD/YYYY for API
const iso = yesterday.toISOString().split('T')[0]; // YYYY-MM-DD for Airtable

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

    const existing = await base(AIRTABLE_TABLE_NAME).select({
      filterByFormula: `IS_SAME({Date}, '${summary.date}', 'day')`,
      maxRecords: 1,
    }).firstPage();

    if (existing.length > 0) {
      const existingRecord = existing[0];
      const fields = existingRecord.fields;

      const needsUpdate =
        fields['Traffic In'] !== summary.trafficIn ||
        fields['Traffic Out'] !== summary.trafficOut ||
        fields['Total'] !== summary.total;

      if (needsUpdate) {
        await base(AIRTABLE_TABLE_NAME).update([
          {
            id: existingRecord.id,
            fields: {
              'Traffic In': summary.trafficIn,
              'Traffic Out': summary.trafficOut,
              Total: summary.total,
            },
          },
        ]);
        console.log(`♻️ Updated existing record for ${summary.date}.`);
      } else {
        console.log(`⚠️ Record already exists and is up-to-date for ${summary.date}, skipping.`);
      }
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
      console.log('✅ Uploaded to Airtable successfully.');
    }
  } catch (err) {
    console.error('🔥 Error:', err.message || err);
    process.exit(1);
  }
})();