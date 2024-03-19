import { Database } from "bun:sqlite";

import { Elysia, t } from "elysia";

import { addMilliseconds, isBefore } from "date-fns";
import { catchError, defer, map, retry, switchMap, take, tap, throwError, timeout, timer } from "rxjs";
import { ulid } from "ulid";

import { pluginApi } from "../plugin";
import { httpRequest } from "../utils/fetch";
import { isValidSubscriber } from "../auth/auth";

export function queue() {
    return new Elysia({ prefix: "/queues" })
        .use(pluginApi())
        .onBeforeHandle(async ctx => {
            return await isValidSubscriber(ctx);
        })
        .state("queues", [] as Array<SafeQueue>)
        .guard({
            params: t.Object({
                id: t.String({
                    default: null
                })
            })
        }, api => api
            .get("/:id", ctx => {

            })
            .patch("/pause/:id", ctx => {

            })
            .patch("/resume/:id", ctx => {

            })
            .delete("/unsubscribe/:id", ctx => {

            })
        )
        .decorate("defaultConfig", {
            executionDelay: 1,
            executeAt: 0,
            retry: 0,
            retryAt: 0,
            retryInterval: 0,
            retryExponential: true,
            timeout: 30000,
            responseType: "TEXT"
        })
        .post("/register", ctx => {
            const queue = registerQueue(ctx.db, ctx.id, ctx.today, ctx.body);
            ctx.store.queues.push({
                id: queue.id,
                subscription: queue.subscription
            });
            ctx.set.status = "Created";
            return {
                id: queue.id,
                state: "RUNNING",
                statusCode: 0,
                estimateEndAt: 0,
                estimateExecutionAt: queue.estimateExecutionAt
            };
        }, {
            transform(ctx) {
                ctx.body["config"] = {
                    ...ctx.defaultConfig,
                    ...ctx.body.config
                };
                if (ctx.body.httpRequest.body && (ctx.body.httpRequest.method == "GET" || ctx.body.httpRequest.method == "DELETE")) {
                    ctx.body.httpRequest.body = undefined;
                }
                if (ctx.body.config.executeAt) {
                    ctx.body.config.executionDelay = 0;
                } else {
                    ctx.body.config.executeAt = 0;
                }
                if (ctx.body.config.retryAt) {
                    ctx.body.config.retry = 1;
                    ctx.body.config.retryInterval = 0;
                } else {
                    ctx.body.config.retryAt = 0;
                }
            },
            beforeHandle(ctx) {
                if (isTasksInQueueReachTheLimit(ctx.db, ctx.id)) {
                    return ctx.error("Bad Request", {
                        message: "Tasks in queue reach the limit"
                    });
                }
                let stateEstimateExecutionDate: Date | null = null;
                if (ctx.body.config.executeAt) {
                    const estimateExecutionDate = new Date(ctx.body.config.executeAt);
                    if (isBefore(estimateExecutionDate, ctx.today)) {
                        return ctx.error("Bad Request", {
                            message: "Execution date must be greater than today"
                        });
                    }
                    stateEstimateExecutionDate = estimateExecutionDate;
                } else {
                    const estimateExecutionDate = addMilliseconds(ctx.today, ctx.body.config.executionDelay);
                    if (isBefore(estimateExecutionDate, ctx.today)) {
                        return ctx.error("Bad Request", {
                            message: "Execution date must be greater than today"
                        });
                    }
                    stateEstimateExecutionDate = estimateExecutionDate;
                }
                if (ctx.body.config.retryAt) {
                    const estimateRetryAt = new Date(ctx.body.config.retryAt);
                    if (isBefore(estimateRetryAt, stateEstimateExecutionDate)) {
                        return ctx.error("Bad Request", {
                            message: "Retry date must be greater than execution date"
                        });
                    }
                }
                stateEstimateExecutionDate = null;
            },
            body: t.Object({
                httpRequest: t.Object({
                    url: t.String({
                        default: null
                    }),
                    method: t.Union([
                        t.Literal("GET"),
                        t.Literal("POST"),
                        t.Literal("PATCH"),
                        t.Literal("PUT"),
                        t.Literal("DELETE")
                    ], {
                        default: null
                    }),
                    body: t.Optional(
                        t.Record(t.String(), t.String(), {
                            default: null
                        })
                    ),
                    query: t.Optional(
                        t.Record(t.String(), t.String(), {
                            default: null
                        })
                    ),
                    headers: t.Optional(
                        t.Record(t.String(), t.String(), {
                            default: null
                        })
                    )
                }),
                config: t.Object({
                    executionDelay: t.Integer({
                        default: 1
                    }),
                    executeAt: t.Integer({
                        default: 0
                    }),
                    retry: t.Integer({
                        default: 0,
                        minimum: 0,
                        maximum: 128
                    }),
                    retryAt: t.Integer({
                        default: 0
                    }),
                    retryInterval: t.Integer({
                        default: 0,
                        minimum: 0,
                        maximum: 86400000
                    }),
                    retryExponential: t.Boolean({
                        default: true
                    }),
                    timeout: t.Integer({
                        default: 30000,
                        minimum: 1000,
                        maximum: 300000
                    }),
                    responseType: t.Union([
                        t.Literal("TEXT"),
                        t.Literal("JSON")
                    ], {
                        default: "TEXT"
                    })
                })
            }),
            detail: {
                tags: ["Queue"],
                summary: "Register queue",
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
                201: t.Object({
                    id: t.String(),
                    state: t.String({
                        default: "RUNNING"
                    }),
                    statusCode: t.Integer({
                        default: 0
                    }),
                    estimateEndAt: t.Integer({
                        default: addMilliseconds(Date.now(), 666).getTime()
                    }),
                    estimateExecutionAt: t.Integer({
                        default: addMilliseconds(Date.now(), 666).getTime()
                    })
                }),
                400: t.Object({
                    message: t.String()
                }),
                401: t.Object({
                    message: t.String()
                }),
                403: t.Object({
                    message: t.String()
                })
            },
            type: "json"
        })
}

