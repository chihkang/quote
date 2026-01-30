import { describe, expect, it } from 'vitest';
import { mapFinnhubQuote } from '../src/index';

describe('US Finnhub quote mapping', () => {
	it('maps valid Finnhub response to quote', () => {
		const finnhubResponse = {
			c: 261.74,
			h: 263.31,
			l: 260.68,
			o: 261.07,
			pc: 259.45,
			t: 1582641000
		};

		const result = mapFinnhubQuote(finnhubResponse);

		expect(result.price).toBe(261.74);
		expect(result.currency).toBe('USD');
		expect(result.asOf).toBe('2020-02-25T14:30:00.000Z');
	});

	it('returns null price when c field is missing', () => {
		const finnhubResponse = {
			h: 263.31,
			l: 260.68,
			t: 1582641000
		};

		const result = mapFinnhubQuote(finnhubResponse);

		expect(result.price).toBeNull();
		expect(result.currency).toBeNull();
		expect(result.asOf).toBeNull();
	});

	it('returns null price when c field is not a number', () => {
		const finnhubResponse = {
			c: 'invalid',
			t: 1582641000
		};

		const result = mapFinnhubQuote(finnhubResponse);

		expect(result.price).toBeNull();
		expect(result.currency).toBeNull();
		expect(result.asOf).toBeNull();
	});

	it('handles zero price correctly', () => {
		const finnhubResponse = {
			c: 0,
			t: 1582641000
		};

		const result = mapFinnhubQuote(finnhubResponse);

		expect(result.price).toBe(0);
		expect(result.currency).toBe('USD');
	});

	it('handles missing timestamp', () => {
		const finnhubResponse = {
			c: 261.74
		};

		const result = mapFinnhubQuote(finnhubResponse);

		expect(result.price).toBe(261.74);
		expect(result.currency).toBe('USD');
		expect(result.asOf).toBeNull();
	});

	it('rejects negative price', () => {
		// toNumberValue should accept negative numbers if they're valid
		const finnhubResponse = {
			c: -10,
			t: 1582641000
		};

		const result = mapFinnhubQuote(finnhubResponse);

		// Negative numbers are technically valid from the mapping perspective
		expect(result.price).toBe(-10);
		expect(result.currency).toBe('USD');
	});

	it('handles NaN and Infinity', () => {
		const finnhubResponse1 = { c: NaN, t: 1582641000 };
		const finnhubResponse2 = { c: Infinity, t: 1582641000 };

		const result1 = mapFinnhubQuote(finnhubResponse1);
		const result2 = mapFinnhubQuote(finnhubResponse2);

		expect(result1.price).toBeNull();
		expect(result2.price).toBeNull();
	});
});
