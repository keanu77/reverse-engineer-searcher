/**
 * SafeLogging: only safe error fields; never leak apiKey / Authorization / bodies.
 */
import { jest } from '@jest/globals';
import { logFailure } from '../../src/modules/SafeLogging.js';

describe('SafeLogging.logFailure', () => {
  let errorSpy;

  beforeEach(() => {
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  test('logs context, status, name, truncated message, and code', () => {
    const err = new Error('x'.repeat(250));
    err.name = 'AxiosError';
    err.code = 'ERR_BAD_REQUEST';
    err.status = 401;
    err.config = { headers: { Authorization: 'Bearer secret-key-value' }, apiKey: 'sk-leak-value' };
    err.response = { status: 401, data: { apiKey: 'should-not-appear' } };

    logFailure('unit-test', err);

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const [ctx, payload] = errorSpy.mock.calls[0];
    expect(ctx).toBe('unit-test');
    expect(payload).toEqual({
      category: 'request_failed',
      status: 401,
      name: 'AxiosError',
      message: 'x'.repeat(200),
      code: 'ERR_BAD_REQUEST',
    });
    const serialized = JSON.stringify(errorSpy.mock.calls[0]);
    expect(serialized).not.toMatch(/secret-key-value|sk-leak-value|Authorization|should-not-appear/i);
  });

  test('redacts credential fragments found on error.config from the message', () => {
    const key = 'audit-placeholder-caller';
    const err = Object.assign(new Error(`Rejected credential ${key}`), {
      config: { params: { api_key: key } },
    });
    logFailure('fetch-article', err);
    const serialized = JSON.stringify(errorSpy.mock.calls[0]);
    expect(serialized).not.toContain(key);
    expect(errorSpy.mock.calls[0][1].message).toBe('Rejected credential [REDACTED]');
  });

  test('omits non-integer status and missing optional fields', () => {
    logFailure('bare', { message: 'oops' });
    const [, payload] = errorSpy.mock.calls[0];
    expect(payload.status).toBeUndefined();
    expect(payload.message).toBe('oops');
    expect(payload.name).toBeUndefined();
    expect(payload.code).toBeUndefined();
  });

  test('logs safe cause name and scrubbed, truncated cause message', () => {
    const key = 'cause-secret-placeholder';
    const cause = new TypeError(`Illegal invocation with ${key} ` + 'y'.repeat(300));
    cause.config = { apiKey: key };
    const err = new Error('Connection error.', { cause });
    err.name = 'APIConnectionError';
    logFailure('llm', err);
    const [, payload] = errorSpy.mock.calls[0];
    expect(payload.causeName).toBe('TypeError');
    expect(payload.causeMessage.startsWith('Illegal invocation with [REDACTED] ')).toBe(true);
    expect(payload.causeMessage.length).toBe(200);
    const serialized = JSON.stringify(errorSpy.mock.calls[0]);
    expect(serialized).not.toContain(key);
    expect(serialized).not.toMatch(/config|apiKey/);
  });

  test('redacts env secrets from cause message and omits cause fields when absent', () => {
    const prev = process.env.TEST_CAUSE_API_KEY;
    process.env.TEST_CAUSE_API_KEY = 'env-secret-value-123';
    try {
      const err = new Error('Connection error.', {
        cause: { name: 42, message: 'failed using env-secret-value-123' },
      });
      logFailure('llm', err);
      const [, payload] = errorSpy.mock.calls[0];
      expect(payload.causeName).toBeUndefined();
      expect(payload.causeMessage).toBe('failed using [REDACTED]');
    } finally {
      if (prev === undefined) delete process.env.TEST_CAUSE_API_KEY;
      else process.env.TEST_CAUSE_API_KEY = prev;
    }

    logFailure('bare', new Error('no cause'));
    const [, payload2] = errorSpy.mock.calls[1];
    expect(payload2.causeName).toBeUndefined();
    expect(payload2.causeMessage).toBeUndefined();
  });
});
