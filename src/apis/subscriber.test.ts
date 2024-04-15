import { env, sleep } from "bun";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { treaty } from "@elysiajs/eden";

import { subscriber } from "./subscriber";

const subscriberApp = subscriber().listen(+env.PORT! || 3200);
const subscriberApi = treaty(subscriberApp);
const name = "test-subscriber";
const db = subscriberApp.decorator.db;

let key = "";
let id = "";

describe("Test API", () => {
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

	describe("GET /subscribers/:name", () => {
		it("should successfully get the subscriber", async () => {
			const { data, status } = await subscriberApi.subscribers({ name }).get({
				headers: {
					"authorization": "Bearer " + key,
					"x-tasks-subscriber-id": id
				}
			});
			expect(status).toBe(200);
			expect(data?.id).toBeDefined();
			expect(data?.name).toBeDefined();
			expect(data?.createdAt).toBeDefined();
			expect(data?.tasksInQueue).toBeDefined();
			expect(data?.tasksInQueueLimit).toBeDefined();
		});
		it("should respond with status code 404 if the subscriber name does not exist", async () => {
			const { status } = await subscriberApi.subscribers({ name: "dummy" }).get({
				headers: {
					"authorization": "Bearer " + key,
					"x-tasks-subscriber-id": id
				}
			});
			expect(status).toBe(404);
		});
	});

	describe("POST /subscribers/register", () => {
		it("should the subscriber not be registered", () => {
			stmtS.run(name);
			const q = db.query<{ isRegistered: 0 | 1 }, string>("SELECT EXISTS (SELECT 1 FROM subscriber WHERE subscriberName = ?) AS isRegistered;");
			const subscriber = q.get(name)!;
			const notExists = !!subscriber.isRegistered;
			expect(notExists).toBe(false);
		});
		it("should successfully register the subscriber", async () => {
			stmtS.run(name);
			const { data, status } = await subscriberApi.subscribers.register.post({ name });
			expect(status).toBe(201);
			expect(data?.id).toBeDefined();
			expect(data?.key).toBeDefined();
		});
		it("should respond with status code 409 if the subscriber is already registered", async () => {
			const { status } = await subscriberApi.subscribers.register.post({ name });
			expect(status).toBe(409);
		});
	});

	describe("DELETE /subscribers/:name", () => {
		it("should successfully delete the subscriber", async () => {
			const { data, status } = await subscriberApi.subscribers({ name }).delete(null, {
				headers: {
					"authorization": "Bearer " + key,
					"x-tasks-subscriber-id": id
				}
			});
			expect(status).toBe(200);
			expect(data?.message).toBeDefined();
		});
		it("should respond with status code 422 if the number of subscriber tasks in queue is greater than or equal to 1", async () => {
			db.run("UPDATE subscriber SET tasksInQueue = tasksInQueue + 1 WHERE subscriberName = ?;", [name]);
			const { status } = await subscriberApi.subscribers({ name }).delete(null, {
				headers: {
					"authorization": "Bearer " + key,
					"x-tasks-subscriber-id": id
				}
			});
			expect(status).toBe(422);
		});
	});
});