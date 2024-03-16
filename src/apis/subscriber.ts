import { env, password } from "bun";
import { Database } from "bun:sqlite";

import { deburr, toString } from "lodash";
import { Elysia, t } from "elysia";
import { ulid } from "ulid";

import { isValidSubscriber } from "../auth/auth";

import { HttpException } from "../exception/http-exception";

const db = new Database(env.PATH_SQLITE);

export const subscriber = new Elysia()
    .derive(ctx => {
        const auth = ctx.headers["authorization"];
        return {
            id: toString(ctx.headers["x-tasks-subscriber-id"]).trim(),
            key: auth?.startsWith("Bearer ")
                ? auth.slice(7)
                : "",
            requestAt: Date.now()
        };
    })
    .headers({
        "Cache-Control": "no-cache, no-store, must-revalidate, proxy-revalidate",
        "Expires": "0",
        "X-XSS-Protection": "0"
    })
    .get("/subscribers/:name", ctx => {
        const subscriber = getSubscriber(ctx.id, ctx.params.name);
        if (subscriber == null) {
            ctx.set.status = "Bad Request";
            throw new HttpException("Invalid subscriber name");
        }
        return subscriber;
    }, {
        transform: ctx => {
            ctx.params.name = ctx.params.name.trim();
        },
        beforeHandle: async ctx => {
            // @ts-ignore
            return await isValidSubscriber(ctx);
        },
        params: t.Object({
            name: t.Lowercase(
                t.String({
                    default: "",
                    minLength: 3,
                    maxLength: 32
                })
            )
        }),
        detail: {
            tags: ["Subscriber"],
            summary: "Get subscriber",
            parameters: [
                {
                    in: "header",
                    name: "authorization",
                    required: true,
                    example: "Bearer <KEY>"
                },
                {
                    in: "header",
                    name: "x-tasks-subscriber-id",
                    required: true,
                    example: "<ID>"
                }
            ],
            responses: {
                "200": {
                    description: "Ok",
                    content: {
                        "application/json": {
                            example: {
                                id: "",
                                username: "",
                                createdAt: Date.now(),
                                tasksInQueue: 0,
                                tasksInQueueLimit: 1000
                            }
                        }
                    }
                },
                "401": {
                    description: "The request did not include valid authentication"
                },
                "403": {
                    description: "The server did not accept valid authentication"
                },
                "404": {
                    description: "Subscriber not found"
                }
            }
        },
        type: "application/json"
    })
    .post("/subscriber", async ctx => {
        const id = ulid();
        const key = "t-" + Buffer.from(id + ":" + ctx.requestAt).toString("base64");
        const secretKey = await password.hash(key, {
            algorithm: "argon2id",
            memoryCost: 4,
            timeCost: 3
        });
        addSubscriber({
            subscriberId: id,
            subscriberName: ctx.body.name,
            createdAt: ctx.requestAt,
            key: secretKey,
            tasksInQueue: 0,
            tasksInQueueLimit: 1000
        });
        ctx.set.status = "Created";
        return {
            id,
            key
        };
    }, {
        transform: ctx => {
            ctx.body.name = deburr(ctx.body.name).trim();
        },
        beforeHandle: ctx => {
            const registered = isSubscriberRegistered(ctx.body.name);
            if (registered) {
                ctx.set.status = "Conflict";
                throw new HttpException("The subscriber has already registered");
            }
        },
        body: t.Object({
            name: t.String({
                default: "",
                minLength: 3,
                maxLength: 32
            })
        }),
        detail: {
            tags: ["Subscriber"],
            summary: "Register subscriber",
            responses: {
                "201": {
                    description: "Subscriber registered",
                    content: {
                        "application/json": {
                            example: {
                                id: "",
                                key: ""
                            }
                        }
                    }
                },
                "409": {
                    description: "The subscriber has already registered"
                }
            }
        },
        type: "application/json"
    })
    .delete("/subscribers/:name", ctx => {
        const deleted = deleteSubscriber(ctx.id, ctx.params.name);
        if (deleted == "Invalid") {
            ctx.set.status = "Bad Request";
            throw new HttpException("Bad request");
        }
        ctx.set.status = "OK";
        return {
            message: "Ok"
        };
    }, {
        transform: ctx => {
            ctx.params.name = ctx.params.name.trim();
        },
        beforeHandle: async ctx => {
            // @ts-ignore
            return await isValidSubscriber(ctx);
        },
        params: t.Object({
            name: t.String({
                default: "",
                minLength: 3,
                maxLength: 32
            })
        }),
        detail: {
            tags: ["Subscriber"],
            summary: "Delete subscriber",
            parameters: [
                {
                    in: "header",
                    name: "authorization",
                    required: true,
                    example: "Bearer <KEY>"
                },
                {
                    in: "header",
                    name: "x-tasks-subscriber-id",
                    required: true,
                    example: "<ID>"
                }
            ],
            responses: {
                "200": {
                    description: "Subscriber has been deleted",
                    content: {
                        "application/json": {
                            example: {
                                message: "Ok"
                            }
                        }
                    }
                },
                "400": {
                    description: "Bad request"
                }
            }
        }
    });

function isSubscriberRegistered(name: string) {
    const q = db.query("SELECT EXISTS (SELECT 1 FROM subscriber WHERE subscriberName = ?);");
    const obj = q.get(name) as { [k: string]: number };
    const value = Object.values(obj)[0];
    return !!value;
};

function addSubscriber(ctx: Omit<SubscriberContext, "id">) {
    db.run("INSERT INTO subscriber (subscriberId, subscriberName, createdAt, key, tasksInQueue, tasksInQueueLimit) VALUES (?1, ?2, ?3, ?4, ?5, ?6);", [
        ctx.subscriberId,
        ctx.subscriberName,
        ctx.createdAt,
        ctx.key,
        ctx.tasksInQueue,
        ctx.tasksInQueueLimit
    ]);
};

function getSubscriber(id: string, name: string) {
    const q = db.query("SELECT subscriberId, subscriberName, createdAt, tasksInQueue, tasksInQueueLimit FROM subscriber WHERE subscriberId = ?;");
    const value = q.get(id) as Omit<SubscriberContext, "id" | "key">;
    if (value.subscriberName != name) {
        return null;
    }
    return value;
};

function deleteSubscriber(id: string, name: string) {
    const q = db.query("SELECT subscriberName, tasksInQueue FROM subscriber WHERE subscriberId = ?;");
    const value = q.get(id) as Pick<SubscriberContext, "subscriberName" | "tasksInQueue">;
    if (value.tasksInQueue >= 1 || value.subscriberName != name) {
        return "Invalid";
    }
    db.run("DELETE FROM subscriber WHERE subscriberId = ?;", [id]);
    return "Ok";
};