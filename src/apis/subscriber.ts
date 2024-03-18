import { password } from "bun";
import { Database } from "bun:sqlite";

import { Elysia, t } from "elysia";
import { deburr } from "lodash";
import { ulid } from "ulid";

import { isValidSubscriber } from "../auth/auth";
import { pluginApi } from "../plugin";

export function subscriber() {
    return new Elysia({ prefix: "/subscribers" })
        .use(pluginApi())
        .guard({
            transform(ctx) {
                ctx.params.name = deburr(ctx.params.name).trim();
            },
            async beforeHandle(ctx) {
                // @ts-ignore
                return await isValidSubscriber(ctx);
            },
            headers: t.Object({
                "authorization": t.String(),
                "x-tasks-subscriber-id": t.String()
            }),
            params: t.Object({
                name: t.String({
                    default: "",
                    minLength: 3,
                    maxLength: 32
                })
            })
        }, (api) => api
            .get("/:name", ctx => {
                const subscriber = getSubscriber(ctx.db, ctx.id, ctx.params.name);
                if (subscriber == null) {
                    return ctx.error("Not Found", {
                        message: "Subscriber not found"
                    });
                }
                return {
                    id: ctx.id,
                    name: subscriber.subscriberName,
                    createdAt: subscriber.createdAt,
                    tasksInQueue: subscriber.tasksInQueue,
                    tasksInQueueLimit: subscriber.tasksInQueueLimit
                };
            }, {
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
                    ]
                },
                response: {
                    200: t.Object({
                        id: t.String(),
                        name: t.String(),
                        createdAt: t.Integer({
                            default: Date.now()
                        }),
                        tasksInQueue: t.Integer({
                            default: 0
                        }),
                        tasksInQueueLimit: t.Integer({
                            default: 1000
                        })
                    }),
                    401: t.Object({
                        message: t.Literal("The request did not include valid authentication")
                    }),
                    403: t.Object({
                        message: t.Literal("The server did not accept valid authentication")
                    }),
                    404: t.Object({
                        message: t.Literal("Subscriber not found")
                    })
                }
            })
            .delete("/:name", ctx => {
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
                    ]
                },
                response: {
                    200: t.Object({
                        message: t.Literal("Done")
                    }),
                    400: t.Object({
                        message: t.Literal("A request includes an invalid credential or value")
                    }),
                    401: t.Object({
                        message: t.Literal("The request did not include valid authentication")
                    }),
                    403: t.Object({
                        message: t.Literal("The server did not accept valid authentication")
                    })
                }
            })
        )
        .post("/register", async ctx => {
            const id = ulid().toLowerCase();
            const key = "t-" + Buffer.from(id + ":" + ctx.today).toString("base64");
            const secretKey = await password.hash(key, {
                algorithm: "argon2id",
                memoryCost: 4,
                timeCost: 3
            });
            const subscriber = addSubscriber(ctx.db, {
                subscriberId: id,
                subscriberName: ctx.body.name,
                createdAt: ctx.today,
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
                        message: "Subscriber has already registered"
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
                summary: "Register subscriber"
            },
            response: {
                201: t.Object({
                    id: t.String(),
                    key: t.String({
                        contentEncoding: "base64"
                    })
                }),
                409: t.Object({
                    message: t.Literal("Subscriber has already registered")
                })
            }
        });
}

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
    const q = db.query("SELECT subscriberName, createdAt, tasksInQueue, tasksInQueueLimit FROM subscriber WHERE subscriberId = ?;");
    const value = q.get(id) as Omit<SubscriberContext, "id" | "key" | "subscriberId">;
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