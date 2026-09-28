export function logFailure(context, error) {
  // Error objects can contain API keys in Axios config or upstream bodies.
  const status = Number(error?.status || error?.response?.status);
  console.error(context, { category: 'request_failed', status: Number.isInteger(status) ? status : undefined });
}
