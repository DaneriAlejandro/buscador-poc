import { loadConfig } from './config.js';
import { syncIndex } from './sync.js';

function parseIntervalMinutes() {
  const flagIndex = process.argv.indexOf('--interval');
  if (flagIndex !== -1) {
    const value = process.argv[flagIndex + 1];
    if (!value || value.startsWith('-')) {
      throw new Error('Missing value for --interval (minutes)');
    }
    return Number(value);
  }

  const raw = process.env.SYNC_INTERVAL_MINUTES?.trim();
  if (!raw) {
    return null;
  }

  return Number(raw);
}

function assertIntervalMinutes(minutes) {
  if (!Number.isFinite(minutes) || minutes <= 0) {
    throw new Error('Sync interval must be a positive number of minutes');
  }

  return minutes;
}

async function runOnce(config) {
  const result = await syncIndex(config);
  console.log('[sync] Summary:', JSON.stringify(result));
  return result;
}

async function runScheduled(config, intervalMinutes) {
  let running = false;
  let timer;

  const tick = async (reason) => {
    if (running) {
      console.log('[sync] Skipping scheduled run — previous sync still in progress');
      return;
    }

    running = true;
    const label = reason ? ` (${reason})` : '';
    console.log(`[sync] Starting run${label} at ${new Date().toISOString()}`);

    try {
      await runOnce(config);
    } catch (error) {
      console.error('[sync] Failed:', error.message);
    } finally {
      running = false;
    }
  };

  const shutdown = (signal) => {
    console.log(`[sync] Received ${signal}, stopping scheduler`);
    if (timer) {
      clearInterval(timer);
    }
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  console.log(`[sync] Scheduler active — every ${intervalMinutes} minute(s)`);
  await tick('initial');

  timer = setInterval(() => {
    tick('scheduled').catch((error) => {
      console.error('[sync] Scheduler tick failed:', error.message);
    });
  }, intervalMinutes * 60 * 1000);
}

async function main() {
  const config = loadConfig();
  const intervalMinutes = parseIntervalMinutes();

  if (intervalMinutes == null) {
    await runOnce(config);
    return;
  }

  await runScheduled(config, assertIntervalMinutes(intervalMinutes));
}

main().catch((error) => {
  console.error('[sync] Failed:', error.message);
  process.exitCode = 1;
});
