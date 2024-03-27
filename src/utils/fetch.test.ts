import { describe, expect, it } from "bun:test";

import { catchError, lastValueFrom, map, throwError } from "rxjs";
import { AxiosError } from "axios";

import { fetch } from "./fetch";
import { queue } from "../apis/queue";

const app = queue();

describe("Test FETCH", () => {
	it("should respond to \"AxiosResponse\" if the http request is successful", async () => {
		const http = fetch({
			httpRequest: {
				url: "https://www.starlink.com",
				method: "GET"
			},
			config: app.decorator.defaultConfig
		})
		try {
			const res = await lastValueFrom(http);
			expect(res.data).toBeDefined();
			expect(res.status).toBeDefined();
			expect(res.statusText).toBeDefined();
		} catch (error) {
			// Noop
		}
	});
	it("should respond to an \"AxiosError\" instance if the http request fails", async () => {
		const http = fetch({
			httpRequest: {
				url: "https://api.starlink.com",
				method: "GET"
			},
			config: app.decorator.defaultConfig
		})
		try {
			await lastValueFrom(
				http.pipe(
					map(res => res.status),
					catchError(e => throwError(() => e))
				)
			);
		} catch (error) {
			expect(error).toBeInstanceOf(AxiosError);
		}
	});
});