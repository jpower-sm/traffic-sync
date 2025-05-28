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

// Get yesterday's date in MM/DD/YYYY format (local time)
const yesterday = new Date();
yesterday.setDate(yesterday.getDate() - 1);
const dateStr = `${yesterday.getMonth() + 1}/${yesterday.getDate()}/${yesterday.getFullYear()}`;

// Build TMAS API URL
const url = `https://www.smssoftware.net/tmas/manTrafExp?fromDate=${dateStr}&toDate=${dateStr}&interval=0&hours=0&reqType=tdd&apiKey=${TMAS_API_KEY}&locationId=${TMAS_LOCATION_ID}`;

console.log('🟢 Script started...');
console.log('🌐 Fetching:', url);

try {
  const response = await fetch(url);
  const xml = await response.text();

  // Handle case where XML is returned instead of JSON
  if (xml.trim().startsWith('<')) {
    const json = await parseStringPromise(xml);
    const records = json.TRAFFIC?.data || [];

    if (!records.length) throw new Error('No traffic data returned.');

    // Summarize
    const summary = records.reduce(
      (acc, r) => {
        const { trafficIn = '0', trafficOut = '0' } = r['$'];
        acc.trafficIn += parseFloat(trafficIn);
        acc.trafficOut += parseFloat(trafficOut);
        return acc;
      },
      { trafficIn: 0, trafficOut: 0 }
    );

    const total = summary.trafficIn + summary.trafficOut;

    console.log('📊 Summary:', {
      Date: dateStr,
      'Traffic In': summary.trafficIn,
      'Traffic Out': summary.trafficOut,
      Total: total,
    });

    // Airtable base
    const base = new Airtable({ apiKey: AIRTABLE_API_KEY }).base(AIRTABLE_BASE_ID);

    // Check for existing record
    const existing = await base(AIRTABLE_TABLE_NAME).select({
      filterByFormula: `AND({Date} = '${dateStr}', {Location ID} = '${TMAS_LOCATION_ID}')`,
      maxRecords: 1,
    }).firstPage();

    if (existing.length > 0) {
      // Update existing record
      await base(AIRTABLE_TABLE_NAME).update(existing[0].id, {
        'Traffic In': summary.trafficIn,
        'Traffic Out': summary.trafficOut,
        Total: total,
      });
      console.log(`🔁 Updated existing record for ${dateStr}`);
    } else {
      // Create new record
      await base(AIRTABLE_TABLE_NAME).create({
        fields: {
          Date: dateStr,
          'Traffic In': summary.trafficIn,
          'Traffic Out': summary.trafficOut,
          Total: total,
          'Location ID': TMAS_LOCATION_ID,
        },
      });
      console.log(`✅ Created new record for ${dateStr}`);
    }
  } else {
    throw new Error('Received non-XML response. API may be down or returning HTML.');
  }
} catch (err) {
  console.error('🔥 Error:', err.message || err);
  process.exit(1); // important for GitHub Actions to detect failure
}