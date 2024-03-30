import { describe, expect, it } from "bun:test";

import { fetchHttp } from "./fetch";
import { queue } from "../apis/queue";

const queueApp = queue();

describe("Test FETCH", () => {
	it("should respond to \"FetchRes\" if the http request is successful", async () => {
		fetchHttp({
			httpRequest: {
				url: "https://www.starlink.com",
				method: "GET"
			},
			config: queueApp.decorator.defaultConfig
		})
		.subscribe({
			next(res) {
				expect(res).toHaveProperty("data");
				expect(res.state).toBeDefined();
				expect(res.status).toBeDefined();
				expect(res.statusText).toBeDefined();
			}
		});
	});
	it("should respond to \"FetchRes\" if the http request fails", async () => {
		fetchHttp({
			httpRequest: {
				url: "https://api.starlink.com",
				method: "GET"
			},
			config: queueApp.decorator.defaultConfig
		})
		.subscribe({
			error(err) {
				expect(err).toHaveProperty("data");
				expect(err.state).toBeDefined();
				expect(err.status).toBeDefined();
				expect(err.statusText).toBeDefined();
			}
		});
	});
});