// ════════════════════════════════════════════════════════════════════════════
// config.js — Central configuration & contact-identity rotator
// Configured for DigiForge Consulting SG (Singapore B2B Outreach)
// ════════════════════════════════════════════════════════════════════════════
"use strict";

const fs = require("fs");
const path = require("path");

// ── Lightweight .env File Loader ─────────────────────────────────────────────
// Automatically reads .env from the project root if present, without external dependencies.
try {
  const envPath = path.resolve(__dirname, ".env");
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, "utf8").split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx !== -1) {
        const key = trimmed.slice(0, eqIdx).trim();
        let val = trimmed.slice(eqIdx + 1).trim();
        if (
          (val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))
        ) {
          val = val.slice(1, -1);
        }
        if (!(key in process.env)) {
          process.env[key] = val;
        }
      }
    }
  }
} catch (_) {}

// ── Spintax Resolver ─────────────────────────────────────────────────────────
// Resolves patterns like "{Hi|Hello|Hey}" into a randomly chosen variation.
function resolveSpintax(text) {
  if (!text) return "";
  let match;
  while ((match = /\{([^{}]+)\}/.exec(text)) !== null) {
    const choices = match[1].split("|");
    const randomChoice = choices[Math.floor(Math.random() * choices.length)];
    text = text.replace(match[0], randomChoice);
  }
  return text;
}

// ── Rotating Sender Identities ───────────────────────────────────────────────
// Uses verified SpaceMail aliases for DigiForge Consulting SG
const envEmail = (process.env.DIGIFORGE_EMAIL || "").trim();

const _CONTACTS = [
  {
    first_name: process.env.DIGIFORGE_FIRST_NAME || "Saifurrahman",
    last_name: process.env.DIGIFORGE_LAST_NAME || "Paul",
    email: envEmail || "partnerships@digiforgeconsulting.com",
  },
  {
    first_name: "Saifurrahman",
    last_name: "Paul",
    email: envEmail || "outreach@digiforgeconsulting.com",
  },
  {
    first_name: "Saifurrahman",
    last_name: "Paul",
    email: envEmail || "partnerships@digiforgeconsulting.com",
  },
];

let _contactIndex = 0;
let _angleRotationIndex = 0;

// ── Fast In-Memory Domain -> Clean Company Name Lookup ─────────────────────
let _leadsMap = null;

function extractDomain(url) {
  try {
    let host = new URL(url).hostname.toLowerCase();
    if (host.startsWith("www.")) host = host.slice(4);
    return host;
  } catch (_) {
    return "";
  }
}

function cleanCompanyName(raw) {
  if (!raw) return "";
  return raw
    .split(/[-–|]/)[0]
    .replace(/\b(pte\.?|ltd\.?|private|limited|llc|pvt\.?)\b/gi, "")
    .trim();
}

function _ensureLeadsMap() {
  if (_leadsMap) return _leadsMap;
  _leadsMap = new Map();
  try {
    const csvPath = path.resolve(__dirname, 'singapore_leads_cleaned.csv');
    if (fs.existsSync(csvPath)) {
      const lines = fs.readFileSync(csvPath, 'utf8').split('\n');
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        // Extract columns handling quoted strings
        const cols = [];
        let cur = '', inQuotes = false;
        for (let j = 0; j < line.length; j++) {
          const c = line[j];
          if (c === '"') inQuotes = !inQuotes;
          else if (c === ',' && !inQuotes) { cols.push(cur.trim()); cur = ''; }
          else cur += c;
        }
        cols.push(cur.trim());

        const rawName = cols[3] || ''; // Name is column index 3
        const name = cleanCompanyName(rawName);
        const cluster = cols[19] || ''; // Cluster is column index 19
        if (name || cluster) {
          const data = { name, cluster };
          for (const u of [cols[17], cols[9], cols[8]]) { // Target_URL (17), Actual (9), Maps (8)
            if (u) {
              const d = extractDomain(u);
              if (d && !_leadsMap.has(d)) _leadsMap.set(d, data);
            }
          }
        }
      }
    }
  } catch (_) {}
  return _leadsMap;
}

function getCompanyInfo(urlOrHint) {
  if (!urlOrHint) return null;
  const map = _ensureLeadsMap();
  const d = extractDomain(urlOrHint);
  return d ? map.get(d) || null : null;
}

function getCompanyName(urlOrHint) {
  const info = getCompanyInfo(urlOrHint);
  return info ? info.name : '';
}

function getCompanyCluster(urlOrHint) {
  const info = getCompanyInfo(urlOrHint);
  return info ? info.cluster : '';
}

