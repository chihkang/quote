import { bindings, defineConfig, triggers } from "cf/config";

export default defineConfig({
	worker: {
		name: "quote-worker",
		compatibilityDate: "2025-03-07",
		compatibilityFlags: [
			"nodejs_compat",
		],
		entrypoint: "src/index.ts",
		observability: {
			enabled: true,
			headSamplingRate: 1,
		},
		triggers: [
			triggers.scheduled({
				schedule: "*/10 * * * *",
			}),
		],
		env: {
			DEFAULT_MARKET: bindings.text("TW"),
			MAX_SYNC_FETCH: bindings.text("10"),
			MAX_SYMBOLS_PER_REQUEST: bindings.text("10"),
			TW_OPEN: bindings.text("09:00"),
			TW_CLOSE: bindings.text("13:30"),
			US_HOLIDAYS: bindings.text(""),
			SOFT_TTL_TRADING_SEC: bindings.text("300"),
			HARD_TTL_TRADING_SEC: bindings.text("300"),
			SOFT_TTL_OFFHOURS_SEC: bindings.text("300"),
			HARD_TTL_OFFHOURS_SEC: bindings.text("259200"),
			OFFHOURS_OPEN_BUFFER_SEC: bindings.text("300"),
			L1_TTL_SEC: bindings.text("20"),
			TWSE_EOD_URL: bindings.text("https://www.twse.com.tw/exchangeReport/STOCK_DAY_ALL?response=open_data"),
			TPEX_EOD_URL: bindings.text("https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes"),
			TW_EOD_PATCH_ROWS: bindings.text("239"),
			TW_429_BLOCK_SEC: bindings.text("60"),
			TW_EOD_L1_SEC: bindings.text("60"),
			QUOTES_KV: bindings.kv({
				id: "e8cbd6fde95a4aee9cf13c381c43458a",
				dev: {
					remote: false,
				},
			}),
			TW_EOD_R2: bindings.r2({
				name: "quote-tw-eod",
			}),
		},
	},
});
