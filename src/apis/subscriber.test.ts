import { env } from "bun";
import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { edenFetch } from "@elysiajs/eden";

import { subscriber } from "./subscriber";

const port = +Bun.env.PORT! || 3200;
const app = subscriber.listen(port);
const api = edenFetch<typeof app>("http://localhost:" + port);
const db = new Database(env.PATH_SQLITE);

describe("Path subscribers", () => {
    it("should contain path /subscribers/:v", () => {
        const path = subscriber.routes.map(item => item.path);
        expect(path).toContain("/subscribers/:v");
    });
});
describe("API /subscriber/:v", async () => {
    const username = "guest1";
    afterEach(() => {
        db.run("DELETE FROM subscriber WHERE username = ?1;", [username]);
    });
    it("should successful get subscriber", async () => {
        const credential = await api("/subscriber", {
            method: "POST",
            body: {
                username,
                requestAt: Date.now()
            }
        });
        const subsciber = await api("/subscribers/:v", {
            headers: {
                "authorization": "Bearer " + credential.data?.key!,
                "x-tasks-subsciber-id": credential.data?.id!
            },
            params: {
                v: username
            }
        });
        expect(subsciber.status).toBe(200);
        expect(subsciber.data).toHaveProperty("id");
        expect(subsciber.data).toHaveProperty("username");
        expect(subsciber.data).toHaveProperty("createdAt");
        expect(subsciber.data).toHaveProperty("tasksInQueue");
        expect(subsciber.data).toHaveProperty("tasksInQueueLimit");
    });
    it("should respond with 404 if subscriber not found", async () => {
        const credential = await api("/subscriber", {
            method: "POST",
            body: {
                username,
                requestAt: Date.now()
            }
        });
        const subsciber = await api("/subscribers/:v", {
            headers: {
                "authorization": "Bearer " + credential.data?.key!,
                "x-tasks-subsciber-id": credential.data?.id!
            },
            params: {
                v: "dummy"
            }
        });
        expect(subsciber.status).toBe(404);
    });
});

describe("Path subscriber", () => {
    it("should contain path /subscriber", () => {
        const path = subscriber.routes.map(item => item.path);
        expect(path).toContain("/subscriber");
    });
});
describe("API /subscriber", () => {
    const username = "guest2";
    beforeEach(() => {
        db.run("DELETE FROM subscriber WHERE username = ?1;", [username]);
    });
    afterEach(() => {
        db.run("DELETE FROM subscriber WHERE username = ?1;", [username]);
    });
    it("should successful registration", async () => {
        const q = db.query("SELECT EXISTS (SELECT 1 FROM subscriber WHERE username = @username);");
        const obj = q.get({ "@username": username }) as { [k: string]: number };
        const notExists = !!Object.values(obj)[0];
        expect(notExists).toBeFalsy();
        const { data, status } = await api("/subscriber", {
            method: "POST",
            body: {
                username,
                requestAt: Date.now()
            }
        });
        expect(status).toBe(201);
        expect(data).toHaveProperty("id");
        expect(data).toHaveProperty("key");
    });
    it("should respond with 409 if subscriber already registered", async () => {
        await api("/subscriber", {
            method: "POST",
            body: {
                username,
                requestAt: Date.now()
            }
        });
        const { status } = await api("/subscriber", {
            method: "POST",
            body: {
                username,
                requestAt: Date.now()
            }
        });
        expect(status).toBe(409);
    });
});