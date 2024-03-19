import { env } from "bun";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";

import { treaty } from "@elysiajs/eden";

import { subscriber } from "./subscriber";

const port = +env.PORT! || 3200;
const app = subscriber().listen(port);
const api = treaty(app);
const db = app.decorator.db;

describe("Test API", () => {
    beforeAll(() => {
        db.exec("PRAGMA journal_mode = WAL;");
    });
    describe("GET /subscribers/:name", async () => {
        const name = "test-get-subscribers";
        beforeEach(() => {
            db.run("DELETE FROM subscriber WHERE subscriberName = ?;", [name]);
        });
        afterEach(() => {
            db.run("DELETE FROM subscriber WHERE subscriberName = ?;", [name]);
        });
        it("should successful get subscriber", async () => {
            const credential = await api.subscribers.register.post({ name });
            const { data, status } = await api.subscribers({ name }).get({
                headers: {
                    "authorization": "Bearer " + credential.data?.key!,
                    "x-tasks-subscriber-id": credential.data?.id!
                }
            });
            expect(status).toBe(200);
            expect(data).toHaveProperty("id");
            expect(data).toHaveProperty("name");
            expect(data).toHaveProperty("createdAt");
            expect(data).toHaveProperty("tasksInQueue");
            expect(data).toHaveProperty("tasksInQueueLimit");
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
        it("should respond status code 404 if subscriber id does not match subscriber name", async () => {
            const credential = await api.subscribers.register.post({ name });
            const { status } = await api.subscribers({ name: "dummy" }).get({
                headers: {
                    "authorization": "Bearer " + credential.data?.key!,
                    "x-tasks-subscriber-id": credential.data?.id!
                }
            });
            expect(status).toBe(404);
        });
    });
    
    describe("POST /subscribers/register", () => {
        const name = "test-post-subscriber";
        beforeEach(() => {
            db.run("DELETE FROM subscriber WHERE subscriberName = ?;", [name]);
        });
        afterEach(() => {
            db.run("DELETE FROM subscriber WHERE subscriberName = ?;", [name]);
        });
        it("should the subscriber not registered", () => {
            const q = db.query("SELECT EXISTS (SELECT 1 FROM subscriber WHERE subscriberName = ?);");
            const obj = q.get(name) as { [k: string]: number };
            const isExists = !!Object.values(obj)[0];
            expect(isExists).toBe(false);
        });
        it("should successful register subscriber", async () => {
            const { data, status } = await api.subscribers.register.post({ name });
            expect(status).toBe(201);
            expect(data).toHaveProperty("id");
            expect(data).toHaveProperty("key");
        });
        it("should respond status code 409 if subscriber already registered", async () => {
            await api.subscribers.register.post({ name });
            const { status } = await api.subscribers.register.post({ name });
            expect(status).toBe(409);
        });
    });
    
    describe("DELETE /subscribers/:name", () => {
        const name = "test-delete-subscribers";
        beforeEach(() => {
            db.run("DELETE FROM subscriber WHERE subscriberName = ?;", [name]);
        });
        afterEach(() => {
            db.run("DELETE FROM subscriber WHERE subscriberName = ?;", [name]);
        });
        it("should successful delete subscriber", async () => {
            const { data } = await api.subscribers.register.post({ name });
            const { data: res, status } = await api.subscribers({ name }).delete(null, {
                headers: {
                    "authorization": "Bearer " + data?.key,
                    "x-tasks-subscriber-id": data?.id!
                }
            });
            expect(status).toBe(200);
            expect(res).toMatchObject({ message: "Done" });
        });
        it("should respond status code 400 if tasks in queue greater than or equal to 1", async () => {
            const { data } = await api.subscribers.register.post({ name });
            db.run("UPDATE subscriber SET tasksInQueue = tasksInQueue + 1 WHERE subscriberName = ?;", [name]);
            const { status } = await api.subscribers({ name }).delete(null, {
                headers: {
                    "authorization": "Bearer " + data?.key,
                    "x-tasks-subscriber-id": data?.id!
                }
            });
            expect(status).toBe(400);
        });
        it("should respond status code 401 if subscriber id is invalid", async () => {
            const { data } = await api.subscribers.register.post({ name });
            const { status } = await api.subscribers({ name }).delete(null, {
                headers: {
                    "authorization": "Bearer " + data?.key,
                    "x-tasks-subscriber-id": "dummy"
                }
            });
            expect(status).toBe(401);
        });
        it("should respond status code 403 if subscriber key is invalid", async () => {
            const { data } = await api.subscribers.register.post({ name });
            const { status } = await api.subscribers({ name }).delete(null, {
                headers: {
                    "authorization": "Bearer dummy",
                    "x-tasks-subscriber-id": data?.id!
                }
            });
            expect(status).toBe(403);
        });
    });
});