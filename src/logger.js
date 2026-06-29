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
    message,
    ...(operation ? { operation } : {}),
    ...extra,
  };

  if (error instanceof Error) {
    return {
      ...base,
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

    return {
      ...args,
      ...base,
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
  const { timestamp, level, message, service, stack, ...context } = formatted;
  const prefix = `[${service}] [${level}]`;

  if (message) {
    const contextKeys = Object.keys(context).filter(
      (key) => context[key] !== undefined && key !== 'error' && key !== 'errorType',
    );

    if (contextKeys.length === 0) {
      return `${prefix} ${message}`;
    }

    return `${prefix} ${message} ${JSON.stringify(context)}`;
  }

  return `${prefix} ${JSON.stringify(formatted)}`;
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
