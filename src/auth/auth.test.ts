import { env, password } from "bun";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { treaty } from "@elysiajs/eden";

import { subscriber } from "../apis/subscriber";

const port = +env.PORT! || 3200;
const app = subscriber().listen(port);
const api = treaty(app);
const db = app.decorator.db;

describe("Test AUTH", () => {
	const name = "test-auth";
	beforeEach(() => {
		db.run("DELETE FROM subscriber WHERE subscriberName = ?;", [name]);
	});
	afterEach(() => {
		db.run("DELETE FROM subscriber WHERE subscriberName = ?;", [name]);
	});
	it("should respond argon2id hash algorithm with memory cost 4 and time cost 3", async () => {
		const { data, status } = await api.subscribers.register.post({ name });
		const q = db.query("SELECT key FROM subscriber WHERE subscriberId = ?;");
		const secret = q.get(data?.id!) as { key: string } | null;
		expect(status).toBe(201);
		expect(secret?.key).toMatch(/\$argon2id\$v=19\$m=4,t=3,p=1\$/);
		const isValid = await password.verify(data?.key!, secret?.key!, "argon2id");
		expect(isValid).toBe(true);
	});
	it("should respond status code 401 if subscriber key and subscriber id is empty", async () => {
		const { status } = await api.subscribers({ name }).get({
			headers: {
				"authorization": "",
				"x-tasks-subscriber-id": ""
			}
		});
		expect(status).toBe(401);
	});
	it("should respond status code 401 if subscriber id is invalid", async () => {
		const credential = await api.subscribers.register.post({ name });
		const { status } = await api.subscribers({ name }).get({
			headers: {
				"authorization": "Bearer " + credential.data?.key!,
				"x-tasks-subscriber-id": "dummy"
			}
		});
		expect(status).toBe(401);
	});
	it("should respond status code 403 if subscriber key is invalid", async () => {
		const credential = await api.subscribers.register.post({ name });
		const { status } = await api.subscribers({ name }).get({
			headers: {
				"authorization": "Bearer dummy",
				"x-tasks-subscriber-id": credential.data?.id!
			}
		});
		expect(status).toBe(403);
	});
});