import { env } from "bun";
import { Database } from "bun:sqlite";

import { randomBytes } from "node:crypto";

import { Elysia, t } from "elysia";
import { cron, Patterns } from "@elysiajs/cron";

import { addMilliseconds, differenceInMilliseconds, isBefore, millisecondsToSeconds } from "date-fns";
import { BehaviorSubject, catchError, defer, delay, filter, finalize, map, mergeMap, of, retry, switchMap, throwError, timer } from "rxjs";
import { isPlainObject, kebabCase, toSafeInteger, toString } from "lodash";

import { fetchHttp } from "../utils/fetch";
import { pluginAuth } from "../plugins/auth";
import { pluginContentLength } from "../plugins/content-length";
import { decr, encr } from "../utils/crypto";
import { stmtSubscriberTasksInQueue, tasksDb } from "../db";

export function queue() {
	return new Elysia({ prefix: "/queues" })
		.headers({
			"X-XSS-Protection": "0"
		})
		.model({
			authHeaders: t.Object({
				"authorization": t.String(),
				"content-length": t.Optional(t.String()),
				"x-tasks-subscriber-id": t.String({
					default: null,
					pattern: "^[0-9A-HJ-NPR-ZA-KM-Z]{26}$"
				})
			}),
			queueId: t.Object({
				id: t.String({
					default: null,
					pattern: "^[0-9A-F]{24}$"
				})
			})
		})
		.onAfterHandle(ctx => {
			if (ctx.request.method != "GET") {
				ctx.set.headers["Cache-Control"] = "no-cache, no-store, must-revalidate";
				ctx.set.headers["Expires"] = "0";
			}
		})
		.use(pluginContentLength())
		.use(pluginAuth())
		.state("queues", [] as Array<QueueSafe>)
		.decorate("db", tasksDb())
		.decorate("defaultConfig", {
			executionDelay: 1,
			executeAt: 0,
			retry: 0,
			retryAt: 0,
			retryInterval: 0,
			retryStatusCode: [] as Array<number>,
			retryExponential: true,
			timeout: 30000
		})
		.decorate("subject", new BehaviorSubject(null))
		// Get queues
		.get("", ctx => {
			return getQueues(ctx.db, ctx.id, ctx.query.order, ctx.query.by, ctx.query.limit, ctx.query.offset);
		}, {
			headers: "authHeaders",
			transform(ctx) {
				if (ctx.query?.offset == null) {
					ctx.query["offset"] = 0;
				} else {
					ctx.query.offset = toSafeInteger(ctx.query.offset);
				}
				if (ctx.query?.limit == null) {
					ctx.query["limit"] = 10;
				} else {
					ctx.query.limit = toSafeInteger(ctx.query.limit);
				}
				if (ctx.query?.order == null) {
					ctx.query["order"] = "createdAt";
				}
				if (ctx.query?.by == null) {
					ctx.query["by"] = "ASC";
				} else {
					ctx.query.by = ctx.query.by.toUpperCase() as QueuesBy;
				}
			},
			query: t.Object({
				offset: t.Optional(t.Integer({
					minimum: 0,
					maximum: Number.MAX_SAFE_INTEGER,
					default: 0
				})),
				limit: t.Optional(t.Integer({
					minimum: 1,
					maximum: 100,
					default: 10
				})),
				order: t.Optional(t.Union([
					t.Literal("createdAt"),
					t.Literal("expiredAt"),
					t.Literal("estimateEndAt"),
					t.Literal("estimateExecutionAt")
				], {
					default: "createdAt"
				})),
				by: t.Optional(t.Union([
					t.Literal("ASC"),
					t.Literal("DESC")
				], {
					default: "ASC"
				})),
			}),
			response: {
				200: t.Array(
					t.Object({
						id: t.String(),
						state: t.String(),
						statusCode: t.Integer(),
						createdAt: t.Integer(),
						expiredAt: t.Union([
							t.Integer(),
							t.Null()
						]),
						estimateEndAt: t.Integer(),
						estimateExecutionAt: t.Integer()
					})
				)
			},
			type: "json"
		})
		// Get queue
		.get("/:id", ctx => {
			const queue = getQueue(ctx.db, ctx.params.id);
			if (queue == null) {
				return ctx.error("Not Found", {
					message: "The request did not match any resource"
				});
			}
			return queue;
		}, {
			headers: "authHeaders",
			params: "queueId",
			afterHandle(ctx) {
				// @ts-ignore
				if (isPlainObject(ctx.response) && "finalize" in ctx.response! && ctx.response.finalize) {
					const buff = Buffer.from(ctx.response.finalize as Uint8Array);
					return {
						...ctx.response,
						finalize: buff.toString()
					};
				}
			},
			response: {
				200: t.Object({
					id: t.String(),
					state: t.String(),
					statusCode: t.Integer(),
					finalize: t.Union([
						t.String(),
						t.Null()
					]),
					createdAt: t.Integer(),
					expiredAt: t.Integer(),
					estimateEndAt: t.Integer(),
					estimateExecutionAt: t.Integer()
				}),
				404: t.Object({
					message: t.String()
				})
			},
			type: "json"
		})
		// Get queue config
		.get("/:id/config", ctx => {

		}, {
			headers: "authHeaders",
			params: "queueId"
		})
		// Pause queue
		.patch("/:id/pause", ctx => {
			const index = ctx.store.queues.findIndex(queue => queue.id == ctx.params.id);
			const paused = pauseQueue(ctx.db, ctx.params.id);
			if (index == -1 || paused == null) {
				return ctx.error("Unprocessable Content", {
					message: "The request did not meet one of it's preconditions"
				});
			}
			ctx.store.queues[index].subscription.unsubscribe();
			return {
				message: "Done"
			};
		}, {
			headers: "authHeaders",
			params: "queueId",
			response: {
				200: t.Object({
					message: t.Literal("Done")
				}),
				422: t.Object({
					message: t.String()
				})
			}
		})
		// Resume queue
		.patch("/:id/resume", ctx => {
			const resumed = resumeQueue(ctx.db, ctx.params.id);
			if (resumed == null) {
				return ctx.error("Unprocessable Content", {
					message: "The request did not meet one of it's preconditions"
				});
			}
			const subscriptionCtx = {
				id: ctx.id,
				db: ctx.db,
				body: resumed.body,
				today: ctx.today,
				store: ctx.store,
				subject: ctx.subject
			};
			pushSubscription(subscriptionCtx, resumed.dueTime, resumed.id);
			return {
				message: "Running"
			};
		}, {
			headers: "authHeaders",
			params: "queueId",
			response: {
				200: t.Object({
					message: t.Literal("Running")
				}),
				422: t.Object({
					message: t.String()
				})
			}
		})
		// Unsubscribe queue
		.patch("/:id/unsubscribe", ctx => {
			const index = ctx.store.queues.findIndex(queue => queue.id == ctx.params.id);
			const unsubscribed = unsubscribeQueue(ctx.db, ctx.params.id);
			if (index == -1 || unsubscribed == null) {
				return ctx.error("Unprocessable Content", {
					message: "The request did not meet one of it's preconditions"
				});
			}
			ctx.store.queues[index].subscription.unsubscribe();
			return {
				message: "Done"
			};
		}, {
			headers: "authHeaders",
			params: "queueId",
			response: {
				200: t.Object({
					message: t.Literal("Done")
				}),
				422: t.Object({
					message: t.String()
				})
			},
			type: "json"
		})
		// Delete queue
		.delete("/:id", ctx => {
			const deleted = deleteQueue(ctx.db, ctx.params.id, !!ctx.query.force);
			if (deleted == null) {
				return ctx.error("Unprocessable Content", {
					message: "The request did not meet one of it's preconditions"
				});
			}
			if (ctx.query.force) {
				const index = ctx.store.queues.findIndex(queue => queue.id == ctx.params.id);
				if (index != -1) {
					ctx.store.queues[index].subscription.unsubscribe();
					unsubscribeQueue(ctx.db, ctx.params.id);
				}
			}
			return {
				message: "Done"
			};
		}, {
			transform(ctx) {
				if ("force" in ctx.query) {
					ctx.query.force = toSafeInteger(ctx.query.force) as 0 | 1;
				} else {
					ctx.query["force"] = 0;
				}
			},
			headers: "authHeaders",
			params: "queueId",
			query: t.Object({
				force: t.Optional(
					t.Union([
						t.Literal(0),
						t.Literal(1)
					], {
						default: 0
					})
				)
			}),
			response: {
				200: t.Object({
					message: t.Literal("Done")
				}),
				422: t.Object({
					message: t.String()
				})
			},
			type: "json"
		})
		.decorate("stmtSubscriberTasksInQueue", stmtSubscriberTasksInQueue())
		// Register queue
		.post("/register", ctx => {
			ctx.set.status = "Created";
			return registerQueue(ctx);
		}, {
			transform(ctx) {
				ctx.body["config"] = {
					...ctx.defaultConfig,
					...ctx.body.config
				};
				if (ctx.body.httpRequest.method) {
					if (ctx.body.httpRequest.data && (ctx.body.httpRequest.method == "GET" || ctx.body.httpRequest.method == "DELETE")) {
						ctx.body.httpRequest.data = undefined;
					}
					ctx.body.httpRequest.method = ctx.body.httpRequest.method.toUpperCase() as HttpMethod;
				}
				if (ctx.body.config.executeAt) {
					ctx.body.config.executionDelay = 0;
				} else {
					ctx.body.config.executeAt = 0;
				}
				if (ctx.body.config.retryAt) {
					ctx.body.config.retry = 1;
					ctx.body.config.retryInterval = 0;
					ctx.body.config.retryExponential = false;
				} else {
					ctx.body.config.retryAt = 0;
				}
				if (ctx.body.config.retry == 1) {
					ctx.body.config.retryExponential = false;
				}
			},
			beforeHandle(ctx) {
				const defaultConfigLen = Object.keys(ctx.defaultConfig).length;
				const configLen = Object.keys(ctx.body.config).length;
				if (defaultConfigLen != configLen) {
					return ctx.error("Bad Request", {
						message: "There is an invalid configuration name"
					});
				}
				const statusTasksInQueue = ctx.stmtSubscriberTasksInQueue.get(ctx.id);
				if (statusTasksInQueue == null) {
					return ctx.error("Too Many Requests", {
						message: "Tasks in queue has reached it's limit"
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
						default: null,
						pattern: "^(http|https)://([a-zA-Z0-9]+([-.][a-zA-Z0-9]+)*\.[a-zA-Z]{2,})(/[a-zA-Z0-9_.-]*)*/?$",
						maxLength: 2048
					}),
					method: t.Optional(
						t.Union([
							t.Literal("GET"),
							t.Literal("POST"),
							t.Literal("PATCH"),
							t.Literal("PUT"),
							t.Literal("DELETE")
						], {
							default: null
						})
					),
					data: t.Optional(
						t.Union([
							t.String({
								default: null,
								minLength: 1,
								maxLength: Number.MIN_SAFE_INTEGER
							}),
							t.Record(
								t.String({
									minLength: 1,
									maxLength: 128,
									pattern: "^[a-zA-Z0-9\-\_\:\.]$"
								}),
								t.Union([
									t.String({
										minLength: 1,
										maxLength: Number.MAX_SAFE_INTEGER
									}),
									t.Number({
										maximum: Number.MAX_SAFE_INTEGER
									})
								]), {
									default: null
								}
							)
						])
					),
					query: t.Optional(
						t.Record(
							t.String({
								minLength: 1,
								maxLength: 128,
								pattern: "^[a-zA-Z0-9\-\_\:\.]$"
							}),
							t.String({
								minLength: 1,
								maxLength: 4096
							})
						)
					),
					headers: t.Optional(
						t.Record(
							t.String({
								minLength: 1,
								maxLength: 128,
								pattern: "^[a-zA-Z0-9\-\_\:\.]$"
							}),
							t.String({
								minLength: 1,
								maxLength: 4096
							}), {
								default: null
							}
						)
					)
				}),
				config: t.Object({
					executionDelay: t.Integer({
						default: 1,
						minimum: 0,
						maximum: Number.MAX_SAFE_INTEGER
					}),
					executeAt: t.Integer({
						default: 0,
						minimum: 0,
						maximum: Number.MAX_SAFE_INTEGER
					}),
					retry: t.Integer({
						default: 0,
						minimum: 0,
						maximum: 4096
					}),
					retryAt: t.Integer({
						default: 0,
						minimum: 0,
						maximum: Number.MAX_SAFE_INTEGER
					}),
					retryInterval: t.Integer({
						default: 0,
						minimum: 0,
						maximum: 604800000
					}),
					retryStatusCode: t.Array(
						t.Integer({
							minimum: 400,
							maximum: 599
						}), {
							default: [],
							minItems: 0,
							maxItems: 40
						}
					),
					retryExponential: t.Boolean({
						default: true
					}),
					timeout: t.Integer({
						default: 30000,
						minimum: 1000,
						maximum: 3600000
					})
				})
			}),
			headers: "authHeaders",
			response: {
				201: t.Object({
					id: t.String(),
					state: t.Literal("RUNNING"),
					statusCode: t.Literal(0),
					finalize: t.Null(),
					createdAt: t.Integer(),
					expiredAt: t.Null(),
					estimateEndAt: t.Literal(0),
					estimateExecutionAt: t.Integer()
				}),
				400: t.Object({
					message: t.String()
				}),
				429: t.Object({
					message: t.String()
				})
			},
			type: "json"
		})
		.onStart(ctx => {
			const trackLastRecord = () => {
				const stmtT = ctx.decorator.db.prepare<void, [number, number]>("UPDATE timeframe SET lastRecordAt = ?1 WHERE id = ?2;");
				const stmtQ = ctx.decorator.db.prepare<void, number>("DELETE FROM queue WHERE state IN ('DONE', 'ERROR') AND expiredAt < ?;");
				ctx.use(cron({
					name: "stmtLastRecord",
					pattern: Patterns.EVERY_SECOND,
					protect: true,
					timezone: env.TZ,
					run() {
						ctx.decorator.db.transaction(() => {
							stmtT.run(Date.now(), 1);
							stmtQ.run(Date.now());
						})();
					}
				}));
			};
			ctx.decorator.subject.pipe(
				filter(() => !!ctx.store.queues.length),
				delay(1),
				mergeMap(() => defer(() => ctx.store.queues).pipe(
					filter(queue => !!queue.subscription?.closed),
					map(() => {})
				))
			)
			.subscribe({
				next() {
					ctx.store.queues = ctx.store.queues.filter(queue => !queue.subscription?.closed);
				}
			});
			let resubscribes = resubscribeQueue(ctx.decorator.db);
			if (resubscribes == null || resubscribes.length == 0) {
				trackLastRecord();
			} else {
				for (let i = 0; i < resubscribes.length; i++) {
					const resubscribe = resubscribes[i];
					const subscriptionCtx = {
						id: resubscribe.subscriberId,
						db: ctx.decorator.db,
						body: resubscribe.body,
						today: Date.now(),
						store: ctx.store,
						subject: ctx.decorator.subject
					};
					pushSubscription(subscriptionCtx, resubscribe.dueTime, resubscribe.id);
				}
				console.log("Resubscribe queues done", resubscribes.length);
				resubscribes = null;
				trackLastRecord();
			}
		});
}

