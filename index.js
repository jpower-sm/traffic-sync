import fetch from 'node-fetch';
import { config } from 'dotenv';
import { parseStringPromise } from 'xml2js';
import Airtable from 'airtable';
import { DateTime } from 'luxon';

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

// ⏰ Get yesterday's date in Mountain Time
const yesterday = DateTime.now().setZone('America/Denver').minus({ days: 1 });
const mdy = yesterday.toFormat('M/d/yyyy');     // For API (e.g. 5/26/2025)
const iso = yesterday.toISODate();              // For Airtable (e.g. 2025-05-26)

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

    // 🔍 Check if a record already exists for this date
    const existing = await base(AIRTABLE_TABLE_NAME).select({
      filterByFormula: `IS_SAME({Date}, '${summary.date}', 'day')`,
      maxRecords: 1,
    }).firstPage();

    if (existing.length > 0) {
      const existingRecord = existing[0].fields;
      const sameData =
        existingRecord['Traffic In'] === summary.trafficIn &&
        existingRecord['Traffic Out'] === summary.trafficOut &&
        existingRecord['Total'] === summary.total;

      if (sameData) {
        console.log(`⚠️ Record already exists and is up-to-date for ${summary.date}, skipping.`);
        return;
      }

      console.log(`♻️ Updating existing record for ${summary.date}...`);
      await base(AIRTABLE_TABLE_NAME).update(existing[0].id, {
        'Traffic In': summary.trafficIn,
        'Traffic Out': summary.trafficOut,
        Total: summary.total,
      });

      console.log('✅ Updated Airtable record successfully.');
      return;
    }

    // 🆕 Otherwise, create a new record
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