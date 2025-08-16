// app.js
// Apollo Lead Downloader
// Steps:
//   1) npm init -y && npm i express axios dotenv
//   2) Create .env with APOLLO_API_KEY=your_api_key_here
//   3) node app.js
//   4) Open http://localhost:3000

const express = require('express');
const axios = require('axios');
const dotenv = require('dotenv');

// Load env vars
dotenv.config();
const PORT = process.env.PORT || 3000;
const APOLLO_API_KEY = process.env.APOLLO_API_KEY;

if (!APOLLO_API_KEY) {
  console.error('[ERROR] Missing APOLLO_API_KEY in .env');
  process.exit(1);
}

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ---- Apollo API Search Helper ----
async function apolloSearchAll({ keywords, location, limit = 100, perPage = 50 }) {
  const results = [];
  let page = 1;
  const endpoint = 'https://api.apollo.io/v1/contacts/search';

  while (results.length < limit) {
    const payload = {
      q_keywords: keywords,
      person_locations: location ? [location] : undefined,
      page,
      per_page: perPage
    };

    const { data } = await axios.post(endpoint, payload, {
      timeout: 30000,
      headers: { 'X-Api-Key': APOLLO_API_KEY }
    });

    const contacts = data?.contacts || [];
    if (!contacts.length) break;

    for (const c of contacts) {
      results.push({
        first_name: c.first_name || '',
        last_name: c.last_name || '',
        title: c.title || '',
        company_name: c.organization?.name || c.company_name || '',
        city: c.city || '',
        state: c.state || '',
        country: c.country || '',
        email: c.email || c.emails?.[0] || '',
        phone: c.phone_numbers?.[0]?.raw_number || c.phone_numbers?.[0]?.number || '',
        linkedin_url: c.linkedin_url || c.linkedIn_url || c.linkedin?.url || '',
        company_website: c.organization?.website_url || ''
      });
      if (results.length >= limit) break;
    }

    page++;
    if (contacts.length < perPage) break;
  }
  return results;
}

// ---- CSV Helper ----
function toCSV(rows) {
  const headers = [
    'first_name', 'last_name', 'title', 'company_name',
    'city', 'state', 'country', 'email', 'phone',
    'linkedin_url', 'company_website'
  ];
  const esc = v => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [
    headers.join(','),
    ...rows.map(r => headers.map(h => esc(r[h])).join(','))
  ].join('\n');
}

// ---- Routes ----
app.get('/', (_req, res) => res.type('html').send(buildHTML()));

app.post('/search', async (req, res) => {
  try {
    const { keywords, location, limit = 100, perPage = 50 } = req.body || {};
    if (!keywords) return res.status(400).json({ error: 'keywords is required' });

    const results = await apolloSearchAll({
      keywords,
      location,
      limit: Math.min(+limit || 100, 1000),
      perPage: Math.min(+perPage || 50, 200)
    });

    res.json({ results });
  } catch (err) {
    console.error(err?.response?.data || err.message);
    res.status(500).json({ error: 'Search failed', details: err?.response?.data || err.message });
  }
});

app.get('/download', async (req, res) => {
  try {
    const { keywords, location, limit = '100', perPage = '50' } = req.query;
    if (!keywords) return res.status(400).send('keywords is required');

    const results = await apolloSearchAll({
      keywords,
      location,
      limit: Math.min(parseInt(limit) || 100, 1000),
      perPage: Math.min(parseInt(perPage) || 50, 200)
    });

    const csv = toCSV(results);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="apollo_leads_${Date.now()}.csv"`);
    res.send(csv);
  } catch (err) {
    console.error(err?.response?.data || err.message);
    res.status(500).send('Download failed');
  }
});

// ---- HTML UI ----
function buildHTML() {
  return `
<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>Apollo Lead Downloader</title>
<style>
body { font-family: system-ui; background: #0b1220; color: #e6e8ee; margin: 0; }
.wrap { max-width: 920px; margin: 40px auto; padding: 24px; }
.card { background: #121a2b; border-radius: 16px; padding: 24px; }
input, button { padding: 10px; border-radius: 8px; }
</style>
</head>
<body>
<div class="wrap">
  <div class="card">
    <h1>🚀 Apollo Lead Downloader</h1>
    <input id="keywords" placeholder="web designer" />
    <input id="location" placeholder="Mumbai, India" />
    <input id="limit" type="number" value="100" />
    <input id="perPage" type="number" value="50" />
    <button id="searchBtn">Search</button>
    <a id="downloadLink" href="#" download><button id="downloadBtn" disabled>Download CSV</button></a>
    <div id="status"></div>
    <table id="resultsTable"><thead><tr><th>Name</th><th>Title</th><th>Company</th><th>Location</th><th>Email</th><th>Phone</th><th>LinkedIn</th></tr></thead><tbody></tbody></table>
  </div>
</div>
<script>
const searchBtn = document.getElementById('searchBtn');
const downloadBtn = document.getElementById('downloadBtn');
const downloadLink = document.getElementById('downloadLink');
const statusEl = document.getElementById('status');
const tbody = document.querySelector('#resultsTable tbody');

async function doSearch() {
  const keywords = document.getElementById('keywords').value.trim();
  const location = document.getElementById('location').value.trim();
  const limit = parseInt(document.getElementById('limit').value || '100');
  const perPage = parseInt(document.getElementById('perPage').value || '50');
  if (!keywords) return alert('Enter keywords');

  searchBtn.disabled = true;
  downloadBtn.disabled = true;
  statusEl.textContent = 'Searching...';
  tbody.innerHTML = '';

  try {
    const res = await fetch('/search', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keywords, location, limit, perPage })
    });
    if (!res.ok) throw new Error('Search failed');
    const data = await res.json();
    const rows = data.results || [];
    rows.forEach(r => {
      const tr = document.createElement('tr');
      const name = [r.first_name, r.last_name].filter(Boolean).join(' ');
      const loc = [r.city, r.state, r.country].filter(Boolean).join(', ');
      tr.innerHTML = \`<td>\${name}</td><td>\${r.title || ''}</td><td>\${r.company_name || ''}</td><td>\${loc}</td><td>\${r.email || ''}</td><td>\${r.phone || ''}</td><td>\${r.linkedin_url ? '<a href="' + r.linkedin_url + '" target="_blank">Profile</a>' : ''}</td>\`;
      tbody.appendChild(tr);
    });
    statusEl.textContent = \`Found \${rows.length} leads.\`;
    downloadLink.href = '/download?' + new URLSearchParams({ keywords, location, limit, perPage });
    downloadBtn.disabled = rows.length === 0;
  } catch (err) {
    console.error(err);
    statusEl.textContent = 'Error.';
  } finally {
    searchBtn.disabled = false;
  }
}
searchBtn.addEventListener('click', doSearch);
</script>
</body>
</html>
  `;
}

// ---- Start server ----
app.listen(PORT, () => {
  console.log(`Apollo Lead Downloader running: http://localhost:${PORT}`);
});