function unsubscribeQueue(db: Database, queueId: string) {
	const unsubscribeAt = Date.now();
	const q = db.query<{ unsubscribed: "Done" }, [number, string]>("UPDATE queue SET state = 'DONE', statusCode = 0, estimateEndAt = ?1 WHERE id = ?2 AND subscriberId IN (SELECT id FROM subscriber) RETURNING 'Done' AS unsubscribed;");
	const queue = q.get(unsubscribeAt, queueId);
	q.finalize();
	if (queue == null) {
		return null;
	}
	return queue.unsubscribed;
}

type ResumeQueueQuery = Pick<QueueTable, "subscriberId" | "estimateEndAt" | "estimateExecutionAt"> & ConfigTable

function resumeQueue(db: Database, queueId: string) {
	const q = db.query<ResumeQueueQuery, string>("SELECT q.subscriberId, q.estimateEndAt, q.estimateExecutionAt, c.* FROM queue AS q INNER JOIN config AS c ON q.id = c.id WHERE q.id = ? AND q.state = 'PAUSED';");
	const queue = q.get(queueId);
	q.finalize();
	if (queue == null) {
		return null;
	}
	return transformQueue(db, queue, queue.estimateEndAt);
}

function pauseQueue(db: Database, queueId: string) {
	const pauseAt = Date.now();
	const q = db.query<{ paused: "Done" }, [number, string]>("UPDATE queue SET state = 'PAUSED', estimateEndAt = ?1 WHERE id = ?2 AND subscriberId IN (SELECT id FROM subscriber) RETURNING 'Done' AS paused;");
	const queue = q.get(pauseAt, queueId);
	q.finalize();
	if (queue == null) {
		return null;
	}
	return queue.paused;
}

