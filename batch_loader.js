'use strict';

const fs = require('fs');
const path = require('path');
const { URL_FILE, OUTPUT_DIR, PROGRESS_FILE } = require('./config');

const CSV_FILE = path.resolve(__dirname, 'singapore_leads_cleaned.csv');

// Blacklist of generic consumer B2C / non-ICP patterns
const B2C_BLACKLIST = /hair|salon|barber|nail|spa\b|massage|facial|tuition|tutor|school|academy|institute|college|university|pet\b|dog|cat|vet\b|animal|woof|paw|maid|helper|domestic|motor\b|car\b|automotive|used car|vehicle|spray\b|workshop|interior|renovation|carpentry|art studio|dance|music|yoga|fitness|bbq|bakery|restaurant|catering|cafe\b|coffee|food\b|meat\b|wine\b|liquor|beer|supermarket|mall\b|wedding|bridal|jewel|diamond|gold\b|watch\b|boutique|rolex|gadget|lock\b|park\b|centrepoint|signarama|signage|signcraft|rubber stamp|bhupesh|gelato|ice cream|plantonic|carton box|seafood stall|flower|florist|bouquet|skincare|cosmetic|beauty|discount store|department store|outlet|sober horse|secretlab|rice dumpling|coffee powder|coconut/i;

// Marketplace, social, and non-target domains to skip
const BAD_DOMAINS = new Set([
  'shopee.sg', 'lazada.sg', 'amazon.sg', 'amazon.com', 'qoo10.sg', 'carousell.sg',
  'facebook.com', 'instagram.com', 'linkedin.com', 'twitter.com', 'tiktok.com', 'youtube.com',
  'yellowpages.com.sg', 'streetdirectory.com', 'gov.sg', 'sfa.gov.sg', 'tripadvisor.com',
  'yelp.com', 'qoo.tn', 'dhl.com', 'marinabaysands.com', 'casetify.com', 'kaercher.com',
  'samsung.com', 'apple.com', 'microsoft.com', 'roberthalf.com', 'myemploymentagency.sg',
  'telegram.org', 't.me', 'app.google', 'mustafa.com.sg', 'cooptradejapan.co.jp',
  'blueclays.co.uk', 'blueclays.pk', 'bitly.com', 'bit.ly', 'tinyurl.com', 'sbs-group.co.jp',
  'volvoce.com', 'buhlergroup.com', 'crown.com'
]);

function extractDomain(url) {
  if (!url) return '';
  try {
    let clean = url.trim();
    if (!clean.startsWith('http')) clean = 'https://' + clean;
    let host = new URL(clean).hostname.toLowerCase();
    if (host.startsWith('www.')) host = host.slice(4);
    return host.split(':')[0];
  } catch (_) {
    return '';
  }
}

function cleanUrl(u) {
  if (!u || !u.startsWith('http')) return '';
  try {
    const parsed = new URL(u);
    // Strip trailing slash duplicates & queries
    let clean = `${parsed.protocol}//${parsed.hostname}${parsed.pathname}`;
    if (clean.endsWith('//')) clean = clean.slice(0, -1);
    return clean;
  } catch (_) {
    return u.split('?')[0];
  }
}

