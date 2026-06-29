import { loadConfig } from './config.js';
import { Logger } from './logger.js';
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
  Logger.info({ message: 'Sync completed', operation: 'sync', ...result });
  return result;
}

async function runScheduled(config, intervalMinutes) {
  let running = false;
  let timer;

  const tick = async (reason) => {
    if (running) {
      Logger.warn({
        message: 'Skipping scheduled run — previous sync still in progress',
        operation: 'sync',
        reason,
      });
      return;
    }

    running = true;
    Logger.info({
      message: 'Starting sync run',
      operation: 'sync',
      reason: reason ?? 'scheduled',
      startedAt: new Date().toISOString(),
    });

    try {
      await runOnce(config);
    } catch (error) {
      Logger.error({ message: 'Sync run failed', operation: 'sync', error });
    } finally {
      running = false;
    }
  };

  const shutdown = (signal) => {
    Logger.info({ message: 'Stopping scheduler', operation: 'sync', signal });
    if (timer) {
      clearInterval(timer);
    }
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  Logger.info({
    message: 'Scheduler active',
    operation: 'sync',
    intervalMinutes,
  });
  await tick('initial');

  timer = setInterval(() => {
    tick('scheduled').catch((error) => {
      Logger.error({ message: 'Scheduler tick failed', operation: 'sync', error });
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
  Logger.error({ message: 'Sync process failed', operation: 'sync', error });
  process.exitCode = 1;
});
