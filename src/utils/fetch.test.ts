import { describe, expect, it } from "bun:test";

import { firstValueFrom, map } from "rxjs";

import { httpRequest } from "./fetch";
import { queue } from "../apis/queue";

const app = queue();

describe("TEST FETCH", () => {
	it("should respond status code 200", async () => {
		const http = httpRequest({
			httpRequest: {
				url: "https://www.starlink.com",
				method: "GET"
			},
			config: app.decorator.defaultConfig
		})
		const status = await firstValueFrom(
			http.pipe(
				map(res => res.status)
			)
		);
		expect(status).toBe(200);
	});
});