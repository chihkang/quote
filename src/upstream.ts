export type UpstreamRetryEnv = {
	UPSTREAM_TIMEOUT_MS?: string;
	UPSTREAM_MAX_ATTEMPTS?: string;
	UPSTREAM_RETRY_BASE_MS?: string;
	UPSTREAM_RETRY_MAX_DELAY_MS?: string;
	UPSTREAM_REQUEST_DEADLINE_MS?: string;
};

export type FetchRetryOptions = {
	timeoutMs?: number;
	maxAttempts?: number;
	retryBaseMs?: number;
	retryMaxDelayMs?: number;
	deadlineAtMs?: number;
	sleep?: (delayMs: number) => Promise<void>;
	random?: () => number;
};

const DEFAULT_TIMEOUT_MS = 3000;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_RETRY_BASE_MS = 200;
const DEFAULT_RETRY_MAX_DELAY_MS = 2000;

export class HttpStatusError extends Error {
	status: number;

	constructor(message: string, status: number) {
		super(message);
		this.name = 'HttpStatusError';
		this.status = status;
	}
}

export class UpstreamTimeoutError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'UpstreamTimeoutError';
	}
}

export class UpstreamDeadlineError extends Error {
	constructor(message = 'Upstream request deadline exceeded') {
		super(message);
		this.name = 'UpstreamDeadlineError';
	}
}

function readNonNegativeNumber(value: number | string | undefined, fallback: number): number {
	const parsed = typeof value === 'number' ? value : Number(value);
	if (!Number.isFinite(parsed) || parsed < 0) return fallback;
	return parsed;
}

function readPositiveInteger(value: number | string | undefined, fallback: number): number {
	const parsed = typeof value === 'number' ? value : Number(value);
	if (!Number.isFinite(parsed) || parsed < 1) return fallback;
	return Math.floor(parsed);
}

