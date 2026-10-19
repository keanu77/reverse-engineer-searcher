function collectSecretFragments(error) {
  const secrets = new Set();
  const add = (value) => {
    if (typeof value === 'string' && value.length >= 8) secrets.add(value);
  };

  const config = error?.config;
  if (config && typeof config === 'object') {
    add(config.apiKey);
    add(config.key);
    add(config.params?.api_key);
    add(config.params?.apiKey);
    const headers = config.headers;
    if (headers && typeof headers === 'object') {
      for (const [name, value] of Object.entries(headers)) {
        if (/authorization|api-?key|token|secret/i.test(name)) add(value);
      }
    }
  }

  for (const [name, value] of Object.entries(process.env)) {
    if (/KEY|TOKEN|SECRET|PASSWORD|AUTH/i.test(name)) add(value);
  }

  return secrets;
}

function safeMessage(error) {
  if (typeof error?.message !== 'string') return undefined;
  let message = error.message;
  for (const secret of collectSecretFragments(error)) {
    if (message.includes(secret)) {
      message = message.split(secret).join('[REDACTED]');
    }
  }
  return message.slice(0, 200);
}

export function logFailure(context, error) {
  // Never dump axios/openai config, headers, Authorization, apiKey, or full response bodies.
  // Log only safe fields; scrub known secret fragments from message before truncating.
  const statusRaw = error?.status ?? error?.response?.status;
  const status = Number(statusRaw);
  console.error(context, {
    category: 'request_failed',
    status: Number.isInteger(status) ? status : undefined,
    name: typeof error?.name === 'string' ? error.name : undefined,
    message: safeMessage(error),
    code: error?.code != null ? String(error.code) : undefined,
  });
}