type SubscriptionContext = {
	store: {
		queues: Array<QueueSafe>;
	};
	body: TaskSubscriberReq;
	id: string;
	db: Database;
	today: number;
	subject: BehaviorSubject<null>;
}

function pushSubscription(ctx: SubscriptionContext, dueTime: number | Date, queueId: string) {
	const log = toSafeInteger(env.LOG) == 1;
	const stmtQ = ctx.db.prepare<void, [string, number, Buffer, number, string]>("UPDATE queue SET state = ?1, statusCode = ?2, finalize = ?3, estimateEndAt = ?4 WHERE id = ?5 AND subscriberId IN (SELECT id FROM subscriber);");
	const stmtC = ctx.db.prepare<Pick<ConfigTable, "retryCount" | "retryLimit">, string>("UPDATE config SET retrying = 1 WHERE id = ? AND id IN (SELECT id FROM queue) RETURNING retryCount, retryLimit;");
	const stmtQErr = ctx.db.prepare<void, [number, Buffer, string]>("UPDATE queue SET statusCode = ?1, finalize = ?2 WHERE id = ?3 AND subscriberId IN (SELECT id FROM subscriber);");
	const stmtCErr = ctx.db.prepare<void, [string, number, string]>("UPDATE config SET headersStringify = ?1, estimateNextRetryAt = ?2 WHERE id = ?3 AND id IN (SELECT id FROM queue);");
	ctx.store.queues.push({
		id: queueId,
		subscription: timer(dueTime).pipe(
			switchMap(() => {
				let additionalHeaders = {} as { [k: string]: string };
				let stateMs = 0;
				return defer(() => fetchHttp(ctx.body, additionalHeaders)).pipe(
					catchError((error: FetchRes) => {
						const someErrorStatusCode = ctx.body.config.retryStatusCode.some(statusCode => statusCode == error.status);
						if (ctx.body.config.retryStatusCode.length == 0 || someErrorStatusCode) {
							return throwError(() => error);
						}
						return of(error);
					}),
					retry({
						count: ctx.body.config.retry,
						delay(error: FetchRes) {
							const retryingAt = Date.now();
							const { retryCount, retryLimit } = stmtC.get(queueId)!;
							let errorDueTime = 0 as number | Date;
							let estimateNextRetryAt = 0;
							if (ctx.body.config.retryAt) {
								errorDueTime = new Date(ctx.body.config.retryAt);
								estimateNextRetryAt = ctx.body.config.retryAt;
							} else {
								errorDueTime = ctx.body.config.retryExponential
									? ctx.body.config.retryInterval * retryCount
									: ctx.body.config.retryInterval;
								estimateNextRetryAt = addMilliseconds(retryingAt, errorDueTime).getTime();
							}
							additionalHeaders = {
								...additionalHeaders,
								"X-Tasks-Queue-Id": queueId,
								"X-Tasks-Retry-Count": retryCount.toString(),
								"X-Tasks-Retry-Limit": retryLimit.toString(),
								"X-Tasks-Estimate-Next-Retry-At": estimateNextRetryAt.toString()
							};
							ctx.db.transaction(() => {
								stmtQErr.run(
									error.status,
									error.data!,
									queueId
								);
								stmtCErr.run(
									encr(JSON.stringify(additionalHeaders), kebabCase(ctx.db.filename) + ":" + queueId),
									estimateNextRetryAt,
									queueId
								);
							})();
							if (log) {
								if (typeof errorDueTime === "number") {
									stateMs += errorDueTime;
								} else {
									stateMs = new Date(errorDueTime).getTime();
								}
								console.error();
								console.error("COUNT", retryCount);
								console.error("INTERVAL", millisecondsToSeconds(stateMs) + "sec");
								console.error("RETRY DATE UTC", new Date(estimateNextRetryAt).toLocaleString());
							}
							return timer(errorDueTime);
						}
					})
				);
			}),
			finalize(() => ctx.subject.next(null))
		)
		.subscribe({
			next(res) {
				stmtQ.run("DONE", res.status, res.data!, Date.now(), queueId);
				stmtQ.finalize();
				stmtC.finalize();
				stmtQErr.finalize();
				stmtCErr.finalize();
				if (log) {
					console.log();
					console.log("DONE", res);
				}
			},
			error(err: FetchRes) {
				stmtQ.run("ERROR", err.status, err.data!, Date.now(), queueId);
				stmtQ.finalize();
				stmtC.finalize();
				stmtQErr.finalize();
				stmtCErr.finalize();
				if (log) {
					console.error();
					console.error("ERROR", err);
				}
			}
		})
	});
}

