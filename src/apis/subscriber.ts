import { password } from "bun";
import { Database } from "bun:sqlite";

import { Elysia, t } from "elysia";
import { deburr } from "lodash";
import { ulid } from "ulid";

import { isValidSubscriber } from "../auth/auth";
import { pluginApi } from "../plugin";

export const subscriber = new Elysia()
    .use(pluginApi())
    .guard(api => api
        .onBeforeHandle(async ctx => {
            return await isValidSubscriber(ctx);
        })
        .get("/subscribers/:name", ctx => {
            const subscriber = getSubscriber(ctx.db, ctx.id, ctx.params.name);
            if (subscriber == null) {
                return ctx.error("Bad Request", {
                    message: "A request includes an invalid credential or value"
                });
            }
            return subscriber;
        }, {
            transform(ctx) {
                ctx.params.name = deburr(ctx.params.name).trim();
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
            }
        })
        .delete("/subscribers/:name", ctx => {
            const isDeleted = deleteSubscriber(ctx.db, ctx.id, ctx.params.name);
            if (isDeleted == null) {
                return ctx.error("Bad Request", {
                    message: "A request includes an invalid credential or value"
                });
            }
            ctx.set.status = "OK";
            return {
                message: "Done"
            };
        }, {
            transform(ctx) {
                ctx.params.name = deburr(ctx.params.name).trim();
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
                                    message: "Done"
                                }
                            }
                        }
                    },
                    "400": {
                        description: "Bad request"
                    }
                }
            }
        })
    )
    .post("/subscriber", async ctx => {
        const id = ulid();
        const key = "t-" + Buffer.from(id + ":" + ctx.requestAt).toString("base64");
        const secretKey = await password.hash(key, {
            algorithm: "argon2id",
            memoryCost: 4,
            timeCost: 3
        });
        const subscriber = addSubscriber(ctx.db, {
            subscriberId: id,
            subscriberName: ctx.body.name,
            createdAt: ctx.requestAt,
            key: secretKey,
            tasksInQueue: 0,
            tasksInQueueLimit: 1000
        });
        if (subscriber == null) {
            return ctx.error("Internal Server Error", {
                message: "The server returned an error"
            });
        }
        ctx.set.status = "Created";
        return {
            id,
            key
        };
    }, {
        transform(ctx) {
            ctx.body.name = deburr(ctx.body.name).trim();
        },
        beforeHandle(ctx) {
            const isRegistered = isSubscriberRegistered(ctx.db, ctx.body.name);
            if (isRegistered) {
                return ctx.error("Conflict", {
                    message: "The subscriber has already registered"
                });
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
        }
    });

function isSubscriberRegistered(db: Database, name: string) {
    const q = db.query("SELECT EXISTS (SELECT 1 FROM subscriber WHERE subscriberName = ?);");
    const obj = q.get(name) as { [k: string]: number };
    const value = Object.values(obj)[0];
    return !!value;
};

function addSubscriber(db: Database, ctx: Omit<SubscriberContext, "id">) {
    db.run("INSERT INTO subscriber (subscriberId, subscriberName, createdAt, key, tasksInQueue, tasksInQueueLimit) VALUES (?1, ?2, ?3, ?4, ?5, ?6);", [
        ctx.subscriberId,
        ctx.subscriberName,
        ctx.createdAt,
        ctx.key,
        ctx.tasksInQueue,
        ctx.tasksInQueueLimit
    ]);
    const q = db.query("SELECT id FROM subscriber WHERE subscriberId = ?;");
    const value = q.get(ctx.subscriberId) as Pick<SubscriberContext, "id"> | null;
    if (value == null) {
        return null;
    }
    return "Done";
};

function getSubscriber(db: Database, id: string, name: string) {
    const q = db.query("SELECT subscriberId, subscriberName, createdAt, tasksInQueue, tasksInQueueLimit FROM subscriber WHERE subscriberId = ?;");
    const value = q.get(id) as Omit<SubscriberContext, "id" | "key">;
    if (value.subscriberName != name) {
        return null;
    }
    return value;
};

function deleteSubscriber(db: Database, id: string, name: string) {
    const q = db.query("SELECT subscriberName, tasksInQueue FROM subscriber WHERE subscriberId = ?;");
    const value = q.get(id) as Pick<SubscriberContext, "subscriberName" | "tasksInQueue">;
    if (value.tasksInQueue >= 1 || value.subscriberName != name) {
        return null;
    }
    db.run("DELETE FROM subscriber WHERE subscriberId = ?;", [id]);
    return "Done";
};