// ── 3 Core Singapore & India B2B Outreach Angles ─────────────────────────────
// Angle 1: Marketing Agencies & MSPs (White-Label Tech Partner)
function getAngle1Agency(
  full_name,
  sender_email = "partnerships@digiforgeconsulting.com",
  companyName = "",
) {
  const companyGreeting = companyName ? `${companyName} team` : "team";
  const signoffName = full_name ? full_name.split(" ")[0] : "Saifurrahman";
  const subject = resolveSpintax(
    "{Agency technical delivery overflow|Technical delivery overflow|White-label dev partner for agencies}",
  );

  const message = resolveSpintax(`{Hi|Hello} {team|${companyGreeting}},

{Reaching out regarding technical delivery overflow.|Quick note regarding technical delivery overflow.}

If your core team is focused on {campaigns and creative work|client strategy and campaigns}, do you ever {turn down|delay|backlog} client requests for custom landing pages, Webflow/WordPress builds, or {CRM/API integrations|technical fixes}?

We provide dedicated white-label development for Singapore agencies under your own brand without full-time dev overhead.

{Would you be open to keeping our details on file for the next time overflow comes up?|Open to keeping our contact on hand for when client overflow pops up?}

{Best regards|Kind regards},
${signoffName} | DigiForge Consulting SG
digiforgeconsulting.com`);

  return { subject, message };
}

// Angle 2: High-Value B2B Firms (Speed-to-Lead / WhatsApp Routing)
function getAngle2LeadCapture(
  full_name,
  sender_email = "outreach@digiforgeconsulting.com",
  companyName = "",
) {
  const companyGreeting = companyName ? `${companyName} team` : "team";
  const signoffName = full_name ? full_name.split(" ")[0] : "Saifurrahman";
  const subject = resolveSpintax(
    "{Quick question on inbound lead response|Website inquiry response time|Instant WhatsApp lead routing}",
  );

  const message = resolveSpintax(`{Hi|Hello} {team|${companyGreeting}},

{Quick question regarding inbound lead response:|Reaching out with a quick question on inquiry response time:}

When a prospective client submits an inquiry on your website, does your team receive an instant alert on WhatsApp to follow up immediately, or do leads wait in an inbox for someone to check?

We set up a simple 7-day workflow for Singapore professional firms that routes website inquiries straight into WhatsApp and your CRM so warm leads never wait.

{Open to a quick 2-minute overview of how local firms set this up?|Would you be open to seeing a quick breakdown of how this works?}

{Best regards|Kind regards},
${signoffName} | DigiForge Consulting SG
digiforgeconsulting.com`);

  return { subject, message };
}

// Angle 3: 14-Day Workflow & Order Automation Sprint (Sprint 2)
function getAngle3OrderAutomation(
  full_name,
  sender_email = "partnerships@digiforgeconsulting.com",
  companyName = "",
) {
  const companyGreeting = companyName ? `${companyName} team` : "team";
  const signoffName = full_name ? full_name.split(" ")[0] : "Saifurrahman";
  const subject = resolveSpintax(
    "{Eliminating manual order entry from WhatsApp & email|Automating order-to-invoice in 14 days|Order intake workflow automation}",
  );

  const message = resolveSpintax(`{Hi|Hello} {team|${companyGreeting}},

{Quick operational question regarding order processing:|Reaching out with a quick question on order operations:}

How much time does your team spend manually re-keying customer orders from WhatsApp and PDF emails into your accounting or ERP software?

We build quick, practical automations for Singapore trading and wholesale businesses that turn incoming WhatsApp/email orders directly into draft invoices and delivery orders—eliminating repetitive data entry.

{Open to exploring if we can automate that workflow for you?|Open to a quick 2-minute conversation to see if this fits your workflow?}

{Best regards|Kind regards},
${signoffName} | DigiForge Consulting SG
digiforgeconsulting.com`);

  return { subject, message };
}