function isTasksInQueueReachTheLimit(db: Database, id: string) {
    const q = db.query("SELECT tasksInQueue, tasksInQueueLimit FROM subscriber WHERE subscriberId = ?;");
    const value = q.get(id) as Pick<SubscriberContext, "tasksInQueue" | "tasksInQueueLimit">;
    return value.tasksInQueue >= value.tasksInQueueLimit;
}

function registerQueue(db: Database, id: string, today: number, body: TaskSubscriberRequest) {
    const queueId = String(today.toString().substring(0, 6) + ulid().substring(0, 13)).toLowerCase();
    const dueTime = body.config.executeAt
        ? new Date(body.config.executeAt)
        : body.config.executionDelay;
    const estimateExecutionAt = typeof dueTime === "number"
        ? addMilliseconds(today, dueTime)
        : dueTime;
    const subscription = timer(dueTime).pipe(
        switchMap(() => {
            let additionalHeaders = {};
            let lastStatusCode = 0;
            let retryingCount = 0;
            return defer(() => httpRequest(body, additionalHeaders)).pipe(
                switchMap(res => {
                    if (res.status >= 200 && res.status <= 399) {
                        if (body.config.responseType == "JSON") {
                            return defer(() => res.json()).pipe(
                                map(v => ({
                                    res: v,
                                    queueId,
                                    statusCode: res.status,
                                    statusText: res.statusText
                                }))
                            );
                        }
                        return defer(() => res.text()).pipe(
                            map(v => ({
                                res: v,
                                queueId,
                                statusCode: res.status,
                                statusText: res.statusText
                            }))
                        );
                    }
                    return throwError(() => {
                        return {
                            res: null,
                            queueId,
                            statusCode: res.status,
                            statusText: res.statusText
                        };
                    });
                }),
                catchError(err => {
                    if (err == "Request Timeout") {
                        return throwError(() => {
                            return {
                                res: null,
                                queueId,
                                statusCode: 408,
                                statusText: "Request Timeout"
                            };
                        });
                    }
                    return throwError(() => err);
                }),
                timeout({
                    each: body.config.timeout
                }),
                retry({
                    count: body.config.retry,
                    delay(err, count) {
                        const now = Date.now();
                        if (body.config.retryExponential) {
                            return timer(body.config.retry! + count).pipe(
                                tap({
                                    next() {
                                        additionalHeaders = {
                                            ...additionalHeaders,
                                            "X-Tasks-Queue-Id": queueId,
                                            "X-Tasks-Retry-Count": "NULL",
                                            "X-Tasks-Currently-Retry": "NULL"
                                        };
                                    }
                                })
                            );
                        }
                        return timer(body.config.retryInterval!);
                    }
                }),
                take(1)
            );
        })
    )
    .subscribe({
        next(res) {
            db.transaction(() => {
                db.run("UPDATE subscriber SET tasksInQueue = tasksInQueue - 1 WHERE subscriberId = ?;", [id]);
                db.run(`
                    UPDATE queue SET
                        state = "DONE",
                        statusCode = ?1,
                        estimateEndAt = ?2
                    WHERE queueId = ?3 AND subscriberId IN (SELECT subscriberId FROM subscriber);
                `, [
                    res.statusCode,
                    Date.now(),
                    res.queueId
                ]);
            })();
        },
        error(err) {
            db.transaction(() => {
                db.run("UPDATE subscriber SET tasksInQueue = tasksInQueue - 1 WHERE subscriberId = ?;", [id]);
                db.run(`
                    UPDATE queue SET
                        state = "ERROR",
                        statusCode = ?1,
                        estimateEndAt = ?2
                    WHERE queueId = ?3 AND subscriberId IN (SELECT subscriberId FROM subscriber);
                `, [
                    err.statusCode,
                    Date.now(),
                    err.queueId
                ]);
            })();
        }
    });
    db.transaction(() => {
        db.run("UPDATE subscriber SET tasksInQueue = tasksInQueue + 1 WHERE subscriberId = ?;", [id]);
        db.run(`
            INSERT INTO queue (
                queueId, subscriberId, state, statusCode, estimateEndAt, estimateExecutionAt
            )
            VALUES (
                ?1, ?2, ?3, ?4, ?5, ?6
            );
        `, [
            queueId,
            id,
            "RUNNING",
            0,
            estimateExecutionAt.getTime(),
            estimateExecutionAt.getTime()
        ]);
    })();
    return {
        id: queueId,
        estimateExecutionAt: estimateExecutionAt.getTime(),
        subscription
    };
}