function registerQueue(ctx: SubscriptionContext) {
	const queueId = randomBytes(12).toString("hex").toUpperCase();
	const key = genKey(queueId);
	const dueTime = !!ctx.body.config.executeAt
		? new Date(ctx.body.config.executeAt)
		: ctx.body.config.executionDelay;
	const estimateExecutionAt = typeof dueTime === "number"
		? addMilliseconds(ctx.today, dueTime).getTime()
		: dueTime.getTime();
	pushSubscription(ctx, dueTime, queueId);
	ctx.db.transaction(() => {
		ctx.db.run("INSERT INTO queue (id, subscriberId, createdAt, estimateExecutionAt) VALUES (?1, ?2, ?3, ?4);", [
			queueId,
			ctx.id,
			ctx.today,
			estimateExecutionAt
		]);
		ctx.db.run("INSERT INTO config (id, url, method, timeout) VALUES (?1, ?2, ?3, ?4);", [
			queueId,
			encr(ctx.body.httpRequest.url, key),
			ctx.body.httpRequest.method || null,
			ctx.body.config.timeout
		]);
		if (ctx.body.config.executeAt) {
			ctx.db.run("UPDATE config SET executeAt = ?1 WHERE id = ?2 AND id IN (SELECT id FROM queue);", [
				ctx.body.config.executeAt,
				queueId
			]);
		} else {
			ctx.db.run("UPDATE config SET executionDelay = ?1 WHERE id = ?2 AND id IN (SELECT id FROM queue);", [
				ctx.body.config.executionDelay,
				queueId
			]);
		}
		if (ctx.body.httpRequest.data) {
			const strData = JSON.stringify(ctx.body.httpRequest.data);
			ctx.db.run("UPDATE config SET dataStringify = ?1 WHERE id = ?2 AND id IN (SELECT id FROM queue);", [
				encr(strData, key),
				queueId
			]);
		}
		if (ctx.body.httpRequest.query) {
			const strQuery = JSON.stringify(ctx.body.httpRequest.query);
			ctx.db.run("UPDATE config SET queryStringify = ?1 WHERE id = ?2 AND id IN (SELECT id FROM queue);", [
				encr(strQuery, key),
				queueId
			]);
		}
		if (ctx.body.httpRequest.headers) {
			const strHeaders = JSON.stringify(ctx.body.httpRequest.headers);
			ctx.db.run("UPDATE config SET headersStringify = ?1 WHERE id = ?2 AND id IN (SELECT id FROM queue);", [
				encr(strHeaders, key),
				queueId
			]);
		}
		if (ctx.body.config.retryAt) {
			ctx.db.run("UPDATE config SET retry = 1, retryAt = ?1, retryLimit = 1, retryExponential = 0 WHERE id = ?2 AND id IN (SELECT id FROM queue);", [
				ctx.body.config.retryAt,
				queueId
			]);
		}
		if (ctx.body.config.retry) {
			const retryExponential = ctx.body.config.retryExponential ? 1 : 0;
			ctx.db.run("UPDATE config SET retry = ?1, retryLimit = ?1, retryInterval = ?2, retryExponential = ?3 WHERE id = ?4 AND id IN (SELECT id FROM queue);", [
				ctx.body.config.retry,
				ctx.body.config.retryInterval,
				retryExponential,
				queueId
			]);
		}
		if (ctx.body.config.retryStatusCode.length) {
			ctx.db.run("UPDATE config SET retryStatusCode = ?1 WHERE id = ?2 AND id IN (SELECT id FROM queue);", [
				JSON.stringify(ctx.body.config.retryStatusCode),
				queueId
			]);
		}
	})();
	return {
		id: queueId,
		state: "RUNNING",
		statusCode: 0,
		finalize: null,
		createdAt: ctx.today,
		expiredAt: 0,
		estimateEndAt: 0,
		estimateExecutionAt
	} as QueueQuery;
}

