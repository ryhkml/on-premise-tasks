import { env } from "bun";
import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { edenFetch } from "@elysiajs/eden";

import { subscriber } from "./subscriber";

const port = +Bun.env.PORT! || 3200;
const app = subscriber.listen(port);
const api = edenFetch<typeof app>("http://localhost:" + port);
const db = new Database(env.PATH_SQLITE);

describe("API GET /subscribers/:name", async () => {
    const name = "test-get";
    beforeEach(() => {
        db.run("DELETE FROM subscriber WHERE subscriberName = ?;", [name]);
    });
    afterEach(() => {
        db.run("DELETE FROM subscriber WHERE subscriberName = ?;", [name]);
    });
    it("should successful get subscriber", async () => {
        const credential = await api("/subscriber", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: {
                name
            }
        });
        const { data, status } = await api("/subscribers/:name", {
            method: "GET",
            headers: {
                "Content-Type": "application/json",
                "Authorization": "Bearer " + credential.data?.key!,
                "X-Tasks-Subscriber-Id": credential.data?.id!
            },
            params: {
                name
            }
        });
        expect(status).toBe(200);
        expect(data).toHaveProperty("subscriberId");
        expect(data).toHaveProperty("subscriberName");
        expect(data).toHaveProperty("createdAt");
        expect(data).toHaveProperty("tasksInQueue");
        expect(data).toHaveProperty("tasksInQueueLimit");
    });
    it("should respond 400 if subscriber id does not match subscriber name", async () => {
        const credential = await api("/subscriber", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: {
                name
            }
        });
        const { status } = await api("/subscribers/:name", {
            method: "GET",
            headers: {
                "Content-Type": "application/json",
                "Authorization": "Bearer " + credential.data?.key!,
                "X-Tasks-Subscriber-Id": credential.data?.id!
            },
            params: {
                name: "dummy"
            }
        });
        expect(status).toBe(400);
    });
    it("should respond 401 if subscriber id is invalid", async () => {
        const credential = await api("/subscriber", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: {
                name
            }
        });
        const subsciber = await api("/subscribers/:name", {
            method: "GET",
            headers: {
                "Content-Type": "application/json",
                "Authorization": "Bearer " + credential.data?.key!,
                "X-Tasks-Subscriber-Id": "dummy"
            },
            params: {
                name
            }
        });
        expect(subsciber.status).toBe(401);
    });
    it("should respond 403 if subscriber key is invalid", async () => {
        const credential = await api("/subscriber", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: {
                name
            }
        });
        const subsciber = await api("/subscribers/:name", {
            method: "GET",
            headers: {
                "Content-Type": "application/json",
                "Authorization": "Bearer dummy",
                "X-Tasks-Subscriber-Id": credential.data?.id!
            },
            params: {
                name
            }
        });
        expect(subsciber.status).toBe(403);
    });
});

describe("API POST /subscriber", () => {
    const name = "test-post";
    beforeEach(() => {
        db.run("DELETE FROM subscriber WHERE subscriberName = ?;", [name]);
    });
    afterEach(() => {
        db.run("DELETE FROM subscriber WHERE subscriberName = ?;", [name]);
    });
    it("should successful register subscriber", async () => {
        const q = db.query("SELECT EXISTS (SELECT 1 FROM subscriber WHERE subscriberName = ?);");
        const obj = q.get(name) as { [k: string]: number };
        const isExists = !!Object.values(obj)[0];
        expect(isExists).toBeFalsy();
        const { data, status } = await api("/subscriber", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: {
                name
            }
        });
        expect(status).toBe(201);
        expect(data).toHaveProperty("id");
        expect(data).toHaveProperty("key");
    });
    it("should respond 409 if subscriber already registered", async () => {
        await api("/subscriber", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: {
                name
            }
        });
        const { status } = await api("/subscriber", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: {
                name
            }
        });
        expect(status).toBe(409);
    });
});

describe("API DELETE /subscribers/:name", () => {
    const name = "test-delete";
    beforeEach(() => {
        db.run("DELETE FROM subscriber WHERE subscriberName = ?;", [name]);
    });
    afterEach(() => {
        db.run("DELETE FROM subscriber WHERE subscriberName = ?;", [name]);
    });
    it("should successful delete subscriber", async () => {
        const credential = await api("/subscriber", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: {
                name
            }
        });
        const { status } = await api("/subscribers/:name", {
            method: "DELETE",
            headers: {
                "Authorization": "Bearer " + credential.data?.key!,
                "X-Tasks-Subscriber-Id": credential.data?.id!
            },
            params: {
                name
            }
        });
        expect(status).toBe(200);
    });
    it("should respond 400 if tasksInQueue subscriber greater than or equal to 1", async () => {
        const credential = await api("/subscriber", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: {
                name
            }
        });
        db.run("UPDATE subscriber SET tasksInQueue = tasksInQueue + 1 WHERE subscriberName = ?;", [name]);
        const { status } = await api("/subscribers/:name", {
            method: "DELETE",
            headers: {
                "Authorization": "Bearer " + credential.data?.key!,
                "X-Tasks-Subscriber-Id": credential.data?.id!
            },
            params: {
                name
            }
        });
        expect(status).toBe(400);
    });
    it("should respond 401 if subscriber id is invalid", async () => {
        const credential = await api("/subscriber", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: {
                name
            }
        });
        const subsciber = await api("/subscribers/:name", {
            method: "DELETE",
            headers: {
                "Authorization": "Bearer " + credential.data?.key!,
                "X-Tasks-Subscriber-Id": "dummy"
            },
            params: {
                name
            }
        });
        expect(subsciber.status).toBe(401);
    });
    it("should respond 403 if subscriber key is invalid", async () => {
        const credential = await api("/subscriber", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: {
                name
            }
        });
        const subsciber = await api("/subscribers/:name", {
            method: "DELETE",
            headers: {
                "Authorization": "Bearer dummy",
                "X-Tasks-Subscriber-Id": credential.data?.id!
            },
            params: {
                name
            }
        });
        expect(subsciber.status).toBe(403);
    });
});