function getOptions(
	env: UpstreamRetryEnv,
	options: FetchRetryOptions
): Required<Pick<FetchRetryOptions, 'timeoutMs' | 'maxAttempts' | 'retryBaseMs' | 'retryMaxDelayMs'>> &
	Pick<FetchRetryOptions, 'sleep' | 'random'> {
	return {
		timeoutMs: readPositiveInteger(options.timeoutMs ?? env.UPSTREAM_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
		maxAttempts: readPositiveInteger(options.maxAttempts ?? env.UPSTREAM_MAX_ATTEMPTS, DEFAULT_MAX_ATTEMPTS),
		retryBaseMs: readNonNegativeNumber(
			options.retryBaseMs ?? env.UPSTREAM_RETRY_BASE_MS,
			DEFAULT_RETRY_BASE_MS
		),
		retryMaxDelayMs: readNonNegativeNumber(
			options.retryMaxDelayMs ?? env.UPSTREAM_RETRY_MAX_DELAY_MS,
			DEFAULT_RETRY_MAX_DELAY_MS
		),
		sleep: options.sleep,
		random: options.random
	};
}

function isRetryableStatus(status: number): boolean {
	return status === 429 || status >= 500;
}

function parseRetryAfterMs(value: string | null): number | null {
	if (!value) return null;

	const seconds = Number(value);
	if (Number.isFinite(seconds) && seconds >= 0) {
		return seconds * 1000;
	}

	const dateMs = Date.parse(value);
	if (!Number.isFinite(dateMs)) return null;
	return Math.max(0, dateMs - Date.now());
}

function getRetryDelayMs(
	attempt: number,
	response: Response | null,
	baseMs: number,
	maxDelayMs: number,
	random: () => number
): number {
	const retryAfterMs = parseRetryAfterMs(response?.headers.get('retry-after') ?? null);
	const exponentialMs = baseMs * 2 ** Math.max(0, attempt - 1);
	const requestedMs = retryAfterMs ?? exponentialMs;
	const jitterMs = requestedMs > 0 ? Math.floor(requestedMs * Math.min(1, Math.max(0, random()))) : 0;
	return Math.min(maxDelayMs, Math.max(0, requestedMs + jitterMs));
}

function defaultSleep(delayMs: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function getRemainingMs(deadlineAtMs: number | undefined): number | null {
	if (deadlineAtMs === undefined) return null;
	return Math.max(0, deadlineAtMs - Date.now());
}

export function waitForDeadline<T>(promise: Promise<T>, deadlineAtMs?: number): Promise<T> {
	const remainingMs = getRemainingMs(deadlineAtMs);
	if (remainingMs === null) return promise;
	if (remainingMs <= 0) return Promise.reject(new UpstreamDeadlineError());

	return new Promise<T>((resolve, reject) => {
		let settled = false;
		const timeout = setTimeout(() => {
			settled = true;
			reject(new UpstreamDeadlineError());
		}, remainingMs);

		promise.then(
			(value) => {
				if (settled) return;
				settled = true;
				clearTimeout(timeout);
				resolve(value);
			},
			(error) => {
				if (settled) return;
				settled = true;
				clearTimeout(timeout);
				reject(error);
			}
		);
	});
}

export async function fetchWithRetry(
	input: RequestInfo | URL,
	init: RequestInit,
	env: UpstreamRetryEnv,
	options: FetchRetryOptions = {}
): Promise<Response> {
	const resolved = getOptions(env, options);
	const sleep = resolved.sleep ?? defaultSleep;
	const random = resolved.random ?? Math.random;

	for (let attempt = 1; attempt <= resolved.maxAttempts; attempt += 1) {
		const remainingMs = getRemainingMs(options.deadlineAtMs);
		if (remainingMs !== null && remainingMs <= 0) {
			throw new UpstreamDeadlineError();
		}

		const controller = new AbortController();
		let timedOut = false;
		const attemptTimeoutMs =
			remainingMs === null ? resolved.timeoutMs : Math.min(resolved.timeoutMs, Math.max(1, remainingMs));
		const timeout = setTimeout(() => {
			timedOut = true;
			controller.abort();
		}, attemptTimeoutMs);

		let response: Response | null = null;
		try {
			response = await fetch(input, {
				...init,
				signal: controller.signal
			});
		} catch (error) {
			clearTimeout(timeout);
			if (attempt >= resolved.maxAttempts) {
				if (timedOut) {
					if (options.deadlineAtMs !== undefined && Date.now() >= options.deadlineAtMs) {
						throw new UpstreamDeadlineError();
					}
					throw new UpstreamTimeoutError(`Upstream request timed out after ${resolved.timeoutMs}ms`);
				}
				throw error;
			}

			const delayMs = getRetryDelayMs(
				attempt,
				null,
				resolved.retryBaseMs,
				resolved.retryMaxDelayMs,
				random
			);
			const remainingAfterFailure = getRemainingMs(options.deadlineAtMs);
			if (remainingAfterFailure !== null) {
				if (remainingAfterFailure <= 0) throw new UpstreamDeadlineError();
				await sleep(Math.min(delayMs, remainingAfterFailure));
			} else {
				await sleep(delayMs);
			}
			continue;
		}

		clearTimeout(timeout);
		if (!isRetryableStatus(response.status) || attempt >= resolved.maxAttempts) {
			return response;
		}

		const delayMs = getRetryDelayMs(
			attempt,
			response,
			resolved.retryBaseMs,
			resolved.retryMaxDelayMs,
			random
		);
		const remainingAfterResponse = getRemainingMs(options.deadlineAtMs);
		if (remainingAfterResponse !== null) {
			if (remainingAfterResponse <= 0) throw new UpstreamDeadlineError();
			await sleep(Math.min(delayMs, remainingAfterResponse));
		} else {
			await sleep(delayMs);
		}
	}

	throw new Error('Upstream retry loop exited unexpectedly');
}
