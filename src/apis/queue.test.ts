import { env } from "bun";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { treaty } from "@elysiajs/eden";

import { firstValueFrom, timer } from "rxjs";

import { queue } from "./queue";
import { subscriber } from "./subscriber";

const port = +env.PORT! || 3200;
const app = queue().listen(port)
const api = treaty(app);
const db = app.decorator.db;

describe("Test API", () => {
	const name = "test-queue-register";
	const apiSubscriber = treaty(
		subscriber().listen(port)
	);
	describe("GET /queues/:id", () => {
		beforeEach(() => {
			db.run("DELETE FROM subscriber WHERE subscriberName = ?;", [name]);
		});
		afterEach(() => {
			db.run("DELETE FROM subscriber WHERE subscriberName = ?;", [name]);
		});
		it("should successful get queue", async () => {
			const dueTime = 3000;
			const credential = await apiSubscriber.subscribers.register.post({ name });
			const { data, status } = await api.queues.register.post({
				httpRequest: {
					url: "https://www.starlink.com",
					method: "GET"
				},
				config: {
					...app.decorator.defaultConfig,
					executionDelay: dueTime
				}
			}, {
				headers: {
					"authorization": "Bearer " + credential.data?.key!,
					"x-tasks-subscriber-id": credential.data?.id!
				}
			});
			expect(status).toBe(201);
			const queue = await api.queues({ id: data?.id! }).get({
				headers: {
					"authorization": "Bearer " + credential.data?.key!,
					"x-tasks-subscriber-id": credential.data?.id!
				}
			});
			expect(queue.status).toBe(200);
			expect(queue.data).toHaveProperty("queueId");
			expect(queue.data).toHaveProperty("state");
			expect(queue.data).toHaveProperty("statusCode");
			expect(queue.data).toHaveProperty("estimateEndAt");
			expect(queue.data).toHaveProperty("estimateExecutionAt");
			// Waiting for task
			await firstValueFrom(timer(dueTime + 1000));
			// ...
			db.run("DELETE FROM queue WHERE queueId = ?;", [data?.id!]);
		});
	});

	describe("POST /queues/register", async () => {
		beforeEach(() => {
			db.run("DELETE FROM subscriber WHERE subscriberName = ?;", [name]);
		});
		afterEach(() => {
			db.run("DELETE FROM subscriber WHERE subscriberName = ?;", [name]);
		});
		it("should successful register queue and wait 3000ms until the task has been successfully executed", async () => {
			const dueTime = 3000;
			const credential = await apiSubscriber.subscribers.register.post({ name });
			const { data, status } = await api.queues.register.post({
				httpRequest: {
					url: "https://www.starlink.com",
					method: "GET"
				},
				config: {
					...app.decorator.defaultConfig,
					executionDelay: dueTime
				}
			}, {
				headers: {
					"authorization": "Bearer " + credential.data?.key!,
					"x-tasks-subscriber-id": credential.data?.id!
				}
			});
			expect(status).toBe(201);
			// Waiting for task
			await firstValueFrom(timer(dueTime + 1000));
			// ...
			const q = db.query("SELECT state, statusCode FROM queue WHERE queueId = ?;");
			const { state, statusCode } = q.get(data?.id!) as Pick<Queue, "state" | "statusCode">;
			expect(state).toBe("DONE");
			expect(statusCode).toBe(200);
			db.run("DELETE FROM queue WHERE queueId = ?;", [data?.id!]);
		});
		it("should successful register queue and wait 3000ms until the task gives an error response", async () => {
			const dueTime = 3000;
			const credential = await apiSubscriber.subscribers.register.post({ name });
			const { data, status } = await api.queues.register.post({
				httpRequest: {
					url: "https://api.starlink.com",
					method: "GET"
				},
				config: {
					...app.decorator.defaultConfig,
					executionDelay: dueTime
				}
			}, {
				headers: {
					"authorization": "Bearer " + credential.data?.key!,
					"x-tasks-subscriber-id": credential.data?.id!
				}
			});
			expect(status).toBe(201);
			// Waiting for task
			await firstValueFrom(timer(dueTime + 1000));
			// ...
			const q = db.query("SELECT state FROM queue WHERE queueId = ?;");
			const { state } = q.get(data?.id!) as Pick<Queue, "state">;
			expect(state).toBe("ERROR");
			db.run("DELETE FROM queue WHERE queueId = ?;", [data?.id!]);
		});
		it("should respond status code 400 if tasks in queue greater than tasks in queue limit", async () => {
			const dueTime = 3000;
			const { data } = await apiSubscriber.subscribers.register.post({ name });
			db.run("UPDATE subscriber SET tasksInQueue = tasksInQueue + 1000 WHERE subscriberName = ?;", [name]);
			const { status } = await api.queues.register.post({
				httpRequest: {
					url: "https://www.starlink.com",
					method: "GET"
				},
				config: {
					...app.decorator.defaultConfig,
					executionDelay: dueTime
				}
			}, {
				headers: {
					"authorization": "Bearer " + data?.key!,
					"x-tasks-subscriber-id": data?.id!
				}
			});
			expect(status).toBe(400);
		});
		it("should respond status code 400 if the execution time is earlier than the current time", async () => {
			const today = Date.now();
			const { data } = await apiSubscriber.subscribers.register.post({ name });
			const { status } = await api.queues.register.post({
				httpRequest: {
					url: "https://www.starlink.com",
					method: "GET"
				},
				config: {
					...app.decorator.defaultConfig,
					executeAt: today - 666
				}
			}, {
				headers: {
					"authorization": "Bearer " + data?.key!,
					"x-tasks-subscriber-id": data?.id!
				}
			});
			expect(status).toBe(400);
		});
		it("should respond status code 400 if the \"retryAt\" execution time is earlier than the current time", async () => {
			const today = Date.now();
			const { data } = await apiSubscriber.subscribers.register.post({ name });
			const { status } = await api.queues.register.post({
				httpRequest: {
					url: "https://www.starlink.com",
					method: "GET"
				},
				config: {
					...app.decorator.defaultConfig,
					retryAt: today - 666
				}
			}, {
				headers: {
					"authorization": "Bearer " + data?.key!,
					"x-tasks-subscriber-id": data?.id!
				}
			});
			expect(status).toBe(400);
		});
		it("should retrying 2 times if task gives an error response", async () => {
			const dueTime = 3000;
			const { data } = await apiSubscriber.subscribers.register.post({ name });
			const queue = await api.queues.register.post({
				httpRequest: {
					url: "https://api.starlink.com",
					method: "GET"
				},
				config: {
					...app.decorator.defaultConfig,
					executionDelay: dueTime,
					retry: 2,
					retryExponential: false
				}
			}, {
				headers: {
					"authorization": "Bearer " + data?.key!,
					"x-tasks-subscriber-id": data?.id!
				}
			});
			// Wait for tasks
			await firstValueFrom(timer(4000));
			// ...
			const q = db.query("SELECT q.state, c.retryCount FROM queue AS q JOIN config as c ON q.queueId = c.queueId WHERE q.queueId = ?;");
			const value = q.get(queue.data?.id!) as { state: string, retryCount: number } | null;
			expect(value?.state).toBe("ERROR");
			expect(value?.retryCount).toBe(2);
		});
	});

	describe("PATCH /queues/:id/unsubscribe", () => {
		beforeEach(() => {
			db.run("DELETE FROM subscriber WHERE subscriberName = ?;", [name]);
		});
		afterEach(() => {
			db.run("DELETE FROM subscriber WHERE subscriberName = ?;", [name]);
		});
		it("should successful unsubscribe queue", async () => {
			const dueTime = 3000;
			const credential = await apiSubscriber.subscribers.register.post({ name });
			const { data, status } = await api.queues.register.post({
				httpRequest: {
					url: "https://www.starlink.com",
					method: "GET"
				},
				config: {
					...app.decorator.defaultConfig,
					executionDelay: dueTime
				}
			}, {
				headers: {
					"authorization": "Bearer " + credential.data?.key!,
					"x-tasks-subscriber-id": credential.data?.id!
				}
			});
			expect(status).toBe(201);
			await firstValueFrom(timer(1000));
			const unsubscribe = await api.queues({ id: data?.id! }).unsubscribe.patch(null, {
				headers: {
					"authorization": "Bearer " + credential.data?.key!,
					"x-tasks-subscriber-id": credential.data?.id!
				}
			})
			expect(unsubscribe.status).toBe(200);
			expect(unsubscribe.data).toMatchObject({ message: "Done" });
			db.run("DELETE FROM queue WHERE queueId = ?;", [data?.id!]);
		});
	});
});