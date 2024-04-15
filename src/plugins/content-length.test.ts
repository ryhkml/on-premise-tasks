import { env, sleep } from "bun";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { treaty } from "@elysiajs/eden";

import { toSafeInteger } from "lodash";

import { queue } from "../apis/queue";
import { subscriber } from "../apis/subscriber";

const subscriberApp = subscriber().listen(+env.PORT! || 3200);
const subscriberApi = treaty(subscriberApp);
const queueApp = queue().listen({
	maxRequestBodySize: toSafeInteger(env.MAX_SIZE_BODY_REQUEST) || 32768,
	port: +env.PORT! || 3200
});
const queueApi = treaty(queueApp);
const name = "test-content-length";
const db = queueApp.decorator.db;

let key = "";
let id = "";

describe("Test CONTENT LENGTH", () => {
	const stmtQ = db.prepare<void, string>("DELETE FROM queue WHERE subscriberId = ?;");
	const stmtS = db.prepare<void, string>("DELETE FROM subscriber WHERE subscriberName = ?;");

	beforeEach(async () => {
		const { data } = await subscriberApi.subscribers.register.post({ name });
		key = data?.key!;
		id = data?.id!;
		await sleep(1);
	});
	afterEach(async () => {
		db.transaction(() => {
			stmtQ.run(id);
			stmtS.run(name);
		})();
		await sleep(1);
	});

	it("should successfully register the queue, provided that the request payload does not exceed the maximum limit", async () => {
		const payload = {
			httpRequest: {
				url: "https://www.starlink.com",
				method: "GET"
			},
			config: {
				...queueApp.decorator.defaultConfig
			}
		};
		const len = Buffer.byteLength(JSON.stringify(payload), "utf-8");
		const { data, status } = await queueApi.queues.register.post(payload as TaskSubscriberReq, {
			headers: {
				"authorization": "Bearer " + key,
				"content-length": len.toString(),
				"x-tasks-subscriber-id": id
			}
		});
		await sleep(100);
		expect(status).toBe(201);
		expect(data?.id).toBeDefined();
		expect(data?.state).toBeDefined();
		expect(data?.statusCode).toBeDefined();
		expect(data?.estimateEndAt).toBeDefined();
		expect(data?.estimateExecutionAt).toBeDefined();
	});
	it("should respond with status code 413 if the request payload is too large", async () => {
		const body = [] as Array<{ [k: string]: string }>;
		for (let i = 1; i <= 10000; i++) {
			body.push({
				["X-Test-Large-Body-" + i.toString()]: "Body-Lorem ipsum dolor sit amet, consectetur adipiscing elit. Vestibulum id ante ac nulla porttitor maximus. " + i.toString()
			});
		}
		const query = [] as Array<{ [k: string]: string }>;
		for (let i = 1; i <= 10000; i++) {
			query.push({
				["X-Test-Large-Query-" + i.toString()]: "Query-Lorem ipsum dolor sit amet, consectetur adipiscing elit. Vestibulum id ante ac nulla porttitor maximus. " + i.toString()
			});
		}
		const headersData = [] as Array<{ [k: string]: string }>;
		for (let i = 1; i <= 10000; i++) {
			headersData.push({
				["X-Test-Large-Headers-" + i.toString()]: "Headers-Lorem ipsum dolor sit amet, consectetur adipiscing elit. Vestibulum id ante ac nulla porttitor maximus. " + i.toString()
			});
		}
		const payload = {
			httpRequest: {
				url: "https://www.starlink.com",
				method: "GET",
				body: Object.assign({}, ...body),
				query: Object.assign({}, ...query),
				headers: Object.assign({}, ...headersData)
			},
			config: {
				...queueApp.decorator.defaultConfig
			}
		} as TaskSubscriberReq;
		const len = Buffer.byteLength(JSON.stringify(payload), "utf-8");
		const { status } = await queueApi.queues.register.post(payload, {
			headers: {
				"authorization": "Bearer " + key,
				"content-length": len.toString(),
				"x-tasks-subscriber-id": id
			}
		});
		expect(status).toBe(413);
	});
});