#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawn, execSync } = require('child_process');
const { notify } = require('./notifier');
const { loadNextBatch } = require('./batch_loader');
const { URL_FILE, OUTPUT_DIR, PROGRESS_FILE } = require('./config');

// Prevent crash when terminal emulator is closed (EPIPE)
process.stdout.on('error', (err) => {
  if (err.code === 'EPIPE') return;
});
process.stderr.on('error', (err) => {
  if (err.code === 'EPIPE') return;
});

// ── Configuration & Environment Defaults ─────────────────────────────────────
const TIMEZONE = process.env.TARGET_TIMEZONE || 'Asia/Singapore';
const WORK_START_HOUR = parseInt(process.env.WORK_START_HOUR || '8', 10);   // 8 AM SGT
const WORK_END_HOUR   = parseInt(process.env.WORK_END_HOUR   || '20', 10);  // 8 PM SGT
const WORK_DAYS = (process.env.WORK_DAYS || '1,2,3,4,5').split(',').map(d => parseInt(d.trim(), 10)); // Mon-Fri
const BATCH_SIZE = parseInt(process.env.BATCH_SIZE || '51', 10);
const MAX_BATCHES_PER_DAY = parseInt(process.env.MAX_BATCHES_PER_DAY || '3', 10);
const MIN_BREAK_MINUTES = parseInt(process.env.MIN_BREAK_MINUTES || '75', 10); // 1h 15m
const MAX_BREAK_MINUTES = parseInt(process.env.MAX_BREAK_MINUTES || '120', 10); // 2h 00m
const AUTO_GIT_PUSH = process.env.AUTO_GIT_PUSH !== 'false'; // Default true

const LOCK_FILE = path.join(OUTPUT_DIR, 'orchestrator.lock');
const STATUS_JSON = path.join(OUTPUT_DIR, 'status.json');
const STATUS_TXT = path.join(OUTPUT_DIR, 'status.txt');

let currentChildProcess = null;
let isShuttingDown = false;
let completedBatchesToday = 0;
let lastBatchDateStr = '';

// ── Timezone & Operating Hours Utilities ──────────────────────────────────────
function getTargetTime() {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    weekday: 'short',
    hour12: false
  });

  const parts = {};
  for (const { type, value } of formatter.formatToParts(now)) {
    parts[type] = value;
  }

  // Days: 0=Sun, 1=Mon, ..., 6=Sat
  const dayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const day = dayMap[parts.weekday] !== undefined ? dayMap[parts.weekday] : now.getDay();
  const hour = parseInt(parts.hour, 10);
  const minute = parseInt(parts.minute, 10);
  const second = parseInt(parts.second, 10);
  const dateStr = `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
  const timeStr = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')} SGT`;

  return { day, hour, minute, second, dateStr, timeStr, rawDate: now };
}

function checkOperatingHours() {
  const t = getTargetTime();
  const isWorkDay = WORK_DAYS.includes(t.day);
  const isWorkHour = t.hour >= WORK_START_HOUR && t.hour < WORK_END_HOUR;

  if (isWorkDay && isWorkHour) {
    return { inWindow: true, targetTime: t };
  }

  // Calculate approximate ms until the next 08:00 SGT window
  let daysToAdd = 0;
  if (t.hour >= WORK_END_HOUR) {
    // Window passed today, next window is at least tomorrow
    daysToAdd = 1;
  }
  let targetDay = (t.day + daysToAdd) % 7;
  while (!WORK_DAYS.includes(targetDay)) {
    daysToAdd++;
    targetDay = (t.day + daysToAdd) % 7;
  }

  // Hours left to 08:00
  let hoursUntil = (24 - t.hour + WORK_START_HOUR) % 24;
  if (daysToAdd > 1) {
    hoursUntil += (daysToAdd - 1) * 24;
  }
  const msUntil = (hoursUntil * 3600 - t.minute * 60 - t.second) * 1000;

  return {
    inWindow: false,
    targetTime: t,
    msUntilNextWindow: Math.max(msUntil, 60000),
    reason: !isWorkDay ? 'Weekend / Non-working day' : 'Outside 8:00 AM – 8:00 PM SGT operating window'
  };
}

// ── Status Persistence & Lockfile ─────────────────────────────────────────────
function updateStatus(state, extra = {}) {
  const t = getTargetTime();
  const data = {
    state,
    pid: process.pid,
    singapore_time: t.timeStr,
    date: t.dateStr,
    today_batches_completed: completedBatchesToday,
    max_daily_batches: MAX_BATCHES_PER_DAY,
    last_updated: new Date().toISOString(),
    ...extra
  };

  try {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    fs.writeFileSync(STATUS_JSON, JSON.stringify(data, null, 2), 'utf8');
    const summaryLine = `[${t.timeStr}] State: ${state.toUpperCase()} | Batches Today: ${completedBatchesToday}/${MAX_BATCHES_PER_DAY} | ${extra.message || ''}\n`;
    fs.writeFileSync(STATUS_TXT, summaryLine, 'utf8');
  } catch (_) {}
}