// Selects the message angle dynamically based on lead cluster, URL keywords, or round-robin
function selectAnglePayload(urlOrHint, full_name, sender_email) {
  const companyName = getCompanyName(urlOrHint);
  const cluster = getCompanyCluster(urlOrHint);

  // 1. Direct cluster match from cleaned leads dataset
  if (cluster === 'Agency_MSP') {
    return getAngle1Agency(full_name, sender_email, companyName);
  }
  if (cluster === 'HighValue_B2B') {
    return getAngle2LeadCapture(full_name, sender_email, companyName);
  }
  if (cluster === 'Operations_Wholesale') {
    return getAngle3OrderAutomation(full_name, sender_email, companyName);
  }

  // 2. Fallback to pattern detection from URL/domain/hint if cluster unknown
  const lower = (urlOrHint || "").toLowerCase();
  const isAgency =
    /agency|marketing|digital|media|seo|web|design|creative|msp|tech\b|cloud|it-/.test(
      lower,
    );
  const isB2B =
    /recruit|search|talent|headhunt|staffing|secretar|incorporat|account|audit|legal|law|consult|corporate/.test(
      lower,
    );
  const isOperations =
    /wholesale|distribut|trading|import|export|freight|logistics|supply|warehouse|equipment/.test(
      lower,
    );

  if (isAgency) return getAngle1Agency(full_name, sender_email, companyName);
  if (isB2B) return getAngle2LeadCapture(full_name, sender_email, companyName);
  if (isOperations)
    return getAngle3OrderAutomation(full_name, sender_email, companyName);

  // 3. Round-robin rotation if niche is ambiguous or unclassified
  const angleChoosers = [
    getAngle1Agency,
    getAngle2LeadCapture,
    getAngle3OrderAutomation,
  ];
  const chosenFn = angleChoosers[_angleRotationIndex % angleChoosers.length];
  _angleRotationIndex++;
  return chosenFn(full_name, sender_email, companyName);
}

// Returns the next contact in round-robin order, fully expanded for fields.js
function getNextContact(urlOrHint = "") {
  const base = _CONTACTS[_contactIndex % _CONTACTS.length];
  _contactIndex++;

  const full = `${base.first_name} ${base.last_name}`.trim();
  const rawEnvPhone = (process.env.DIGIFORGE_PHONE || "").trim();
  const cleanDigits = rawEnvPhone.replace(/\D/g, "");

  // const isIndia =
  //   rawEnvPhone.includes("+91") ||
  //   cleanDigits.startsWith("91") ||
  //   (process.env.TARGET_REGION || "").toLowerCase() === "india";

  let countryCode = "+65";
  let localDigits = cleanDigits;

  countryCode = "+65";
  localDigits = cleanDigits.startsWith("65")
    ? cleanDigits.slice(2)
    : cleanDigits;
  const rawPhone = `${countryCode} ${localDigits}`;
  const { subject, message } = selectAnglePayload(urlOrHint, full, base.email);

  return {
    first_name: base.first_name,
    last_name: base.last_name,
    full_name: full,
    job_title: "Partnerships & Solutions",
    email: base.email,
    phone: rawPhone,
    phone_country_code: countryCode,
    phone_local: localDigits,
    company: "DigiForge Consulting SG",
    website: "https://digiforgeconsulting.com",
    secondary_website: "https://digiforge.sg",
    country: "Singapore",
    address: "Singapore",
    subject: subject,
    budget: "Flexible",
    message: message,
  };
}

// Default contact for backward compat
const contact = getNextContact();
_contactIndex = 0;
_angleRotationIndex = 0;

// ── File paths & tuning constants ─────────────────────────────────────────────
const URL_FILE = "retry_urls.txt";
const OUTPUT_DIR = "form_results";
const CSV_PATH = `${OUTPUT_DIR}/contact_results.csv`;
const PROGRESS_FILE = `${OUTPUT_DIR}/progress.txt`;
const PAGE_LOAD_TIMEOUT = 20000;
const CAPTCHA_WAIT_TIMEOUT = 20000;
const CAPTCHA_POLICY = "auto";
const TWOCAPTCHA_API_KEY = process.env.TWOCAPTCHA_API_KEY || null;
const CAPSOLVER_API_KEY = process.env.CAPSOLVER_API_KEY || null;
const MAX_CAPTCHA_RETRIES = 1;

const CSV_FIELDS = [
  "url",
  "status",
  "details",
  "load_status",
  "load_time_s",
  "contact_page_status",
  "form_status",
  "fields_filled",
  "filled_fields",
  "failed_fields",
  "validation_status",
  "captcha_status",
  "submit_status",
  "success_status",
];

module.exports = {
  contact,
  getNextContact,
  getCompanyName,
  getCompanyCluster,
  resolveSpintax,
  URL_FILE,
  OUTPUT_DIR,
  CSV_PATH,
  PROGRESS_FILE,
  PAGE_LOAD_TIMEOUT,
  CAPTCHA_WAIT_TIMEOUT,
  CAPTCHA_POLICY,
  TWOCAPTCHA_API_KEY,
  CAPSOLVER_API_KEY,
  MAX_CAPTCHA_RETRIES,
  CSV_FIELDS,
};
