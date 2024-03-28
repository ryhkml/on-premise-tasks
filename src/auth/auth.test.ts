import { env, password } from "bun";
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
	beforeEach(async () => {
		const { data } = await subscriberApi.subscribers.register.post({ name });
		key = data?.key!;
		id = data?.id!;
	});
	afterEach(() => {
		db.run("DELETE FROM subscriber WHERE subscriberName = ?;", [name]);
	});
	it("should respond argon2id hash algorithm with memory cost 4 and time cost 3", async () => {
		const q = db.query("SELECT key FROM subscriber WHERE subscriberId = ?;");
		const secret = q.get(id) as { key: string } | null;
		expect(secret?.key).toBeDefined();
		expect(secret?.key).toMatch(/\$argon2id\$v=19\$m=4,t=3,p=1\$/);
		const isValid = await password.verify(key, secret?.key!, "argon2id");
		expect(isValid).toBe(true);
	});
	it("should respond status code 401 if subscriber key and subscriber id is empty", async () => {
		const { status } = await subscriberApi.subscribers({ name }).get({
			headers: {
				"authorization": "",
				"x-tasks-subscriber-id": ""
			}
		});
		expect(status).toBe(401);
	});
	it("should respond status code 401 if subscriber id is invalid", async () => {
		const { status } = await subscriberApi.subscribers({ name }).get({
			headers: {
				"authorization": "Bearer " + key,
				"x-tasks-subscriber-id": "dummy"
			}
		});
		expect(status).toBe(401);
	});
	it("should respond status code 403 if subscriber key is invalid", async () => {
		const { status } = await subscriberApi.subscribers({ name }).get({
			headers: {
				"authorization": "Bearer dummy",
				"x-tasks-subscriber-id": id
			}
		});
		expect(status).toBe(403);
	});
});