function acquireLock() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  if (fs.existsSync(LOCK_FILE)) {
    const rawPid = fs.readFileSync(LOCK_FILE, 'utf8').trim();
    const pid = parseInt(rawPid, 10);
    if (!isNaN(pid) && pid !== process.pid) {
      try {
        // Test if another process is still running
        process.kill(pid, 0);
        console.log(`⚠️ Another instance of orchestrator is already running (PID: ${pid}).`);
        console.log(`   To check status: node orchestrator.js --status`);
        console.log(`   To stop it:       node orchestrator.js --stop`);
        process.exit(1);
      } catch (_) {
        // PID is dead, stale lockfile can be removed safely
        console.log(`🧹 Removing stale lockfile from prior crashed session (PID: ${pid}).`);
      }
    }
  }
  fs.writeFileSync(LOCK_FILE, String(process.pid), 'utf8');
}

function releaseLock() {
  try {
    if (fs.existsSync(LOCK_FILE)) {
      const rawPid = fs.readFileSync(LOCK_FILE, 'utf8').trim();
      if (parseInt(rawPid, 10) === process.pid) {
        fs.unlinkSync(LOCK_FILE);
      }
    }
  } catch (_) {}
}

// ── Git Sync ──────────────────────────────────────────────────────────────────
function syncGitAfterBatch(batchNum) {
  if (!AUTO_GIT_PUSH) return;
  console.log(`\n📦 Committing & syncing Batch #${batchNum} to GitHub...`);
  try {
    // 1. Clear any stale index.lock if present
    const indexLock = path.resolve(__dirname, '.git/index.lock');
    if (fs.existsSync(indexLock)) {
      try { fs.unlinkSync(indexLock); } catch (_) {}
    }

    execSync('git add form_results/ retry_urls.txt', { cwd: __dirname, stdio: 'pipe' });
    const msg = `chore(batch): completed batch #${batchNum} [${getTargetTime().dateStr}] - form results & queue update`;
    execSync(`git commit -m "${msg}"`, { cwd: __dirname, stdio: 'pipe' });
    console.log(`   ✅ Committed: "${msg}"`);

    // Non-fatal push
    execSync('git push origin HEAD', { cwd: __dirname, stdio: 'pipe', timeout: 30000 });
    console.log(`   🚀 Pushed cleanly to GitHub.`);
    updateStatus('synced', { message: `Git synced Batch #${batchNum}` });
  } catch (err) {
    console.log(`   ⚠️ Git push skipped or offline: ${err.message ? err.message.split('\n')[0] : 'Network unavailable'}`);
    console.log(`   (Data is safe locally in form_results/ and will sync on next batch)`);
  }
}

// ── Batch Runner with Systemd Inhibitor ───────────────────────────────────────
function runBatchProcess() {
  return new Promise((resolve) => {
    const hasInhibit = fs.existsSync('/usr/bin/systemd-inhibit');
    let bin = 'node';
    let args = ['main.js'];

    if (hasInhibit) {
      bin = 'systemd-inhibit';
      args = [
        '--what=shutdown:sleep:idle:handle-lid-switch',
        '--who=DigiForge Outreach Automation',
        '--why=Active Singapore outreach batch in progress',
        '--mode=block',
        'node',
        'main.js'
      ];
    }

    console.log(`\n▶️  Launching batch engine (${hasInhibit ? 'Protected by systemd-inhibit lock' : 'Direct execution'})...`);
    currentChildProcess = spawn(bin, args, { cwd: __dirname, stdio: 'inherit' });

    currentChildProcess.on('exit', (code, signal) => {
      currentChildProcess = null;
      resolve({ code, signal });
    });

    currentChildProcess.on('error', (err) => {
      console.error(`❌ Batch execution error:`, err);
      currentChildProcess = null;
      resolve({ code: 1, error: err });
    });
  });
}

// ── Sleep with Periodic Ticking (Resilient to PC Sleep/Suspension) ────────────
async function sleepTick(totalMs, statusMsg) {
  const endTime = Date.now() + totalMs;
  while (Date.now() < endTime && !isShuttingDown) {
    const remainingMs = endTime - Date.now();
    const remainingMins = Math.ceil(remainingMs / 60000);
    const t = getTargetTime();

    updateStatus('cooldown', {
      message: `${statusMsg} (${remainingMins}m remaining)`,
      next_wake_sgt: new Date(Date.now() + remainingMs).toLocaleTimeString('en-US', { timeZone: TIMEZONE })
    });

    process.stdout.write(`\r   [${t.timeStr}] ☕ ${statusMsg}: ${remainingMins} mins remaining...   `);

    // Sleep in 30-second ticks so it notices laptop wake or system time jumps immediately
    const tickMs = Math.min(remainingMs, 30000);
    await new Promise(r => setTimeout(r, tickMs));
  }
  process.stdout.write('\n');
}