function cleanCompanyName(raw) {
  if (!raw) return '';
  return raw
    .split(/[-–|•]/)[0]
    .replace(/\b(pte\.?|ltd\.?|private|limited|llc|pvt\.?|singapore|sg)\b/gi, '')
    .replace(/[\(\)]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Gathers all domains that have been attempted or queued across history
 */
function getSeenDomains() {
  const seen = new Set();

  function scanFile(filePath) {
    if (!fs.existsSync(filePath)) return;
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const lines = content.split('\n');
      for (const line of lines) {
        if (!line.trim()) continue;
        if (filePath.endsWith('.csv')) {
          const parts = line.split(',');
          for (const p of parts) {
            const clean = p.replace(/["']/g, '').trim();
            if (clean.includes('.') && (clean.startsWith('http') || !clean.includes(' '))) {
              const d = extractDomain(clean);
              if (d && !d.endsWith('png') && !d.endsWith('jpg') && !d.endsWith('pdf')) {
                seen.add(d);
              }
            }
          }
        } else {
          const d = extractDomain(line.trim());
          if (d) seen.add(d);
        }
      }
    } catch (_) {}
  }

  // Scan output files
  if (fs.existsSync(OUTPUT_DIR)) {
    const files = fs.readdirSync(OUTPUT_DIR);
    for (const f of files) {
      scanFile(path.join(OUTPUT_DIR, f));
    }
  }

  // Scan current retry_urls.txt
  scanFile(URL_FILE);

  return seen;
}

function getBestUrl(row) {
  const urls = [
    (row[10] || '').trim(), // Contact Form URL
    (row[17] || '').trim(), // Target_URL
    (row[9]  || '').trim(), // Actual Website
    (row[8]  || '').trim()  // Maps Website
  ];

  for (let rawU of urls) {
    if (!rawU || !rawU.startsWith('http')) continue;
    const lower = rawU.toLowerCase();
    if (['.jpg', '.jpeg', '.png', '.gif', '.pdf', '.svg', '.webp'].some(ext => lower.endsWith(ext))) continue;

    // Reject deep blog/advice/job-scam URLs in favor of main site
    if (['/advice/', '/blog/', '/news-', '/job-scam', '/job-seekers', 'us/en', 'wordpressthemesclub', 'for-helper', 'helper', 'maid', 'blogspot.com', 'wixsite.com', 'wordpress.com'].some(p => lower.includes(p))) {
      const actual = (row[9] || '').trim();
      if (actual && actual.startsWith('http') && !['helper', 'maid', 'us/en', 'blogspot'].some(p => actual.toLowerCase().includes(p))) {
        rawU = actual;
      } else {
        continue;
      }
    }

    const d = extractDomain(rawU);
    if (!d || !d.includes('.') || d.split('.').length < 2) continue;
    if (BAD_DOMAINS.has(d)) continue;
    if (['yellowpages', 'streetdirectory', 'gov.sg', 'maid', 'helper', 'google', 'telegram', 'blogspot', 'wix', 'bitly'].some(p => d.includes(p))) continue;
    if (['.co.uk', '.co.jp', '.com.au', '.ru', '.pk'].some(sfx => d.endsWith(sfx))) continue;

    return cleanUrl(rawU);
  }
  return null;
}

/**
 * Loads and selects the next balanced batch of fresh leads (17 per angle by default).
 * Writes them to retry_urls.txt and resets progress.txt to 0.
 */
function loadNextBatch(totalBatchSize = 51) {
  if (!fs.existsSync(CSV_FILE)) {
    throw new Error(`Master leads dataset not found at ${CSV_FILE}`);
  }

  const perAngle = Math.floor(totalBatchSize / 3);
  const seen = getSeenDomains();

  const angle1Leads = []; // Agency & MSP
  const angle2Leads = []; // High-Value B2B
  const angle3Leads = []; // Operations & Logistics

  const lines = fs.readFileSync(CSV_FILE, 'utf8').split('\n');
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Parse CSV handling quoted fields
    const cols = [];
    let cur = '', inQuotes = false;
    for (let j = 0; j < line.length; j++) {
      const c = line[j];
      if (c === '"') inQuotes = !inQuotes;
      else if (c === ',' && !inQuotes) { cols.push(cur.trim()); cur = ''; }
      else cur += c;
    }
    cols.push(cur.trim());

    const cluster = cols[19] || '';
    const name = cols[3] || '';
    const kw = (cols[2] || '').toLowerCase();
    const nameLow = name.toLowerCase();

    if (B2C_BLACKLIST.test(nameLow)) continue;

    const url = getBestUrl(cols);
    if (!url) continue;

    const d = extractDomain(url);
    if (!d || seen.has(d) || BAD_DOMAINS.has(d)) continue;
    if (B2C_BLACKLIST.test(d)) continue;

    const cleanName = cleanCompanyName(name);
    if (cleanName.length < 2) continue;

    const leadItem = {
      name: cleanName,
      fullName: name,
      domain: d,
      url,
      cluster,
      keyword: cols[2] || '',
      phone: cols[7] || '',
      email: cols[12] || ''
    };

    // ANGLE 1: MARKETING AGENCIES & MSPS
    if (cluster === 'Agency_MSP' && angle1Leads.length < perAngle) {
      if (['digital marketing agency', 'web design agency', 'creative agency', 'it managed services'].some(k => kw.includes(k))) {
        seen.add(d);
        angle1Leads.push(leadItem);
      }
    }
    // ANGLE 2: HIGH-VALUE B2B
    else if (cluster === 'HighValue_B2B' && angle2Leads.length < perAngle) {
      if (['recruitment agency', 'executive search', 'corporate secretarial services', 'business consulting firm', 'accounting firm'].some(k => kw.includes(k))) {
        seen.add(d);
        angle2Leads.push(leadItem);
      }
    }
    // ANGLE 3: OPERATIONS & LOGISTICS & EQUIPMENT
    else if (cluster === 'Operations_Wholesale' && angle3Leads.length < perAngle) {
      if (['logistics company', 'freight forwarding', 'equipment supplier', 'trading company', 'wholesale distributor'].some(k => kw.includes(k))) {
        seen.add(d);
        angle3Leads.push(leadItem);
      }
    }

    if (angle1Leads.length === perAngle && angle2Leads.length === perAngle && angle3Leads.length === perAngle) {
      break;
    }
  }

  const selectedBatch = [...angle1Leads, ...angle2Leads, ...angle3Leads];
  if (selectedBatch.length === 0) {
    throw new Error('No more fresh leads available in dataset matching ICP filters.');
  }

  // Write URLs to retry_urls.txt
  const urlListContent = selectedBatch.map(l => l.url).join('\n') + '\n';
  fs.writeFileSync(URL_FILE, urlListContent, 'utf8');

  // Reset progress.txt to 0
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(PROGRESS_FILE, '0\n', 'utf8');

  return {
    total: selectedBatch.length,
    angle1: angle1Leads,
    angle2: angle2Leads,
    angle3: angle3Leads,
    all: selectedBatch
  };
}

module.exports = { loadNextBatch, getSeenDomains };

