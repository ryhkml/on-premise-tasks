import { env, password, sleep } from "bun";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { treaty } from "@elysiajs/eden";

import { subscriber } from "../apis/subscriber";

const subscriberApp = subscriber().listen(+env.PORT! || 3200);
const subscriberApi = treaty(subscriberApp);
const name = "test-auth";
const db = subscriberApp.decorator.db;

let key = "";
let id = "";

describe("Test AUTH", () => {
	const stmtS = db.prepare<void, string>("DELETE FROM subscriber WHERE subscriberName = ?;");

	beforeEach(async () => {
		const { data } = await subscriberApi.subscribers.register.post({ name });
		key = data?.key!;
		id = data?.id!;
		await sleep(1);
	});
	afterEach(async () => {
		stmtS.run(name);
		await sleep(1);
	});

	it("should respond with the Argon2id hash algorithm with a memory cost of 4 and a time cost of 3", async () => {
		const q = db.query<Pick<SubscriberTable, "key">, string>("SELECT key FROM subscriber WHERE subscriberId = ? LIMIT 1;");
		const secret = q.get(id);
		expect(secret?.key).toBeDefined();
		expect(secret?.key).toMatch(/\$argon2id\$v=19\$m=4,t=3,p=1\$/);
		const isValid = await password.verify(key, secret?.key!, "argon2id");
		expect(isValid).toBe(true);
	});
	it("should respond with status code 401 if the subscriber id is invalid", async () => {
		const { status } = await subscriberApi.subscribers({ name }).get({
			headers: {
				"authorization": "Bearer " + key,
				"x-tasks-subscriber-id": "01HVED284EHKPMFTSSXMJYKRWX"
			}
		});
		expect(status).toBe(401);
	});
	it("should respond with status code 403 if the subscriber key is invalid", async () => {
		const { status } = await subscriberApi.subscribers({ name }).get({
			headers: {
				"authorization": "Bearer dummy",
				"x-tasks-subscriber-id": id
			}
		});
		expect(status).toBe(403);
	});
});