// ── Main Orchestration Loop ──────────────────────────────────────────────────
async function startOrchestrator() {
  acquireLock();
  console.log(`\n═══════════════════════════════════════════════════════════════`);
  console.log(`   DIGIFORGE CONSULTING SG — AUTONOMOUS OUTREACH ORCHESTRATOR`);
  console.log(`   Target Timezone:    ${TIMEZONE}`);
  console.log(`   Operating Window:   ${WORK_START_HOUR}:00 to ${WORK_END_HOUR}:00 SGT (Mon-Fri)`);
  console.log(`   Pacing:             ${MIN_BREAK_MINUTES}–${MAX_BREAK_MINUTES}m break between batches`);
  console.log(`   Daily Cap:          ${MAX_BATCHES_PER_DAY} batches/day (~${MAX_BATCHES_PER_DAY * BATCH_SIZE} leads)`);
  console.log(`   Process PID:        ${process.pid}`);
  console.log(`═══════════════════════════════════════════════════════════════\n`);

  notify('🚀 DigiForge: Service Active', `Outreach supervisor running (PID: ${process.pid}). Operating 8am–8pm SGT.`);

  while (!isShuttingDown) {
    const t = getTargetTime();

    // Reset daily batch counter when new day begins
    if (t.dateStr !== lastBatchDateStr) {
      completedBatchesToday = 0;
      lastBatchDateStr = t.dateStr;
    }

    // 1. Operating Window Check
    const hoursCheck = checkOperatingHours();
    if (!hoursCheck.inWindow) {
      console.log(`\n🌙 [${t.timeStr}] ${hoursCheck.reason}.`);
      const wakeHours = (hoursCheck.msUntilNextWindow / 3600000).toFixed(1);
      console.log(`   Sleeping until 08:00 SGT next business window (~${wakeHours} hours)...`);
      notify('🌙 DigiForge: Day Complete', `Outside Singapore business hours (8am–8pm SGT). Sleeping until 08:00 SGT tomorrow.`);
      await sleepTick(hoursCheck.msUntilNextWindow, 'Sleeping until next business window');
      continue;
    }

    // 2. Daily Batch Quota Check
    if (completedBatchesToday >= MAX_BATCHES_PER_DAY) {
      console.log(`\n🎯 [${t.timeStr}] Daily quota reached (${completedBatchesToday}/${MAX_BATCHES_PER_DAY} batches). Protecting domain reputation.`);
      notify('🌙 DigiForge: Day Complete', `Completed all ${MAX_BATCHES_PER_DAY} batches today. Sleeping until 08:00 SGT tomorrow.`);
      // Sleep until 08:00 SGT next day
      const untilTomorrow = checkOperatingHours();
      await sleepTick(untilTomorrow.msUntilNextWindow || 3600000, 'Daily quota complete. Resting until tomorrow');
      continue;
    }

    // 3. Incomplete Batch Check (Crash Recovery)
    let hasIncompleteBatch = false;
    if (fs.existsSync(URL_FILE) && fs.existsSync(PROGRESS_FILE)) {
      const urls = fs.readFileSync(URL_FILE, 'utf8').split('\n').map(l => l.trim()).filter(Boolean);
      const progress = parseInt(fs.readFileSync(PROGRESS_FILE, 'utf8').trim() || '0', 10);
      if (urls.length > 0 && progress > 0 && progress < urls.length) {
        hasIncompleteBatch = true;
        console.log(`\n🔄 Found interrupted batch at lead #${progress + 1} of ${urls.length}! Resuming seamlessly...`);
        notify('🔄 DigiForge: Resuming Batch', `Resuming incomplete batch from lead #${progress + 1}/${urls.length}.`);
      }
    }

    // 4. Generate New Batch if Needed
    if (!hasIncompleteBatch) {
      console.log(`\n📋 Generating fresh batch of ${BATCH_SIZE} curated leads (17 Agency, 17 B2B, 17 Wholesale)...`);
      try {
        const batchInfo = loadNextBatch(BATCH_SIZE);
        console.log(`   ✅ Loaded ${batchInfo.total} fresh leads into retry_urls.txt (Progress reset to 0).`);
        notify('🚀 DigiForge: Batch Started', `Processing Batch #${completedBatchesToday + 1} (${batchInfo.total} leads: 17 Agency, 17 B2B, 17 Wholesale)`);
      } catch (err) {
        console.error(`❌ Batch generation error: ${err.message}`);
        notify('⚠️ DigiForge: Notice', `Batch generation failed: ${err.message}`, { urgency: 'critical' });
        await sleepTick(300000, 'Error cooldown');
        continue;
      }
    }

    // 5. Execute Batch
    updateStatus('running', { 
      message: `Batch in progress (Attempt #${completedBatchesToday + 1})`,
      inhibiting_shutdown: true 
    });
    const batchResult = await runBatchProcess();
    updateStatus('running', { inhibiting_shutdown: false });

    if (isShuttingDown) break;

    completedBatchesToday++;
    console.log(`\n🏁 [${getTargetTime().timeStr}] Batch #${completedBatchesToday} execution finished.`);
    notify('✅ DigiForge: Batch Finished', `Batch #${completedBatchesToday} complete! Results recorded, leads added to Cold Email queue & Git synced.`);

    // 6. Git Sync
    syncGitAfterBatch(completedBatchesToday);

    // 7. Calculate Randomized Cooldown Break (e.g. 75 - 120 minutes)
    const breakMins = Math.floor(Math.random() * (MAX_BREAK_MINUTES - MIN_BREAK_MINUTES + 1)) + MIN_BREAK_MINUTES;
    const breakMs = breakMins * 60 * 1000;
    const nextRunTime = new Date(Date.now() + breakMs).toLocaleTimeString('en-US', { timeZone: TIMEZONE });

    console.log(`\n☕ Entering cooldown break of ${breakMins} minutes. Next batch scheduled at ~${nextRunTime} SGT.`);
    notify('☕ DigiForge: Cooldown', `Taking a ${breakMins}-minute break. Next batch scheduled at ${nextRunTime} SGT.`);

    await sleepTick(breakMs, `Resting between batches`);
  }

  cleanupAndExit(0);
}

