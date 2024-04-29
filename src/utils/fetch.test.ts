import { describe, expect, it } from "bun:test";

import { lastValueFrom } from "rxjs";

import { fetchHttp } from "./fetch";

describe("Test FETCH", () => {
	it("should respond to \"FetchRes\" if the http request is successful", async () => {
		const res = await lastValueFrom(
			fetchHttp({
				httpRequest: {
					url: "https://dummyjson.com/todos/1",
					method: "GET"
				},
				// @ts-ignore
				config: {
					timeout: 30000
				}
			})
		);
		expect(res).toHaveProperty("data");
		expect(res.state).toBeDefined();
		expect(res.status).toBeDefined();
		expect(res.statusText).toBeDefined();
	});
	it("should respond to \"FetchRes\" if the http request fails", async () => {
		try {
			await lastValueFrom(
				fetchHttp({
					httpRequest: {
						url: "https://dummyjson.com/todos/0",
						method: "GET"
					},
					// @ts-ignore
					config: {
						timeout: 30000
					}
				})
			);
		} catch (err: SafeAny) {
			expect(err).toHaveProperty("data");
			expect(err.state).toBeDefined();
			expect(err.status).toBeDefined();
			expect(err.statusText).toBeDefined();
		}
	});
});