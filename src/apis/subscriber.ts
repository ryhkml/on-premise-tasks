import { env, password } from "bun";
import { Database } from "bun:sqlite";

import { Elysia, t } from "elysia";
import { ulid } from "ulid";

import { isValidSubscriber } from "../auth/auth";

export type SubscriberContext = {
    id: string;
    username: string;
    createdAt: number;
    secretKey: string;
    tasksInQueue: number;
    tasksInQueueLimit: number;
}

const db = new Database(env.PATH_SQLITE);

export const subscriber = new Elysia()
    .get("/subscribers/:v", ctx => {
        const value = getSubscriber(ctx.params.v);
        if (value) {
            return value;
        }
        ctx.set.status = "Not Found";
        return null;
    }, {
        transform: ctx => {
            ctx.params.v = ctx.params.v.trim();
        },
        beforeHandle: async ctx => {
            if (ctx.params.v == "") {
                ctx.set.status = "Bad Request";
                return {
                    message: ""
                };
            }
            // @ts-ignore
            return await isValidSubscriber(ctx);
        },
        params: t.Object({
            v: t.String({
                default: "",
                minLength: 3
            })
        })
    })
    .post("/subscriber", async ctx => {
        const id = ulid();
        const plainKey = "t-" + Buffer.from(id + ":" + ctx.body.requestAt).toString("base64");
        const secretKey = await password.hash(plainKey, {
            algorithm: "argon2id",
            memoryCost: 4,
            timeCost: 3
        });
        await addSubscriber({
            id,
            username: ctx.body.username,
            createdAt: ctx.body.requestAt,
            secretKey,
            tasksInQueue: 0,
            tasksInQueueLimit: 1000
        });
        ctx.set.status = "Created";
        return {
            id,
            key: plainKey
        };
    }, {
        transform: ctx => {
            ctx.body.requestAt = Date.now();
            ctx.body.username = ctx.body.username.toLowerCase().trim();
        },
        beforeHandle: ctx => {
            const registered = isSubscriberRegistered(ctx.body.username);
            if (registered) {
                ctx.set.status = "Conflict";
                return {
                    message: "Project is already registered"
                };
            }
        },
        body: t.Object({
            username: t.Lowercase(
                t.String({
                    default: "",
                    minLength: 3,
                    maxLength: 32
                })
            ),
            requestAt: t.Number()
        })
    });

const isSubscriberRegistered = (username: string) => {
    try {
        const q = db.query("SELECT EXISTS (SELECT 1 FROM subscriber WHERE username = @username);");
        const obj = q.get({ "@username": username }) as { [k: string]: number };
        const value = Object.values(obj)[0];
        q.finalize();
        return !!value;
    } catch (e) {
        console.error(e);
        return true;
    }
};

const addSubscriber = (ctx: SubscriberContext) => {
    try {
        db.run("INSERT INTO subscriber (id, username, createdAt, secretKey, tasksInQueue, tasksInQueueLimit) VALUES (?1, ?2, ?3, ?4, ?5, ?6);", [
            ctx.id,
            ctx.username,
            ctx.createdAt,
            ctx.secretKey,
            ctx.tasksInQueue,
            ctx.tasksInQueueLimit
        ]);
    } catch (e) {
        console.error(e);
    }
};

const getSubscriber = (v: string) => {
    try {
        const q = db.query("SELECT id, username, createdAt, tasksInQueue, tasksInQueueLimit FROM subscriber WHERE id = @id OR username = @username;");
        const value = q.get({ "@id": v, "@username": v }) as Omit<SubscriberContext, "secretKey">;
        q.finalize();
        return value;
    } catch (e) {
        console.error(e);
        return null;
    }
};

const deleteSubscriber = (id: string) => {
    try {
        db.run("DELETE FROM subscriber WHERE id = ?1;", [id]);
        return "DONE";
    } catch (e) {
        console.error(e);
        return "ERROR";
    }
};