// ── Graceful Shutdown Handler ────────────────────────────────────────────────
function cleanupAndExit(code = 0) {
  isShuttingDown = true;
  console.log(`\n🛑 Graceful shutdown initiated...`);

  if (currentChildProcess) {
    console.log(`   Terminating active child process...`);
    try {
      currentChildProcess.kill('SIGTERM');
    } catch (_) {}
  }

  updateStatus('stopped', { message: 'Orchestrator stopped cleanly' });
  releaseLock();
  notify('🛑 DigiForge: Service Stopped', 'Outreach orchestrator stopped cleanly. All progress preserved.');
  process.exit(code);
}

process.on('SIGINT', () => cleanupAndExit(0));
process.on('SIGTERM', () => cleanupAndExit(0));
// When running in a terminal that gets closed, do NOT kill orchestrator — continue in background
process.on('SIGHUP', () => {
  try {
    const t = getTargetTime();
    console.log(`[${t.timeStr}] ℹ️ Controlling terminal closed (SIGHUP). Orchestrator continues in background.`);
  } catch (_) {}
});

// ── CLI Command Handling (--status, --stop) ──────────────────────────────────
const args = process.argv.slice(2);
if (args.includes('--status')) {
  if (fs.existsSync(STATUS_JSON)) {
    const s = JSON.parse(fs.readFileSync(STATUS_JSON, 'utf8'));
    console.log(`\n📊 DIGIFORGE OUTREACH STATUS`);
    console.log(`   State:                   ${(s.state || 'unknown').toUpperCase()}`);
    console.log(`   PID:                     ${s.pid}`);
    console.log(`   Singapore Time:          ${s.singapore_time}`);
    console.log(`   Batches Completed Today: ${s.today_batches_completed} / ${s.max_daily_batches}`);
    console.log(`   Message:                 ${s.message || 'None'}`);
    console.log(`   Last Updated:            ${s.last_updated}\n`);
  } else {
    console.log('No active status found. Orchestrator has not been started yet.');
  }
  process.exit(0);
}

if (args.includes('--stop')) {
  if (fs.existsSync(LOCK_FILE)) {
    const pid = parseInt(fs.readFileSync(LOCK_FILE, 'utf8').trim(), 10);
    if (!isNaN(pid)) {
      try {
        process.kill(pid, 'SIGTERM');
        console.log(`✅ Sent stop signal to running orchestrator (PID: ${pid}).`);
      } catch (err) {
        console.log(`⚠️ Orchestrator (PID: ${pid}) was not running.`);
        try { fs.unlinkSync(LOCK_FILE); } catch (_) {}
      }
    }
  } else {
    console.log('Orchestrator is not currently running.');
  }
  process.exit(0);
}

// Start
startOrchestrator();

