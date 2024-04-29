import { env, sleep } from "bun";
import { afterEach, beforeEach, describe, expect, it, setSystemTime } from "bun:test";

import { treaty } from "@elysiajs/eden";

import { queue } from "./queue";
import { subscriber } from "./subscriber";

const subscriberApi = treaty(subscriber().listen(+env.PORT! || 3200));
const queueApp = queue().listen(+env.PORT! || 3200)
const queueApi = treaty(queueApp);
const name = "test-queue";
const db = queueApp.decorator.db;

let key = "";
let id = "";

describe("Test API", () => {
	const stmtQ = db.prepare<void, string>("DELETE FROM queue WHERE subscriberId = ?;");
	const stmtS = db.prepare<void, string>("DELETE FROM subscriber WHERE name = ?;");

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

	describe("GET /queues", () => {
		it("should successfully get the queues", async () => {
			const { data, status } = await queueApi.queues.register.post({
				httpRequest: {
					url: "https://dummyjson.com/todos/1",
					method: "GET"
				},
				config: {
					...queueApp.decorator.defaultConfig,
					executionDelay: 1
				}
			}, {
				headers: {
					"authorization": "Bearer " + key,
					"x-tasks-subscriber-id": id
				}
			});
			expect(status).toBe(201);
			expect(data?.id).toBeDefined();
			const queues = await queueApi.queues.get({
				headers: {
					"authorization": "Bearer " + key,
					"x-tasks-subscriber-id": id
				},
				query: {

				}
			});
			expect(queues.status).toBe(200);
			expect(queues.data).toBeArray();
			expect(queues.data).toBeArrayOfSize(1);
			await sleep(1000);
		});
		it("should successfully get the queues with \"limit\" query", async () => {
			for (let i = 0; i < 5; i++) {
				const tId = i + 1;
				const { data, status } = await queueApi.queues.register.post({
					httpRequest: {
						url: "https://dummyjson.com/todos/" + tId.toString(),
						method: "GET"
					},
					config: {
						...queueApp.decorator.defaultConfig,
						executionDelay: 1
					}
				}, {
					headers: {
						"authorization": "Bearer " + key,
						"x-tasks-subscriber-id": id
					}
				});
				expect(status).toBe(201);
				expect(data?.id).toBeDefined();
			}
			const queues = await queueApi.queues.get({
				headers: {
					"authorization": "Bearer " + key,
					"x-tasks-subscriber-id": id
				},
				query: {
					limit: 5
				}
			});
			expect(queues.status).toBe(200);
			expect(queues.data).toBeArrayOfSize(5);
			await sleep(1000);
		});
		it("should successfully get the queues with \"offset\" query", async () => {
			for (let i = 0; i < 5; i++) {
				const tId = i + 1;
				const { data, status } = await queueApi.queues.register.post({
					httpRequest: {
						url: "https://dummyjson.com/todos/" + tId.toString(),
						method: "GET"
					},
					config: {
						...queueApp.decorator.defaultConfig,
						executionDelay: 1
					}
				}, {
					headers: {
						"authorization": "Bearer " + key,
						"x-tasks-subscriber-id": id
					}
				});
				expect(status).toBe(201);
				expect(data?.id).toBeDefined();
			}
			const queues = await queueApi.queues.get({
				headers: {
					"authorization": "Bearer " + key,
					"x-tasks-subscriber-id": id
				},
				query: {
					offset: 1
				}
			});
			expect(queues.status).toBe(200);
			expect(queues.data).toBeArrayOfSize(4);
			await sleep(1000);
		});
	});

	describe("GET /queues/:id", () => {
		it("should successfully get the queue", async () => {
			const dueTime = 1000;
			const { data, status } = await queueApi.queues.register.post({
				httpRequest: {
					url: "https://dummyjson.com/todos/1",
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
			// Waiting for task
			await sleep(dueTime + 1000);
		});
	});

	describe("POST /queues/register", () => {
		it("should successfully register the queue and wait one seconds until the task has been successfully executed", async () => {
			const dueTime = 1000;
			const { data, status } = await queueApi.queues.register.post({
				httpRequest: {
					url: "https://dummyjson.com/todos/1",
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
			expect(status).toBe(201);
			expect(data?.id).toBeDefined();
			// Waiting for task
			await sleep(dueTime * 2);
			// ...
			const q = db.query<Pick<QueueTable, "state" | "statusCode">, string>("SELECT state, statusCode FROM queue WHERE id = ?;");
			const { state, statusCode } = q.get(data?.id!)!;
			expect(state).toBe("DONE");
			expect(statusCode).toBe(200);
		});
		it("should successfully register the queue and wait one seconds until the task returns an error response", async () => {
			const dueTime = 1000;
			const { data, status } = await queueApi.queues.register.post({
				httpRequest: {
					url: "https://dummyjson.com/todos/0",
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
			expect(status).toBe(201);
			expect(data?.id).toBeDefined();
			// Waiting for task
			await sleep(dueTime * 2);
			// ...
			const q = db.query<Pick<QueueTable, "state">, string>("SELECT state FROM queue WHERE id = ?;");
			const { state } = q.get(data?.id!)!;
			expect(state).toBe("ERROR");
		});
		it("should respond with status code 400 if the execution time is earlier than the current time.", async () => {
			// It was 2012 for a moment.. 💀
			setSystemTime(new Date("2012-12-12"));
			const executeAt = new Date().getTime();
			expect(new Date().getFullYear()).toBe(2012);
			// Reset
			setSystemTime();
			const { status } = await queueApi.queues.register.post({
				httpRequest: {
					url: "https://dummyjson.com/todos/1",
					method: "GET"
				},
				config: {
					...queueApp.decorator.defaultConfig,
					executeAt
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
			// It was 2012 for a moment.. 💀
			setSystemTime(new Date("2012-12-12"));
			const dueTime = 1000;
			const retryAt = new Date().getTime() + dueTime;
			expect(new Date().getFullYear()).toBe(2012);
			// Reset
			setSystemTime();
			const { status } = await queueApi.queues.register.post({
				httpRequest: {
					url: "https://dummyjson.com/todos/1",
					method: "GET"
				},
				config: {
					...queueApp.decorator.defaultConfig,
					executionDelay: dueTime,
					retryAt
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
			db.run("UPDATE subscriber SET tasksInQueue = 1000 WHERE name = ?;", [name]);
			const dueTime = 1000;
			const { status } = await queueApi.queues.register.post({
				httpRequest: {
					url: "https://dummyjson.com/todos/1",
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
			const dueTime = 1000;
			const { data, status } = await queueApi.queues.register.post({
				httpRequest: {
					url: "https://dummyjson.com/todos/0",
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
			expect(status).toBe(201);
			expect(data?.id).toBeDefined();
			// Wait for tasks
			await sleep((dueTime * 3) + dueTime);
			// ...
			const q = db.query<Pick<QueueTable, "state"> & Pick<ConfigTable, "retryCount">, string>("SELECT q.state, c.retryCount FROM queue AS q INNER JOIN config AS c ON q.id = c.id WHERE q.id = ?;");
			const value = q.get(data?.id!);
			expect(value?.state).toBe("ERROR");
			expect(value?.retryCount).toBe(3);
		});
	});

	describe("PATCH /queues/:id/pause", () => {
		it("should successfully pause the queue", async () => {
			const dueTime = 1000;
			const { data, status } = await queueApi.queues.register.post({
				httpRequest: {
					url: "https://dummyjson.com/todos/1",
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
			expect(status).toBe(201);
			expect(data?.id).toBeDefined();
			// Wait for task
			await sleep(dueTime / 2);
			// ...
			const pause = await queueApi.queues({ id: data?.id! }).pause.patch(null, {
				headers: {
					"authorization": "Bearer " + key,
					"x-tasks-subscriber-id": id
				}
			});
			expect(pause.status).toBe(200);
			expect(pause.data?.message).toBeDefined();
			const q = db.query<Pick<QueueTable, "state">, string>("SELECT state FROM queue WHERE id = ?;");
			const value = q.get(data?.id!);
			expect(value?.state).toBe("PAUSED");
		});
	});

	describe("PATCH /queues/:id/resume", () => {
		it("should successfully pause the queue and then resume queue", async () => {
			const dueTime = 1000;
			const { data, status } = await queueApi.queues.register.post({
				httpRequest: {
					url: "https://dummyjson.com/todos/1",
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
			expect(status).toBe(201);
			expect(data?.id).toBeDefined();
			// ...
			await sleep(1000);
			// Pause
			const pause = await queueApi.queues({ id: data?.id! }).pause.patch(null, {
				headers: {
					"authorization": "Bearer " + key,
					"x-tasks-subscriber-id": id
				}
			});
			expect(pause.status).toBe(200);
			expect(pause.data?.message).toBeDefined();
			const q1 = db.query<Pick<QueueTable, "state">, string>("SELECT state FROM queue WHERE id = ?;");
			const value1 = q1.get(data?.id!);
			expect(value1?.state).toBe("PAUSED");
			// ...
			await sleep(1000);
			// Resume
			const resume = await queueApi.queues({ id: data?.id! }).resume.patch(null, {
				headers: {
					"authorization": "Bearer " + key,
					"x-tasks-subscriber-id": id
				}
			});
			expect(resume.status).toBe(200);
			expect(resume.data?.message).toBeDefined();
			const q2 = db.query<Pick<QueueTable, "state">, string>("SELECT state FROM queue WHERE id = ?;");
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
			const dueTime = 1000;
			const { data, status } = await queueApi.queues.register.post({
				httpRequest: {
					url: "https://dummyjson.com/todos/1",
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
			expect(status).toBe(201);
			expect(data?.id).toBeDefined();
			// Wait for task
			await sleep(dueTime / 2);
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
			const dueTime = 1000;
			const { data, status } = await queueApi.queues.register.post({
				httpRequest: {
					url: "https://dummyjson.com/todos/1",
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
			expect(status).toBe(201);
			expect(data?.id).toBeDefined();
			// Waiting for task
			await sleep(dueTime * 2);
			// ...
			const deleted = await queueApi.queues({ id: data?.id! }).delete(null, {
				headers: {
					"authorization": "Bearer " + key,
					"x-tasks-subscriber-id": id
				},
				// @ts-ignore
				query: undefined
			});
			expect(deleted.status).toBe(200);
			expect(deleted.data?.message).toBeDefined();
			const q = db.query<QueueTable, string>("SELECT * FROM queue WHERE id = ?;");
			const queue = q.get(data?.id!);
			expect(queue).toBe(null);
		});
		it("should successfully force delete the queue", async () => {
			const dueTime = 1000;
			const { data, status } = await queueApi.queues.register.post({
				httpRequest: {
					url: "https://dummyjson.com/todos/1",
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
			expect(status).toBe(201);
			expect(data?.id).toBeDefined();
			// Waiting for task
			await sleep(dueTime / 2);
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
			const q = db.query<QueueTable, string>("SELECT * FROM queue WHERE id = ?;");
			const queue = q.get(data?.id!);
			expect(queue).toBe(null);
		});
		it("should respond with status code 422 if tasks in queue are deleted without force", async () => {
			const dueTime = 1000;
			const { data, status } = await queueApi.queues.register.post({
				httpRequest: {
					url: "https://dummyjson.com/todos/1",
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
			expect(status).toBe(201);
			expect(data?.id).toBeDefined();
			// Waiting for task
			await sleep(dueTime / 2);
			// ...
			const deleted = await queueApi.queues({ id: data?.id! }).delete(null, {
				headers: {
					"authorization": "Bearer " + key,
					"x-tasks-subscriber-id": id
				},
				// @ts-ignore
				query: undefined
			});
			expect(deleted.status).toBe(422);
		});
	});
});