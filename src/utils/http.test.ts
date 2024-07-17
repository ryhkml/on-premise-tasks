import { $, file } from "bun";
import { describe, expect, it } from "bun:test";

import { lastValueFrom } from "rxjs";

import { DEFAULT_CONFIG, http } from "./http";
import { warn } from "./logger";

console.log();
warn("If any test is skipped, curl may not support the feature or the domain may not support certain HTTP configurations");
warn("Ensure that you use the latest version of curl, or build curl with support for c-ares and libgsasl, if necessary");
console.log();

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

	describe("GET request", async () => {
		const result = await lastValueFrom(
			http({
				httpRequest: {
					url: "https://us-central1-adroit-cortex-391921.cloudfunctions.net/on-premise-tasks-wht/cb",
					method: "GET"
				},
				config: {
					...DEFAULT_CONFIG,
					timeout: 6000,
					ipVersion: 6
				}
			})
		);
		it.skipIf(result.status == 0)("should successfully use IPv6", () => {
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

	describe("GET request", async () => {
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
		it.skipIf(result.status == 0)("should successfully add HSTS", () => {
			expect(result.status).toBeGreaterThanOrEqual(200);
			expect(result.status).toBeLessThanOrEqual(299);
		});
	});

	describe("GET request", async () => {
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
		it.skipIf(result.status == 0)("should successfully use HTTP/2", () => {
			expect(result.status).toBeGreaterThanOrEqual(200);
			expect(result.status).toBeLessThanOrEqual(299);
		});
	});

	describe("GET request", async () => {
		const result = await lastValueFrom(
			http({
				httpRequest: {
					url: "https://us-central1-adroit-cortex-391921.cloudfunctions.net/on-premise-tasks-wht/cb",
					method: "GET"
				},
				config: {
					...DEFAULT_CONFIG,
					timeout: 6000,
					httpVersion: "2-prior-knowledge"
				}
			})
		);
		it.skipIf(result.status == 0)("should successfully use HTTP/2 Prior-Knowledge", () => {
			expect(result.status).toBeGreaterThanOrEqual(200);
			expect(result.status).toBeLessThanOrEqual(299);
		});
	});

	describe("GET request", async () => {
		const result = await lastValueFrom(
			http({
				httpRequest: {
					url: "https://us-central1-adroit-cortex-391921.cloudfunctions.net/on-premise-tasks-wht/cb",
					method: "GET"
				},
				config: {
					...DEFAULT_CONFIG,
					timeout: 6000,
					tlsMaxVersion: "1.0"
				}
			})
		);
		it.skipIf(result.status == 0)("should successfully use TLS max version 1.0", () => {
			expect(result.status).toBeGreaterThanOrEqual(200);
			expect(result.status).toBeLessThanOrEqual(299);
		});
	});

	describe("GET request", async () => {
		const result = await lastValueFrom(
			http({
				httpRequest: {
					url: "https://us-central1-adroit-cortex-391921.cloudfunctions.net/on-premise-tasks-wht/cb",
					method: "GET"
				},
				config: {
					...DEFAULT_CONFIG,
					timeout: 6000,
					tlsMaxVersion: "1.1"
				}
			})
		);
		it.skipIf(result.status == 0)("should successfully use TLS max version 1.1", () => {
			expect(result.status).toBeGreaterThanOrEqual(200);
			expect(result.status).toBeLessThanOrEqual(299);
		});
	});

	describe("GET request", async () => {
		const result = await lastValueFrom(
			http({
				httpRequest: {
					url: "https://us-central1-adroit-cortex-391921.cloudfunctions.net/on-premise-tasks-wht/cb",
					method: "GET"
				},
				config: {
					...DEFAULT_CONFIG,
					timeout: 6000,
					tlsMaxVersion: "1.2"
				}
			})
		);
		it.skipIf(result.status == 0)("should successfully use TLS max version 1.2", () => {
			expect(result.status).toBeGreaterThanOrEqual(200);
			expect(result.status).toBeLessThanOrEqual(299);
		});
	});

	describe("GET request", async () => {
		const result = await lastValueFrom(
			http({
				httpRequest: {
					url: "https://us-central1-adroit-cortex-391921.cloudfunctions.net/on-premise-tasks-wht/cb",
					method: "GET"
				},
				config: {
					...DEFAULT_CONFIG,
					timeout: 6000,
					tlsMaxVersion: "1.3"
				}
			})
		);
		it.skipIf(result.status == 0)("should successfully use TLS max version 1.3", () => {
			expect(result.status).toBeGreaterThanOrEqual(200);
			expect(result.status).toBeLessThanOrEqual(299);
		});
	});

	describe("GET request", () => {
		it("should successfully use TLS version 1.0", async () => {
			const result = await lastValueFrom(
				http({
					httpRequest: {
						url: "https://us-central1-adroit-cortex-391921.cloudfunctions.net/on-premise-tasks-wht/cb",
						method: "GET"
					},
					config: {
						...DEFAULT_CONFIG,
						timeout: 6000,
						tlsVersion: "1.0"
					}
				})
			);
			expect(result.status).toBeGreaterThanOrEqual(200);
			expect(result.status).toBeLessThanOrEqual(299);
		});
	});

	describe("GET request", () => {
		it("should successfully use TLS version 1.1", async () => {
			const result = await lastValueFrom(
				http({
					httpRequest: {
						url: "https://us-central1-adroit-cortex-391921.cloudfunctions.net/on-premise-tasks-wht/cb",
						method: "GET"
					},
					config: {
						...DEFAULT_CONFIG,
						timeout: 6000,
						tlsVersion: "1.1"
					}
				})
			);
			expect(result.status).toBeGreaterThanOrEqual(200);
			expect(result.status).toBeLessThanOrEqual(299);
		});
	});

	describe("GET request", () => {
		it("should successfully use TLS version 1.2", async () => {
			const result = await lastValueFrom(
				http({
					httpRequest: {
						url: "https://us-central1-adroit-cortex-391921.cloudfunctions.net/on-premise-tasks-wht/cb",
						method: "GET"
					},
					config: {
						...DEFAULT_CONFIG,
						timeout: 6000,
						tlsVersion: "1.2"
					}
				})
			);
			expect(result.status).toBeGreaterThanOrEqual(200);
			expect(result.status).toBeLessThanOrEqual(299);
		});
	});

	describe("GET request", () => {
		it("should successfully use TLS version 1.3", async () => {
			const result = await lastValueFrom(
				http({
					httpRequest: {
						url: "https://us-central1-adroit-cortex-391921.cloudfunctions.net/on-premise-tasks-wht/cb",
						method: "GET"
					},
					config: {
						...DEFAULT_CONFIG,
						timeout: 6000,
						tlsVersion: "1.3"
					}
				})
			);
			expect(result.status).toBeGreaterThanOrEqual(200);
			expect(result.status).toBeLessThanOrEqual(299);
		});
	});

	describe("GET request", () => {
		it("should successfully add CA", async () => {
			/**
			 * This is Certificate Authorities (CA) does Google Trust Services operate
			 * 
			 * GTS Root R1 - https://pki.goog
			*/
			const CA = `-----BEGIN CERTIFICATE-----
				MIIFVzCCAz+gAwIBAgINAgPlk28xsBNJiGuiFzANBgkqhkiG9w0BAQwFADBHMQsw
				CQYDVQQGEwJVUzEiMCAGA1UEChMZR29vZ2xlIFRydXN0IFNlcnZpY2VzIExMQzEU
				MBIGA1UEAxMLR1RTIFJvb3QgUjEwHhcNMTYwNjIyMDAwMDAwWhcNMzYwNjIyMDAw
				MDAwWjBHMQswCQYDVQQGEwJVUzEiMCAGA1UEChMZR29vZ2xlIFRydXN0IFNlcnZp
				Y2VzIExMQzEUMBIGA1UEAxMLR1RTIFJvb3QgUjEwggIiMA0GCSqGSIb3DQEBAQUA
				A4ICDwAwggIKAoICAQC2EQKLHuOhd5s73L+UPreVp0A8of2C+X0yBoJx9vaMf/vo
				27xqLpeXo4xL+Sv2sfnOhB2x+cWX3u+58qPpvBKJXqeqUqv4IyfLpLGcY9vXmX7w
				Cl7raKb0xlpHDU0QM+NOsROjyBhsS+z8CZDfnWQpJSMHobTSPS5g4M/SCYe7zUjw
				TcLCeoiKu7rPWRnWr4+wB7CeMfGCwcDfLqZtbBkOtdh+JhpFAz2weaSUKK0Pfybl
				qAj+lug8aJRT7oM6iCsVlgmy4HqMLnXWnOunVmSPlk9orj2XwoSPwLxAwAtcvfaH
				szVsrBhQf4TgTM2S0yDpM7xSma8ytSmzJSq0SPly4cpk9+aCEI3oncKKiPo4Zor8
				Y/kB+Xj9e1x3+naH+uzfsQ55lVe0vSbv1gHR6xYKu44LtcXFilWr06zqkUspzBmk
				MiVOKvFlRNACzqrOSbTqn3yDsEB750Orp2yjj32JgfpMpf/VjsPOS+C12LOORc92
				wO1AK/1TD7Cn1TsNsYqiA94xrcx36m97PtbfkSIS5r762DL8EGMUUXLeXdYWk70p
				aDPvOmbsB4om3xPXV2V4J95eSRQAogB/mqghtqmxlbCluQ0WEdrHbEg8QOB+DVrN
				VjzRlwW5y0vtOUucxD/SVRNuJLDWcfr0wbrM7Rv1/oFB2ACYPTrIrnqYNxgFlQID
				AQABo0IwQDAOBgNVHQ8BAf8EBAMCAYYwDwYDVR0TAQH/BAUwAwEB/zAdBgNVHQ4E
				FgQU5K8rJnEaK0gnhS9SZizv8IkTcT4wDQYJKoZIhvcNAQEMBQADggIBAJ+qQibb
				C5u+/x6Wki4+omVKapi6Ist9wTrYggoGxval3sBOh2Z5ofmmWJyq+bXmYOfg6LEe
				QkEzCzc9zolwFcq1JKjPa7XSQCGYzyI0zzvFIoTgxQ6KfF2I5DUkzps+GlQebtuy
				h6f88/qBVRRiClmpIgUxPoLW7ttXNLwzldMXG+gnoot7TiYaelpkttGsN/H9oPM4
				7HLwEXWdyzRSjeZ2axfG34arJ45JK3VmgRAhpuo+9K4l/3wV3s6MJT/KYnAK9y8J
				ZgfIPxz88NtFMN9iiMG1D53Dn0reWVlHxYciNuaCp+0KueIHoI17eko8cdLiA6Ef
				MgfdG+RCzgwARWGAtQsgWSl4vflVy2PFPEz0tv/bal8xa5meLMFrUKTX5hgUvYU/
				Z6tGn6D/Qqc6f1zLXbBwHSs09dR2CQzreExZBfMzQsNhFRAbd03OIozUhfJFfbdT
				6u9AWpQKXCBfTkBdYiJ23//OYb2MI3jSNwLgjt7RETeJ9r/tSQdirpLsQBqvFAnZ
				0E6yove+7u7Y/9waLd64NnHi/Hm3lCXRSHNboTXns5lndcEZOitHTtNCjv0xyBZm
				2tIMPNuzjsmhDYAPexZ3FL//2wmUspO8IFgV6dtxQ/PeEMMA3KgqlbbC1j+Qa3bb
				bP6MvPJwNQzcmRk13NfIRmPVNnGuV/u3gm3c
				-----END CERTIFICATE-----
			`;
			const base64Ca = Buffer.from(CA.split("\t").join("")).toString("base64");
			const result = await lastValueFrom(
				http({
					httpRequest: {
						url: "https://us-central1-adroit-cortex-391921.cloudfunctions.net/on-premise-tasks-wht/cb",
						method: "GET"
					},
					config: {
						...DEFAULT_CONFIG,
						timeout: 6000,
						ca: [base64Ca]
					}
				})
			);
			const exists = await file("/tmp/" + result.id + "/ca/ca.crt").exists();
			expect(exists).toBeTrue();
			expect(result.status).toBeGreaterThanOrEqual(200);
			expect(result.status).toBeLessThanOrEqual(299);
		});
	});
});

describe("Test FEATURES", async () => {
	const cAres = (await $`curl -V | grep "c-ares"`.text()).trim();
	const libGsasl = (await $`curl -V | grep "libgsasl"`.text()).trim();

	describe("Show c-ares", () => {
		it.skipIf(!cAres.includes("c-ares"))("should successfully support c-ares", () => {
			expect(cAres).toContain("c-ares");
		});
	});

	describe("Show libgsasl", () => {
		it.skipIf(!cAres.includes("libgsasl"))("should successfully support libgsasl", () => {
			expect(libGsasl).toContain("libgsasl");
		});
	});
});