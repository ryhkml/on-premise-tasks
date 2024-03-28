import { env } from "bun";
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
	beforeEach(async () => {
		const { data } = await subscriberApi.subscribers.register.post({ name });
		key = data?.key!;
		id = data?.id!;
	});
	afterEach(() => {
		db.run("DELETE FROM subscriber");
	});
	
	describe("GET /subscribers/:name", () => {
		it("should successful get subscriber", async () => {
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
		it("should respond status code 404 if subscriber name doesn't exists", async () => {
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
		it("should the subscriber not registered", () => {
			db.run("DELETE FROM subscriber");
			const q = db.query("SELECT EXISTS (SELECT 1 FROM subscriber WHERE subscriberName = ?);");
			const obj = q.get(name) as { [k: string]: number };
			const isExists = !!Object.values(obj)[0];
			expect(isExists).toBe(false);
		});
		it("should successful register subscriber", async () => {
			db.run("DELETE FROM subscriber");
			const { data, status } = await subscriberApi.subscribers.register.post({ name });
			expect(status).toBe(201);
			expect(data?.id).toBeDefined();
			expect(data?.key).toBeDefined();
		});
		it("should respond status code 409 if subscriber already registered", async () => {
			const { status } = await subscriberApi.subscribers.register.post({ name });
			expect(status).toBe(409);
		});
	});

	describe("DELETE /subscribers/:name", () => {
		it("should successful delete subscriber", async () => {
			const { data, status } = await subscriberApi.subscribers({ name }).delete(null, {
				headers: {
					"authorization": "Bearer " + key,
					"x-tasks-subscriber-id": id
				}
			});
			expect(status).toBe(200);
			expect(data?.message).toBeDefined();
		});
		it("should respond status code 422 if subscriber tasks in queue greater than or equal to 1", async () => {
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