function deleteQueue(db: Database, queueId: string, forceDelete = false) {
	let raw = "DELETE FROM queue WHERE id = ?";
	if (forceDelete) {
		raw += " RETURNING 'Done' AS deleted;";
	} else {
		raw += " AND state = 'DONE' RETURNING 'Done' AS deleted;";
	}
	const q = db.query<{ deleted: "Done" }, string>(raw);
	const queue = q.get(queueId);
	q.finalize();
	if (queue == null) {
		return null;
	}
	return queue.deleted;
}

type QueueQuery = Omit<QueueTable, "subscriberId">

function getQueue(db: Database, queueId: string) {
	const q = db.query<QueueQuery, string>("SELECT id, state, createdAt, expiredAt, statusCode, finalize, estimateEndAt, estimateExecutionAt FROM queue WHERE id = ?;");
	const queue = q.get(queueId);
	q.finalize();
	if (queue == null) {
		return null;
	}
	return queue;
}

type QueuesQuery = Omit<QueueQuery, "finalize">
type QueuesOrder = "createdAt" | "expiredAt" | "estimateEndAt" | "estimateExecutionAt"
type QueuesBy = "ASC" | "DESC"

function getQueues(db: Database, id: string, order: QueuesOrder = "createdAt", by: QueuesBy = "ASC", limit = 10, offset = 0) {
	let raw = "";
	if (by == "ASC") {
		raw = "SELECT id, state, createdAt, expiredAt, statusCode, estimateEndAt, estimateExecutionAt FROM queue WHERE subscriberId = ?1 ORDER BY ?2 ASC LIMIT ?3 OFFSET ?4;";
	} else {
		raw = "SELECT id, state, createdAt, expiredAt, statusCode, estimateEndAt, estimateExecutionAt FROM queue WHERE subscriberId = ?1 ORDER BY ?2 DESC LIMIT ?3 OFFSET ?4;";
	}
	const q = db.query<QueuesQuery, [string, QueuesOrder, number, number]>(raw);
	const queues = q.all(id, order, limit, offset);
	q.finalize();
	return queues;
}

