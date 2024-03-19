import { env } from "bun";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";

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
    beforeAll(() => {
        db.exec("PRAGMA journal_mode = WAL;");
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
    });
});