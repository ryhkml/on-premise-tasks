import { Database } from "bun:sqlite";

import { Elysia, t } from "elysia";

import { addMilliseconds, isBefore } from "date-fns";
import { catchError, defer, map, retry, switchMap, take, tap, throwError, timeout, timer } from "rxjs";
import { ulid } from "ulid";

import { pluginApi } from "../plugin";
import { isValidSubscriber } from "../auth/auth";
import { httpRequest } from "../utils/fetch";

export function subscription() {
    return new Elysia({ prefix: "/queues" })
        .use(pluginApi())
        .state("queues", [] as Array<SafeQueue>)
        .guard(
            {
                async beforeHandle(ctx) {
                    // @ts-ignore
                    return await isValidSubscriber(ctx);
                },
                headers: t.Object({
                    "authorization": t.String(),
                    "x-tasks-subscriber-id": t.String()
                })
            },
            (app) => app
                .post("/subscribe", ctx => {
                    const queue = subscribe(ctx.db, ctx.body, ctx.id);
                    ctx.store.queues.push({
                        id: queue.id,
                        subscription: queue.subscription
                    });
                    return {
                        id: queue.id,
                        state: "RUNNING",
                        statusCode: 0,
                        estimateEndAt: 0,
                        estimateExecutionAt: queue.estimateExecutionAt
                    };
                }, {
                    transform(ctx) {
                        const defaultConfig = {
                            executionDelay: 1,
                            executionAt: 0,
                            retry: 0,
                            retryAt: 0,
                            retryInterval: 0,
                            retryExponential: true,
                            timeout: 30000,
                            responseType: "TEXT"
                        };
                        ctx.body.config = {
                            ...defaultConfig,
                            ...ctx.body.config
                        };
                        if (ctx.body.httpRequest.data && ctx.body.httpRequest.method == "DELETE") {
                            ctx.body.httpRequest.data = undefined;
                        }
                        if (ctx.body.config.executionAt) {
                            ctx.body.config.executionDelay = 0;
                        } else {
                            ctx.body.config.executionAt = 0;
                        }
                        if (ctx.body.config.retryAt) {
                            ctx.body.config.retry = 1;
                            ctx.body.config.retryInterval = 0;
                        } else {
                            ctx.body.config.retryAt = 0;
                        }
                    },
                    beforeHandle(ctx) {
                        let stateEstimateExecutionDate: Date | null = null;
                        if (ctx.body.config.executionAt) {
                            const estimateExecutionDate = new Date(ctx.body.config.executionAt);
                            if (isBefore(estimateExecutionDate, ctx.today)) {
                                return ctx.error("Bad Request", {
                                    message: "Execution date must be greater than today at " + ctx.today.toString()
                                });
                            }
                            stateEstimateExecutionDate = estimateExecutionDate;
                        } else {
                            const estimateExecutionDate = addMilliseconds(ctx.today, ctx.body.config.executionDelay!);
                            if (isBefore(estimateExecutionDate, ctx.today)) {
                                return ctx.error("Bad Request", {
                                    message: "Execution date must be greater than today at " + ctx.today.toString()
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
                        if (isTasksInQueueReachTheLimit(ctx.db, ctx.id)) {
                            return ctx.error("Bad Request", {
                                message: "Tasks in queue reach the limit"
                            });
                        }
                    },
                    body: t.Object({
                        httpRequest: t.Object({
                            url: t.String(),
                            method: t.Union([
                                t.Literal("POST"),
                                t.Literal("PATCH"),
                                t.Literal("PUT"),
                                t.Literal("DELETE")
                            ]),
                            data: t.Optional(
                                t.Record(t.String(), t.String())
                            ),
                            headers: t.Optional(
                                t.Record(t.String(), t.String())
                            ),
                            query: t.Optional(
                                t.Record(t.String(), t.String())
                            )
                        }),
                        config: t.Object({
                            executionDelay: t.Optional(
                                t.Integer({
                                    default: 1
                                })
                            ),
                            executionAt: t.Optional(
                                t.Integer({
                                    default: 0
                                })
                            ),
                            retry: t.Optional(
                                t.Integer({
                                    default: 0,
                                    minimum: 0,
                                    maximum: 128
                                })
                            ),
                            retryAt: t.Optional(
                                t.Integer({
                                    default: 0
                                })
                            ),
                            retryInterval: t.Optional(
                                t.Integer({
                                    default: 0
                                })
                            ),
                            retryExponential: t.Optional(
                                t.Boolean({
                                    default: true
                                })
                            ),
                            timeout: t.Optional(
                                t.Integer({
                                    default: 30000,
                                    minimum: 1,
                                    maximum: 180000
                                })
                            ),
                            responseType: t.Union([
                                t.Literal("TEXT"),
                                t.Literal("JSON")
                            ], {
                                default: "TEXT"
                            })
                        })
                    }),
                    detail: {
                        tags: ["Subscription"],
                        summary: "Register subscription",
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
                            id: t.String({
                                description: "Queue id"
                            }),
                            state: t.Literal("RUNNING", {
                                default: "RUNNING"
                            }),
                            statusCode: t.Literal(0, {
                                default: 0
                            }),
                            estimateEndAt: t.Literal(0, {
                                default: addMilliseconds(Date.now(), 666).getTime()
                            }),
                            estimateExecutionAt: t.Integer({
                                description: "Estimate execution time in milliseconds (UTC+0)",
                                default: addMilliseconds(Date.now(), 666).getTime()
                            })
                        }),
                        400: t.Object({
                            message: t.String()
                        }),
                        401: t.Object({
                            message: t.Literal("The request did not include valid authentication")
                        }),
                        403: t.Object({
                            message: t.Literal("The server did not accept valid authentication")
                        })
                    }
                })
        );
}

function isTasksInQueueReachTheLimit(db: Database, id: string) {
    const q = db.query("SELECT tasksInQueue, tasksInQueueLimit FROM subscriber WHERE subscriberId = ?;");
    const value = q.get(id) as Pick<SubscriberContext, "tasksInQueue" | "tasksInQueueLimit">;
    return value.tasksInQueue >= value.tasksInQueueLimit;
}

function subscribe(db: Database, body: TaskSubscriberRequest, id: string) {
    const dueTime = body.config.executionAt
        ? new Date(body.config.executionAt)
        : body.config.executionDelay!;
    const queueId = String(Date.now().toString().substring(0, 6) + ulid().substring(0, 13)).toLowerCase()
    const estimateExecutionAt = typeof dueTime === "number"
        ? addMilliseconds(Date.now(), dueTime)
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
                    UPDATE subscription SET
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
                    UPDATE subscription SET
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
            INSERT INTO subscription (
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