function transformQueue(db: Database, rQueue: ResumeQueueQuery, beforeAt: number, terminated = false) {
	const transformAt = Date.now();
	const key = genKey(rQueue.id);
	const body = {
		httpRequest: {
			url: decr(rQueue.url, key),
			method: rQueue.method,
			body: !!rQueue.dataStringify
				? JSON.parse(decr(rQueue.dataStringify, key))
				: undefined,
			query: !!rQueue.queryStringify
				? JSON.parse(decr(rQueue.queryStringify, key))
				: undefined,
			headers: !!rQueue.headersStringify
				? JSON.parse(decr(rQueue.headersStringify, key))
				: undefined
		},
		config: {
			executionDelay: rQueue.executionDelay,
			executeAt: rQueue.executeAt,
			retry: rQueue.retry,
			retryAt: rQueue.retryAt,
			retryInterval: rQueue.retryInterval,
			retryStatusCode: JSON.parse(rQueue.retryStatusCode),
			retryExponential: !!rQueue.retryExponential,
			timeout: rQueue.timeout
		}
	} as TaskSubscriberReq;
	if (rQueue.executeAt) {
		if (rQueue.retrying) {
			if (rQueue.retryAt == 0) {
				body.config.retry = rQueue.retryLimit - rQueue.retryCount;
			}
			const delay = Math.abs(
				differenceInMilliseconds(rQueue.estimateNextRetryAt, beforeAt)
			);
			body.config.executeAt = addMilliseconds(transformAt, delay).getTime();
		} else {
			const diffMs = Math.abs(
				differenceInMilliseconds(rQueue.estimateExecutionAt, beforeAt)
			);
			body.config.executeAt = addMilliseconds(transformAt, diffMs).getTime();
		}
	} else {
		if (rQueue.retrying) {
			if (rQueue.retryAt == 0) {
				body.config.retry = rQueue.retryLimit - rQueue.retryCount;
			}
			const delay = Math.abs(
				differenceInMilliseconds(rQueue.estimateNextRetryAt, beforeAt)
			);
			body.config.executionDelay = delay;
		} else {
			const diffMs = Math.abs(
				differenceInMilliseconds(rQueue.estimateExecutionAt, beforeAt)
			);
			body.config.executionDelay = diffMs;
		}
	}
	const resumeDueTime = !!body.config.executeAt
		? new Date(body.config.executeAt)
		: body.config.executionDelay;
	const estimateExecutionAt = typeof resumeDueTime === "number"
		? addMilliseconds(transformAt, resumeDueTime).getTime()
		: resumeDueTime.getTime();
	if (!terminated) {
		db.run("UPDATE queue SET state = 'RUNNING', estimateEndAt = 0, estimateExecutionAt = ?1 WHERE id = ?2 AND subscriberId IN (SELECT id FROM subscriber);", [
			estimateExecutionAt,
			rQueue.id
		]);
	}
	return {
		subscriberId: rQueue.subscriberId,
		id: rQueue.id,
		dueTime: resumeDueTime,
		body
	};
}

