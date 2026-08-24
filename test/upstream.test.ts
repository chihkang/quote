import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchWithRetry, UpstreamDeadlineError, UpstreamTimeoutError } from '../src/upstream';

describe('upstream transport', () => {
	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it('retries transient HTTP failures and returns the eventual response', async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(new Response('temporary failure', { status: 503 }))
			.mockResolvedValueOnce(new Response('ok', { status: 200 }));
		vi.stubGlobal('fetch', fetchMock);
		const sleep = vi.fn(async () => undefined);

		const response = await fetchWithRetry(
			'https://example.test/quote',
			{},
			{},
			{ maxAttempts: 3, retryBaseMs: 10, retryMaxDelayMs: 100, sleep, random: () => 0 }
		);

		expect(response.status).toBe(200);
		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(sleep).toHaveBeenCalledWith(10);
	});

	it('does not retry non-transient client errors', async () => {
		const fetchMock = vi.fn().mockResolvedValue(new Response('invalid symbol', { status: 400 }));
		vi.stubGlobal('fetch', fetchMock);

		const response = await fetchWithRetry(
			'https://example.test/quote',
			{},
			{},
			{ maxAttempts: 3, sleep: vi.fn(async () => undefined) }
		);

		expect(response.status).toBe(400);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('uses a bounded Retry-After delay for 429 responses', async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(new Response('rate limited', { status: 429, headers: { 'Retry-After': '30' } }))
			.mockResolvedValueOnce(new Response('ok', { status: 200 }));
		vi.stubGlobal('fetch', fetchMock);
		const sleep = vi.fn(async () => undefined);

		await fetchWithRetry(
			'https://example.test/quote',
			{},
			{},
			{ maxAttempts: 2, retryBaseMs: 10, retryMaxDelayMs: 100, sleep, random: () => 0 }
		);

		expect(sleep).toHaveBeenCalledWith(100);
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it('raises a timeout error after the final timed-out attempt', async () => {
		const fetchMock = vi.fn(
			(_input: RequestInfo | URL, init?: RequestInit) =>
				new Promise<Response>((_resolve, reject) => {
					init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
				})
		);
		vi.stubGlobal('fetch', fetchMock);

		await expect(
			fetchWithRetry(
				'https://example.test/quote',
				{},
				{},
				{ timeoutMs: 1, maxAttempts: 1, sleep: vi.fn(async () => undefined) }
			)
		).rejects.toBeInstanceOf(UpstreamTimeoutError);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('stops retries when the request-level deadline is reached', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date(0));
		const fetchMock = vi.fn().mockResolvedValue(new Response('temporary failure', { status: 503 }));
		vi.stubGlobal('fetch', fetchMock);
		const sleep = vi.fn(async (delayMs: number) => {
			vi.advanceTimersByTime(delayMs);
		});

		await expect(
			fetchWithRetry(
				'https://example.test/quote',
				{},
				{},
				{
					maxAttempts: 3,
					retryBaseMs: 80,
					retryMaxDelayMs: 100,
					deadlineAtMs: 100,
					sleep,
					random: () => 0
				}
			)
		).rejects.toBeInstanceOf(UpstreamDeadlineError);

		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(sleep).toHaveBeenNthCalledWith(1, 80);
		expect(sleep).toHaveBeenNthCalledWith(2, 20);
	});
});
