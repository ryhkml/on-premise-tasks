import { env } from "bun";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { treaty } from "@elysiajs/eden";

import { firstValueFrom, timer } from "rxjs";
import { addMilliseconds } from "date-fns";

import { queue } from "./queue";
import { subscriber } from "./subscriber";

const subscriberApi = treaty(subscriber().listen(+env.PORT! || 3200));
const queueApp = queue().listen(+env.PORT! || 3200)
const queueApi = treaty(queueApp);
const name = "test-queue";
const db = queueApp.decorator.db;

let queueId = "";
let key = "";
let id = "";

describe("Test API", () => {
	const stmtC = db.prepare<void, string>("DELETE FROM config WHERE queueId = ?;");
	const stmtQ = db.prepare<void, string>("DELETE FROM queue WHERE subscriberId = ?;");
	const stmtS = db.prepare<void, string>("DELETE FROM subscriber WHERE subscriberName = ?;");

	beforeEach(async () => {
		const { data } = await subscriberApi.subscribers.register.post({ name });
		key = data?.key!;
		id = data?.id!;
	});
	afterEach(() => {
		db.transaction(() => {
			stmtC.run(queueId);
			stmtQ.run(id);
			stmtS.run(name);
		})();
	});

	describe("GET /queues/:id", () => {
		it("should successfully get the queue", async () => {
			const dueTime = 3000;
			const { data, status } = await queueApi.queues.register.post({
				httpRequest: {
					url: "https://www.starlink.com",
					method: "GET"
				},
				config: {
					...queueApp.decorator.defaultConfig,
					executionDelay: dueTime
				}
			}, {
				headers: {
					"authorization": "Bearer " + key,
					"x-tasks-subscriber-id": id
				}
			});
			queueId = data?.id!;
			expect(status).toBe(201);
			expect(data?.id).toBeDefined();
			const queue = await queueApi.queues({ id: data?.id! }).get({
				headers: {
					"authorization": "Bearer " + key,
					"x-tasks-subscriber-id": id
				}
			});
			expect(queue.status).toBe(200);
			expect(queue.data?.id).toBeDefined();
			expect(queue.data?.state).toBeDefined();
			expect(queue.data?.statusCode).toBeDefined();
			expect(queue.data?.estimateEndAt).toBeDefined();
			expect(queue.data?.estimateExecutionAt).toBeDefined();
			// Waiting for task
			await firstValueFrom(timer(dueTime + 1000));
		});
	});

	describe("POST /queues/register", () => {
		it("should successfully register the queue and wait 3000 milliseconds until the task has been successfully executed", async () => {
			const dueTime = 3000;
			const { data, status } = await queueApi.queues.register.post({
				httpRequest: {
					url: "https://www.starlink.com",
					method: "GET"
				},
				config: {
					...queueApp.decorator.defaultConfig,
					executionDelay: dueTime
				}
			}, {
				headers: {
					"authorization": "Bearer " + key,
					"x-tasks-subscriber-id": id
				}
			});
			queueId = data?.id!;
			expect(status).toBe(201);
			expect(data?.id).toBeDefined();
			// Waiting for task
			await firstValueFrom(timer(dueTime + 1000));
			// ...
			const q = db.query<Pick<QueueTable, "state" | "statusCode">, string>("SELECT state, statusCode FROM queue WHERE queueId = ?;");
			const { state, statusCode } = q.get(data?.id!)!;
			expect(state).toBe("DONE");
			expect(statusCode).toBe(200);
		});
		it("should successfully register the queue and wait 3000 milliseconds until the task returns an error response", async () => {
			const dueTime = 3000;
			const { data, status } = await queueApi.queues.register.post({
				httpRequest: {
					url: "https://api.starlink.com",
					method: "GET"
				},
				config: {
					...queueApp.decorator.defaultConfig,
					executionDelay: dueTime
				}
			}, {
				headers: {
					"authorization": "Bearer " + key,
					"x-tasks-subscriber-id": id
				}
			});
			queueId = data?.id!;
			expect(status).toBe(201);
			expect(data?.id).toBeDefined();
			// Waiting for task
			await firstValueFrom(timer(dueTime * 2));
			// ...
			const q = db.query<Pick<QueueTable, "state">, string>("SELECT state FROM queue WHERE queueId = ?;");
			const { state } = q.get(data?.id!)!;
			expect(state).toBe("ERROR");
		});
		it("should respond with status code 400 if the execution time is earlier than the current time.", async () => {
			const { status } = await queueApi.queues.register.post({
				httpRequest: {
					url: "https://www.starlink.com",
					method: "GET"
				},
				config: {
					...queueApp.decorator.defaultConfig,
					executeAt: Date.now() - 666
				}
			}, {
				headers: {
					"authorization": "Bearer " + key,
					"x-tasks-subscriber-id": id
				}
			});
			expect(status).toBe(400);
		});
		it("should respond with status code 400 if the \"retryAt\" execution time is earlier than the execution time", async () => {
			const dueTime = 3000;
			const estimateExecutionTime = addMilliseconds(Date.now(), dueTime).getTime();
			const { status } = await queueApi.queues.register.post({
				httpRequest: {
					url: "https://www.starlink.com",
					method: "GET"
				},
				config: {
					...queueApp.decorator.defaultConfig,
					executionDelay: dueTime,
					retryAt: estimateExecutionTime - 666
				}
			}, {
				headers: {
					"authorization": "Bearer " + key,
					"x-tasks-subscriber-id": id
				}
			});
			expect(status).toBe(400);
		});
		it("should respond with status code 429 if the number of tasks in queue is greater than the task in queue limit", async () => {
			db.run("UPDATE subscriber SET tasksInQueue = 1000 WHERE subscriberName = ?;", [name]);
			const dueTime = 3000;
			const { status } = await queueApi.queues.register.post({
				httpRequest: {
					url: "https://www.starlink.com",
					method: "GET"
				},
				config: {
					...queueApp.decorator.defaultConfig,
					executionDelay: dueTime
				}
			}, {
				headers: {
					"authorization": "Bearer " + key,
					"x-tasks-subscriber-id": id
				}
			});
			expect(status).toBe(429);
		});
		it("should retry 3 times if the task gives an error response", async () => {
			const dueTime = 3000;
			const { data, status } = await queueApi.queues.register.post({
				httpRequest: {
					url: "https://api.starlink.com",
					method: "GET"
				},
				config: {
					...queueApp.decorator.defaultConfig,
					executionDelay: dueTime,
					retry: 3,
					retryInterval: 1,
					retryExponential: false
				}
			}, {
				headers: {
					"authorization": "Bearer " + key,
					"x-tasks-subscriber-id": id
				}
			});
			queueId = data?.id!;
			expect(status).toBe(201);
			expect(data?.id).toBeDefined();
			// Wait for tasks
			await firstValueFrom(timer(dueTime + 1500));
			// ...
			const q = db.query<Pick<QueueTable, "state"> & Pick<ConfigTable, "retryCount">, string>("SELECT q.state, c.retryCount FROM queue AS q INNER JOIN config AS c ON q.queueId = c.queueId WHERE q.queueId = ?;");
			const value = q.get(data?.id!);
			expect(value?.state).toBe("ERROR");
			expect(value?.retryCount).toBe(3);
		});
	});

	describe("PATCH /queues/:id/pause", () => {
		it("should successfully pause the queue", async () => {
			const dueTime = 3000;
			const { data, status } = await queueApi.queues.register.post({
				httpRequest: {
					url: "https://www.starlink.com",
					method: "GET"
				},
				config: {
					...queueApp.decorator.defaultConfig,
					executionDelay: dueTime
				}
			}, {
				headers: {
					"authorization": "Bearer " + key,
					"x-tasks-subscriber-id": id
				}
			});
			queueId = data?.id!;
			expect(status).toBe(201);
			expect(data?.id).toBeDefined();
			// Wait for task
			await firstValueFrom(timer(dueTime / 2));
			// ...
			const pause = await queueApi.queues({ id: data?.id! }).pause.patch(null, {
				headers: {
					"authorization": "Bearer " + key,
					"x-tasks-subscriber-id": id
				}
			});
			expect(pause.status).toBe(200);
			expect(pause.data?.message).toBeDefined();
			const q = db.query<Pick<QueueTable, "state">, string>("SELECT state FROM queue WHERE queueId = ?;");
			const value = q.get(data?.id!);
			expect(value?.state).toBe("PAUSED");
		});
	});

	describe("PATCH /queues/:id/resume", () => {
		it("should successfully pause the queue and then resume queue", async () => {
			const dueTime = 3000;
			const { data, status } = await queueApi.queues.register.post({
				httpRequest: {
					url: "https://www.starlink.com",
					method: "GET"
				},
				config: {
					...queueApp.decorator.defaultConfig,
					executionDelay: dueTime
				}
			}, {
				headers: {
					"authorization": "Bearer " + key,
					"x-tasks-subscriber-id": id
				}
			});
			queueId = data?.id!;
			expect(status).toBe(201);
			expect(data?.id).toBeDefined();
			// ...
			await firstValueFrom(timer(1000));
			// Pause
			const pause = await queueApi.queues({ id: data?.id! }).pause.patch(null, {
				headers: {
					"authorization": "Bearer " + key,
					"x-tasks-subscriber-id": id
				}
			});
			expect(pause.status).toBe(200);
			expect(pause.data?.message).toBeDefined();
			const q1 = db.query<Pick<QueueTable, "state">, string>("SELECT state FROM queue WHERE queueId = ?;");
			const value1 = q1.get(data?.id!);
			expect(value1?.state).toBe("PAUSED");
			// ...
			await firstValueFrom(timer(1000));
			// Resume
			const resume = await queueApi.queues({ id: data?.id! }).resume.patch(null, {
				headers: {
					"authorization": "Bearer " + key,
					"x-tasks-subscriber-id": id
				}
			});
			expect(resume.status).toBe(200);
			expect(resume.data?.message).toBeDefined();
			const q2 = db.query<Pick<QueueTable, "state">, string>("SELECT state FROM queue WHERE queueId = ?;");
			const value2 = q2.get(data?.id!);
			expect(value2?.state).toBe("RUNNING");
			// Unsubscribe
			await queueApi.queues({ id: data?.id! }).unsubscribe.patch(null, {
				headers: {
					"authorization": "Bearer " + key,
					"x-tasks-subscriber-id": id
				}
			});
		});
	});

	describe("PATCH /queues/:id/unsubscribe", () => {
		it("should successfully unsubscribe the queue", async () => {
			const dueTime = 3000;
			const { data, status } = await queueApi.queues.register.post({
				httpRequest: {
					url: "https://www.starlink.com",
					method: "GET"
				},
				config: {
					...queueApp.decorator.defaultConfig,
					executionDelay: dueTime
				}
			}, {
				headers: {
					"authorization": "Bearer " + key,
					"x-tasks-subscriber-id": id
				}
			});
			queueId = data?.id!;
			expect(status).toBe(201);
			expect(data?.id).toBeDefined();
			// Wait for task
			await firstValueFrom(timer(dueTime / 2));
			// ...
			const unsubscribe = await queueApi.queues({ id: data?.id! }).unsubscribe.patch(null, {
				headers: {
					"authorization": "Bearer " + key,
					"x-tasks-subscriber-id": id
				}
			});
			expect(unsubscribe.status).toBe(200);
			expect(unsubscribe.data?.message).toBeDefined();
		});
	});

	describe("DELETE /queues/:id", () => {
		it("should successfully delete the queue", async () => {
			const dueTime = 3000;
			const { data, status } = await queueApi.queues.register.post({
				httpRequest: {
					url: "https://www.starlink.com",
					method: "GET"
				},
				config: {
					...queueApp.decorator.defaultConfig,
					executionDelay: dueTime
				}
			}, {
				headers: {
					"authorization": "Bearer " + key,
					"x-tasks-subscriber-id": id
				}
			});
			queueId = data?.id!;
			expect(status).toBe(201);
			expect(data?.id).toBeDefined();
			// Waiting for task
			await firstValueFrom(timer(dueTime + 1000));
			// ...
			const deleted = await queueApi.queues({ id: data?.id! }).delete(null, {
				headers: {
					"authorization": "Bearer " + key,
					"x-tasks-subscriber-id": id
				},
				query: {

				}
			});
			expect(deleted.status).toBe(200);
			expect(deleted.data?.message).toBeDefined();
			const q = db.query<QueueTable, string>("SELECT * FROM queue WHERE queueId = ?;");
			const queue = q.get(data?.id!);
			expect(queue).toBe(null);
		});
		it("should successfully force delete the queue", async () => {
			const dueTime = 3000;
			const { data, status } = await queueApi.queues.register.post({
				httpRequest: {
					url: "https://www.starlink.com",
					method: "GET"
				},
				config: {
					...queueApp.decorator.defaultConfig,
					executionDelay: dueTime
				}
			}, {
				headers: {
					"authorization": "Bearer " + key,
					"x-tasks-subscriber-id": id
				}
			});
			queueId = data?.id!;
			expect(status).toBe(201);
			expect(data?.id).toBeDefined();
			// Waiting for task
			await firstValueFrom(timer(dueTime / 2));
			// ...
			const deleted = await queueApi.queues({ id: data?.id! }).delete(null, {
				headers: {
					"authorization": "Bearer " + key,
					"x-tasks-subscriber-id": id
				},
				query: {
					force: 1
				}
			});
			expect(deleted.status).toBe(200);
			expect(deleted.data?.message).toBeDefined();
			const q = db.query<QueueTable, string>("SELECT * FROM queue WHERE queueId = ?;");
			const queue = q.get(data?.id!);
			expect(queue).toBe(null);
		});
		it("should respond with status code 422 if tasks in queue are deleted without force", async () => {
			const dueTime = 3000;
			const { data, status } = await queueApi.queues.register.post({
				httpRequest: {
					url: "https://www.starlink.com",
					method: "GET"
				},
				config: {
					...queueApp.decorator.defaultConfig,
					executionDelay: dueTime
				}
			}, {
				headers: {
					"authorization": "Bearer " + key,
					"x-tasks-subscriber-id": id
				}
			});
			queueId = data?.id!;
			expect(status).toBe(201);
			expect(data?.id).toBeDefined();
			// Waiting for task
			await firstValueFrom(timer(dueTime / 2));
			// ...
			const deleted = await queueApi.queues({ id: data?.id! }).delete(null, {
				headers: {
					"authorization": "Bearer " + key,
					"x-tasks-subscriber-id": id
				},
				query: {

				}
			});
			expect(deleted.status).toBe(422);
		});
	});
});