/**
 * ATTENTION!
 *
 * Resubscribe queue is a mechanism for resuming tasks when the server suddenly shuts down.
 * Automatically, all tasks that have `STATE = RUNNING`, will be paused and will then be resumed when the server is online.
 * As more tasks are paused, there will likely be a sizable increase in processor and memory resources.
*/
function resubscribeQueue(db: Database) {
	const resubscribeAt = Date.now();
	const q = db.query<ResumeQueueQuery & { lastRecordAt: number }, []>("SELECT q.subscriberId, q.estimateEndAt, q.estimateExecutionAt, c.*, (SELECT lastRecordAt FROM timeframe) AS lastRecordAt FROM queue AS q INNER JOIN config AS c ON q.id = c.id WHERE q.state = 'RUNNING';");
	const queueValues = q.all();
	q.finalize();
	if (queueValues == null || queueValues.length == 0) {
		return null;
	}
	const stmt = db.prepare("UPDATE queue SET estimateExecutionAt = @estimateExecutionAt WHERE id = @id AND subscriberId IN (SELECT id FROM subscriber);");
	const updateResubscribeQueue = db.transaction((queues: Array<{ [k: string]: string | number }>) => {
		for (let i = 0; i < queues.length; i++) {
			const queue = queues[i];
			stmt.run(queue);
		}
	});
	const resubscribes = [] as Array<ReturnType<typeof transformQueue>>;
	for (let i = 0; i < queueValues.length; i++) {
		const queue = queueValues[i];
		resubscribes.push(
			transformQueue(db, queue, queue.lastRecordAt, true)
		);
	}
	updateResubscribeQueue(
		resubscribes.map(item => ({
			"@estimateExecutionAt": typeof item.dueTime === "number"
				? addMilliseconds(resubscribeAt, item.dueTime).getTime()
				: item.dueTime.getTime(),
			"@id": item.id
		}))
	);
	stmt.finalize();
	return resubscribes;
}

function genKey(configId: string) {
	return toString(env.CIPHER_KEY) + ":" + configId;
}