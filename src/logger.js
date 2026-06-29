const SERVICE_NAME = process.env.SERVICE_NAME?.trim() || 'meilisearch-sync';
const USE_DATADOG_FORMAT = process.env.NODE_ENV?.toLowerCase() === 'production';

function formatUnknownError(error) {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'object' && error !== null) {
    try {
      return structuredClone(error);
    } catch {
      return 'Unserializable error object';
    }
  }

  if (error == null) {
    return 'error is null or undefined';
  }

  return String(error);
}

function buildExceptionLog(input) {
  const { message, error, operation, ...extra } = input;
  const base = {
    message: enrichMessage(message, extra),
    ...(operation ? { operation } : {}),
    ...extra,
  };

  if (error instanceof Error) {
    return {
      ...base,
      message: `${enrichMessage(message, extra)}: ${error.message}`,
      error: error.message,
      errorType: error.name,
      stack: error.stack,
    };
  }

  return {
    ...base,
    error: formatUnknownError(error),
  };
}

function enrichMessage(message, fields = {}) {
  const parts = [];

  if (fields.processed != null && fields.total != null) {
    const pct = Math.round((fields.processed / fields.total) * 100);
    parts.push(`${fields.processed}/${fields.total} (${pct}%)`);
  }

  if (fields.batchNumber != null && fields.batchCount != null) {
    parts.push(`batch ${fields.batchNumber}/${fields.batchCount}`);
  }

  if (fields.rowCount != null) {
    parts.push(`${fields.rowCount} rows`);
  }

  if (fields.upserted != null) {
    parts.push(`${fields.upserted} upserted`);
  }

  if (fields.deleted != null) {
    parts.push(`${fields.deleted} deleted`);
  }

  if (fields.elapsedSeconds != null) {
    parts.push(`${fields.elapsedSeconds}s`);
  }

  if (fields.indexName) {
    parts.push(fields.indexName);
  }

  if (fields.reason) {
    parts.push(String(fields.reason));
  }

  if (fields.intervalMinutes != null) {
    parts.push(`every ${fields.intervalMinutes}m`);
  }

  if (parts.length === 0) {
    return message;
  }

  return `${message} | ${parts.join(' | ')}`;
}

function formatMessage(level, args) {
  const base = {
    timestamp: new Date().toISOString(),
    level: level.toUpperCase(),
    service: SERVICE_NAME,
  };

  if (typeof args === 'string') {
    return { ...base, message: args };
  }

  if (args instanceof Error) {
    return {
      ...base,
      message: args.message,
      name: args.name,
      stack: args.stack,
    };
  }

  if (args !== null && typeof args === 'object') {
    if (Array.isArray(args)) {
      return { ...base, data: args };
    }

    if (args instanceof Date) {
      return { ...base, value: args.toISOString() };
    }

    const { message, ...fields } = args;
    return {
      ...fields,
      ...base,
      message: enrichMessage(message, fields),
    };
  }

  return { ...base, value: args };
}

function write(level, payload) {
  const formatted = formatMessage(level, payload);
  const output = USE_DATADOG_FORMAT ? JSON.stringify(formatted) : formatDevLine(formatted);

  if (level === 'error') {
    console.error(output);
    if (!USE_DATADOG_FORMAT && typeof formatted.stack === 'string') {
      console.error(formatted.stack);
    }
    return;
  }

  if (level === 'warn') {
    console.warn(output);
    return;
  }

  if (level === 'debug') {
    console.debug(output);
    return;
  }

  console.info(output);
}

function formatDevLine(formatted) {
  const { message, service, level } = formatted;
  return `[${service}] [${level}] ${message}`;
}

export const Logger = {
  error(input) {
    write('error', buildExceptionLog(input));
  },

  warn(message) {
    write('warn', message);
  },

  info(message) {
    write('info', message);
  },

  debug(message) {
    write('debug', message);
  },
};

export function shouldLogProgress(batchNumber, batchCount, milestones = 4) {
  if (batchCount <= 0) {
    return false;
  }

  if (batchNumber === batchCount) {
    return true;
  }

  const interval = Math.max(1, Math.ceil(batchCount / milestones));
  return batchNumber % interval === 0;
}
