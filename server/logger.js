export function createLogger(config) {
  function write(level, message, meta = {}) {
    const entry = {
      level,
      message,
      app: config.appName,
      env: config.env,
      at: new Date().toISOString(),
      ...meta
    };
    console.log(JSON.stringify(entry));
  }

  return {
    info: (message, meta) => write("info", message, meta),
    warn: (message, meta) => write("warn", message, meta),
    error: (message, meta) => write("error", message, meta)
  };
}
