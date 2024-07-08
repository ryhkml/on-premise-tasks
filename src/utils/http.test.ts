import { $ } from "bun";
import { describe, expect, it } from "bun:test";

import { lastValueFrom } from "rxjs";

import { DEFAULT_CONFIG, http } from "./http";

describe("Test FETCH", () => {
	describe("Main request-response", () => {
		it("should respond to \"FetchRes\" if the http request is successful", async () => {
			const result = await lastValueFrom(
				http({
					httpRequest: {
						url: "https://us-central1-adroit-cortex-391921.cloudfunctions.net/on-premise-tasks-wht/cb",
						method: "GET"
					},
					config: {
						...DEFAULT_CONFIG,
						timeout: 6000
					}
				})
			);
			expect(result.status).toBeGreaterThanOrEqual(200);
			expect(result.status).toBeLessThanOrEqual(299);
		});
		it("should respond to \"FetchRes\" if the http request fails", async () => {
			try {
				await lastValueFrom(
					http({
						httpRequest: {
							url: "https://us-central1-adroit-cortex-391921.cloudfunctions.net/on-premise-tasks-wht/cb/error",
							method: "GET"
						},
						config: {
							...DEFAULT_CONFIG,
							timeout: 6000
						}
					})
				);
			} catch (err: SafeAny) {
				expect(err.status).toBeGreaterThanOrEqual(400);
				expect(err.status).toBeLessThanOrEqual(599);
			}
		});
	});

	describe("POST request", () => {
		it("should successfully send plain text data", async () => {
			const result = await lastValueFrom(
				http({
					httpRequest: {
						url: "https://us-central1-adroit-cortex-391921.cloudfunctions.net/on-premise-tasks-wht/cb",
						method: "POST",
						data: "Hello from mars"
					},
					config: {
						...DEFAULT_CONFIG,
						timeout: 6000
					}
				})
			);
			const { res } = JSON.parse(Buffer.from(result.data!).toString()) as FetchTestRes;
			expect(res.headers.payload["content-type"]).toBe("plain/text");
			expect(res.data.payload.data).toBeArray();
			const data = Buffer.from(res.data.payload.data as Uint8Array).toString();
			expect(data).toBe("Hello from mars");
		});
	});

	describe("POST request", () => {
		it("should successfully send multipart form data", async () => {
			const result = await lastValueFrom(
				http({
					httpRequest: {
						url: "https://us-central1-adroit-cortex-391921.cloudfunctions.net/on-premise-tasks-wht/cb",
						method: "POST",
						data: [{
							name: "planet",
							value: "mars"
						}]
					},
					config: {
						...DEFAULT_CONFIG,
						timeout: 6000
					}
				})
			);
			const { res } = JSON.parse(Buffer.from(result.data!).toString()) as FetchTestRes;
			expect(res.headers.payload["content-type"]).toMatch("multipart/form-data");
			expect(res.data.payload.data).toBeArray();
			const data = Buffer.from(res.data.payload.data as Uint8Array).toString();
			expect(data).toMatch("Content-Disposition: form-data; name=\"planet\"");
		});
	});

	describe("POST request", () => {
		it("should successfully send application json data", async () => {
			const result = await lastValueFrom(
				http({
					httpRequest: {
						url: "https://us-central1-adroit-cortex-391921.cloudfunctions.net/on-premise-tasks-wht/cb",
						method: "POST",
						data: {
							id: 1,
							title: "Hello from mars",
							metadata: {
								test: true,
								inclination: [1.850, 5.65, 1.63]
							}
						}
					},
					config: {
						...DEFAULT_CONFIG,
						timeout: 6000
					}
				})
			);
			const { res } = JSON.parse(Buffer.from(result.data!).toString()) as FetchTestRes;
			expect(res.headers.payload["content-type"]).toBe("application/json");
			expect(res.data.payload).toMatchObject({
				id: 1,
				title: "Hello from mars",
				metadata: {
					test: true,
					inclination: [1.850, 5.65, 1.63]
				}
			});
		});
	});

	describe("POST request", () => {
		it("should successfully add http auth basic", async () => {
			const result = await lastValueFrom(
				http({
					httpRequest: {
						url: "https://us-central1-adroit-cortex-391921.cloudfunctions.net/on-premise-tasks-wht/cb",
						method: "POST",
						data: "LOGIN",
						authBasic: {
							user: "admin",
							password: "admin123"
						}
					},
					config: {
						...DEFAULT_CONFIG,
						timeout: 6000
					}
				})
			);
			const { res } = JSON.parse(Buffer.from(result.data!).toString()) as FetchTestRes;
			const [basic, token] = res.headers.payload.authorization.split(" ") as [string, string];
			expect(basic).toBe("Basic");
			expect(token).toBeDefined();
		});
	});

	describe("GET request", () => {
		it("should successfully send cookies", async () => {
			const result = await lastValueFrom(
				http({
					httpRequest: {
						url: "https://us-central1-adroit-cortex-391921.cloudfunctions.net/on-premise-tasks-wht/cb",
						method: "GET",
						cookie: [{
							name: "LOGIN",
							value: "1"
						}]
					},
					config: {
						...DEFAULT_CONFIG,
						timeout: 6000
					}
				})
			);
			const { res } = JSON.parse(Buffer.from(result.data!).toString()) as FetchTestRes;
			expect(res.headers.payload.cookie).toBe("LOGIN=1");
		});
	});

	describe("GET request", () => {
		it("should successfully add custom headers", async () => {
			const result = await lastValueFrom(
				http({
					httpRequest: {
						url: "https://us-central1-adroit-cortex-391921.cloudfunctions.net/on-premise-tasks-wht/cb",
						method: "GET",
						headers: {
							"x-my-custom": "Hello from mars"
						}
					},
					config: {
						...DEFAULT_CONFIG,
						timeout: 6000
					}
				})
			);
			const { res } = JSON.parse(Buffer.from(result.data!).toString()) as FetchTestRes;
			expect(res.headers.payload["x-my-custom"]).toBe("Hello from mars");
		});
	});

	describe("GET request", () => {
		it("should successfully initialize default user agent", async () => {
			const result = await lastValueFrom(
				http({
					httpRequest: {
						url: "https://us-central1-adroit-cortex-391921.cloudfunctions.net/on-premise-tasks-wht/cb",
						method: "GET"
					},
					config: {
						...DEFAULT_CONFIG,
						timeout: 6000
					}
				})
			);
			const { res } = JSON.parse(Buffer.from(result.data!).toString()) as FetchTestRes;
			expect(res.headers.payload["user-agent"]).toBe("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (On-Premise Tasks)");
		});
	});

	describe("GET request", () => {
		it("should successfully change user agent", async () => {
			const result = await lastValueFrom(
				http({
					httpRequest: {
						url: "https://us-central1-adroit-cortex-391921.cloudfunctions.net/on-premise-tasks-wht/cb",
						method: "GET",
						headers: {
							"user-agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"
						}
					},
					config: {
						...DEFAULT_CONFIG,
						timeout: 6000
					}
				})
			);
			const { res } = JSON.parse(Buffer.from(result.data!).toString()) as FetchTestRes;
			expect(res.headers.payload["user-agent"]).toBe("Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)");
		});
	});

	describe("GET request", () => {
		it("should successfully add referer url", async () => {
			const result = await lastValueFrom(
				http({
					httpRequest: {
						url: "https://us-central1-adroit-cortex-391921.cloudfunctions.net/on-premise-tasks-wht/cb",
						method: "GET"
					},
					config: {
						...DEFAULT_CONFIG,
						timeout: 6000,
						refererUrl: "https://www.google.com"
					}
				})
			);
			const { res } = JSON.parse(Buffer.from(result.data!).toString()) as FetchTestRes;
			expect(res.headers.payload.referer).toBe("https://www.google.com");
		});
	});

	describe("GET request", () => {
		it("should successfully add Google DNS-over-HTTPS (https://dns.google/dns-query)", async () => {
			const result = await lastValueFrom(
				http({
					httpRequest: {
						url: "https://us-central1-adroit-cortex-391921.cloudfunctions.net/on-premise-tasks-wht/cb",
						method: "GET"
					},
					config: {
						...DEFAULT_CONFIG,
						timeout: 6000,
						dohUrl: "https://dns.google/dns-query"
					}
				})
			);
			expect(result.status).toBeGreaterThanOrEqual(200);
			expect(result.status).toBeLessThanOrEqual(299);
		});
	});

	describe("GET request", () => {
		it("should successfully add IPv6", async () => {
			const result = await lastValueFrom(
				http({
					httpRequest: {
						url: "https://us-central1-adroit-cortex-391921.cloudfunctions.net/on-premise-tasks-wht/cb",
						method: "GET"
					},
					config: {
						...DEFAULT_CONFIG,
						timeout: 6000,
						ipv: 6
					}
				})
			);
			expect(result.status).toBeGreaterThanOrEqual(200);
			expect(result.status).toBeLessThanOrEqual(299);
		});
	});

	describe("GET request", () => {
		it("should successfully disable session id", async () => {
			const result = await lastValueFrom(
				http({
					httpRequest: {
						url: "https://us-central1-adroit-cortex-391921.cloudfunctions.net/on-premise-tasks-wht/cb",
						method: "GET"
					},
					config: {
						...DEFAULT_CONFIG,
						timeout: 6000,
						sessionId: false
					}
				})
			);
			expect(result.status).toBeGreaterThanOrEqual(200);
			expect(result.status).toBeLessThanOrEqual(299);
		});
	});

	describe("GET request", () => {
		it("should successfully add HSTS", async () => {
			const result = await lastValueFrom(
				http({
					httpRequest: {
						url: "https://us-central1-adroit-cortex-391921.cloudfunctions.net/on-premise-tasks-wht/cb",
						method: "GET"
					},
					config: {
						...DEFAULT_CONFIG,
						timeout: 6000,
						hsts: true
					}
				})
			);
			expect(result.status).toBeGreaterThanOrEqual(200);
			expect(result.status).toBeLessThanOrEqual(299);
		});
	});

	describe("GET request", () => {
		it("should successfully use HTTP/2", async () => {
			const result = await lastValueFrom(
				http({
					httpRequest: {
						url: "https://us-central1-adroit-cortex-391921.cloudfunctions.net/on-premise-tasks-wht/cb",
						method: "GET"
					},
					config: {
						...DEFAULT_CONFIG,
						timeout: 6000,
						httpVersion: "2"
					}
				})
			);
			expect(result.status).toBeGreaterThanOrEqual(200);
			expect(result.status).toBeLessThanOrEqual(299);
		});
	});
});

describe("Test FEATURES", () => {
	describe("Show c-ares", () => {
		it("should successfully support c-ares", async () => {
			const text = await $`curl -V | grep "c-ares"`.text();
			expect(text).toBeDefined();
		});
	});

	describe("Show gsasl", () => {
		it("should successfully support gsasl", async () => {
			const text = await $`curl -V | grep "gsasl"`.text();
			expect(text).toBeDefined();
		});
	});
});