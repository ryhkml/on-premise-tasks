import { env } from "bun";
import { Database } from "bun:sqlite";

import { randomBytes } from "node:crypto";

import { Elysia, t } from "elysia";

import { addMilliseconds, differenceInMilliseconds, isBefore, millisecondsToSeconds } from "date-fns";
import { BehaviorSubject, TimeoutError, catchError, defer, delay, filter, finalize, interval, map, mergeMap, of, retry, switchMap, throwError, timer } from "rxjs";
import { defer as deferLd, kebabCase, toSafeInteger } from "lodash";

import { fetchHttp } from "../utils/fetch";
import { pluginAuth } from "../auth/auth";
import { decr, encr } from "../utils/crypto";

export function queue() {
	return new Elysia({ prefix: "/queues" })
		.headers({
			"X-XSS-Protection": "0"
		})
		.use(pluginAuth())
		.state("queues", [] as Array<SafeQueue>)
		.decorate("subject", new BehaviorSubject(null))
		.guard({
			headers: t.Object({
				"authorization": t.String(),
				"x-tasks-subscriber-id": t.String()
			}),
			params: t.Object({
				id: t.String({
					default: null
				})
			})
		}, api => api
			.get("/:id", ctx => {
				const queue = getQueue(ctx.db, ctx.params.id);
				if (queue == null) {
					return ctx.error("Not Found", {
						message: "The request did not match any resource"
					});
				}
				return queue;
			}, {
				response: {
					200: t.Object({
						id: t.String(),
						state: t.String(),
						statusCode: t.Integer(),
						estimateEndAt: t.Integer(),
						estimateExecutionAt: t.Integer()
					}),
					404: t.Object({
						message: t.String()
					})
				},
				type: "json"
			})
			.get("/:id/config", ctx => {

			})
			.patch("/:id/pause", ctx => {
				ctx.set.headers["Cache-Control"] = "no-cache, no-store, must-revalidate";
				const index = ctx.store.queues.findIndex(queue => queue.id == ctx.params.id);
				const pause = pauseQueue(ctx.db, ctx.params.id);
				if (index == -1 || pause == null) {
					return ctx.error("Unprocessable Content", {
						message: "The request did not meet one of it's preconditions"
					});
				}
				ctx.store.queues[index].subscription.unsubscribe();
				return {
					message: "Done"
				};
			}, {
				response: {
					200: t.Object({
						message: t.String()
					}),
					422: t.Object({
						message: t.String()
					})
				}
			})
			.patch("/:id/resume", ctx => {
				ctx.set.headers["Cache-Control"] = "no-cache, no-store, must-revalidate";
				const resume = resumeQueue(ctx.db, ctx.params.id);
				if (resume == null) {
					return ctx.error("Unprocessable Content", {
						message: "The request did not meet one of it's preconditions"
					});
				}
				const subscriptionCtx = {
					id: ctx.id,
					db: ctx.db,
					body: resume.body,
					today: ctx.today,
					store: ctx.store,
					subject: ctx.subject
				};
				pushSubscription(subscriptionCtx, resume.dueTime, resume.queueId, resume.configId);
				return {
					message: "Running"
				};
			}, {
				response: {
					200: t.Object({
						message: t.String()
					}),
					422: t.Object({
						message: t.String()
					})
				}
			})
			.patch("/:id/unsubscribe", ctx => {
				ctx.set.headers["Cache-Control"] = "no-cache, no-store, must-revalidate";
				const index = ctx.store.queues.findIndex(queue => queue.id == ctx.params.id);
				if (index == -1) {
					return ctx.error("Bad Request", {
						message: "A request includes an invalid credential or value"
					});
				}
				ctx.store.queues[index].subscription.unsubscribe();
				unsubscribeQueue(ctx.db, ctx.id, ctx.params.id);
				return {
					message: "Done"
				};
			}, {
				type: "json"
			})
			.delete("/:id", ctx => {
				ctx.set.headers["Cache-Control"] = "no-cache, no-store, must-revalidate";
				if (ctx.query.force) {
					const index = ctx.store.queues.findIndex(queue => queue.id == ctx.params.id);
					if (index == -1) {
						return ctx.error("Unprocessable Content", {
							message: "The request did not meet one of it's preconditions"
						});
					}
					ctx.store.queues[index].subscription.unsubscribe();
					unsubscribeQueue(ctx.db, ctx.id, ctx.params.id);
				}
				const deleted = deleteQueue(ctx.db, ctx.params.id, !!ctx.query.force);
				if (deleted == null) {
					return ctx.error("Unprocessable Content", {
						message: "The request did not meet one of it's preconditions"
					});
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
						message: t.String()
					}),
					422: t.Object({
						message: t.String()
					})
				},
				type: "json"
			})
		)
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
		.post("/register", ctx => {
			ctx.set.headers["Cache-Control"] = "no-cache, no-store, must-revalidate";
			ctx.set.status = "Created";
			return registerQueue(ctx);
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
					ctx.body.config.retryExponential = false;
				} else {
					ctx.body.config.retryAt = 0;
				}
				if (ctx.body.config.retry == 1) {
					ctx.body.config.retryExponential = false;
				}
			},
			beforeHandle(ctx) {
				if (isTasksInQueueReachTheLimit(ctx.db, ctx.id)) {
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
						t.Record(t.String({ minLength: 1, maxLength: 128 }), t.String({ minLength: 1, maxLength: 4096 }), {
							default: null
						})
					),
					query: t.Optional(
						t.Record(t.String({ minLength: 1, maxLength: 128 }), t.String({ minLength: 1, maxLength: 4096 }), {
							default: null
						})
					),
					headers: t.Optional(
						t.Record(t.String({ minLength: 1, maxLength: 128 }), t.String({ minLength: 1, maxLength: 4096 }), {
							default: null
						})
					)
				}),
				config: t.Object({
					executionDelay: t.Integer({
						default: 1,
						minimum: 0
					}),
					executeAt: t.Integer({
						default: 0,
						minimum: 0
					}),
					retry: t.Integer({
						default: 0,
						minimum: 0,
						maximum: 4096
					}),
					retryAt: t.Integer({
						default: 0,
						minimum: 0
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
			headers: t.Object({
				"authorization": t.String(),
				"x-tasks-subscriber-id": t.String()
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
						default: 0
					}),
					estimateExecutionAt: t.Integer({
						default: 0
					})
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
			if (env.NODE_ENV == "test") {
				return;
			}
			deferLd(() => {
				let resubscribes = resubscribeQueue(ctx.decorator.db);
				if (resubscribes == null || resubscribes.length == 0) {
					trackLastRecord(ctx.decorator.db);
				} else {
					for (let i = 0; i < resubscribes.length; i++) {
						const item = resubscribes[i];
						const subscriptionCtx = {
							id: item.subscriberId,
							db: ctx.decorator.db,
							body: item.body,
							today: Date.now(),
							store: ctx.store,
							subject: ctx.decorator.subject
						};
						pushSubscription(subscriptionCtx, item.dueTime, item.queueId, item.configId);
					}
					console.log("Resubscribe queues done", resubscribes.length);
					resubscribes = null;
					trackLastRecord(ctx.decorator.db);
				}
			});
		});
}

function isTasksInQueueReachTheLimit(db: Database, id: string) {
	const q = db.query("SELECT 1 FROM subscriber WHERE subscriberId = ? AND tasksInQueue < tasksInQueueLimit LIMIT 1;");
	const value = q.get(id) as { "1": 1 } | null;
	q.finalize();
	return !value;
}

function unsubscribeQueue(db: Database, id: string, queueId: string) {
	const unsubscribeAt = Date.now();
	db.transaction(() => {
		db.run("UPDATE subscriber SET tasksInQueue = tasksInQueue - 1 WHERE subscriberId = ?;", [id]);
		db.run("UPDATE queue SET state = 'DONE', statusCode = 0, estimateEndAt = ?1 WHERE queueId = ?2 AND subscriberId IN (SELECT subscriberId FROM subscriber);", [
			unsubscribeAt,
			queueId
		]);
	})();
}

interface ResumeQueue extends Pick<Queue, "subscriberId" | "estimateEndAt" | "estimateExecutionAt">, Config {}

function resumeQueue(db: Database, queueId: string) {
	const q = db.query("SELECT q.subscriberId, q.estimateEndAt, q.estimateExecutionAt, c.* FROM queue AS q INNER JOIN config AS c ON q.queueId = c.queueId WHERE q.queueId = ? AND q.state = 'PAUSED';");
	const queue = q.get(queueId) as ResumeQueue | null;
	q.finalize();
	if (queue == null) {
		return null;
	}
	return transformQueue(db, queue, queue.estimateEndAt);
}

function pauseQueue(db: Database, queueId: string) {
	const pauseAt = Date.now();
	const value = getQueue(db, queueId);
	if (value == null) {
		return null;
	}
	db.run("UPDATE queue SET state = 'PAUSED', estimateEndAt = ?1 WHERE queueId = ?2 AND subscriberId IN (SELECT subscriberId FROM subscriber);", [
		pauseAt,
		queueId
	]);
	return "Done";
}

interface SubscriptionContext {
	store: {
		queues: Array<SafeQueue>;
	};
	body: TaskSubscriberRequest;
	id: string;
	db: Database;
	today: number;
	subject: BehaviorSubject<null>;
}

function pushSubscription(ctx: SubscriptionContext, dueTime: number | Date, queueId: string, configId: string) {
	const log = toSafeInteger(env.LOG) == 1;
	ctx.store.queues.push({
		id: queueId,
		subscription: timer(dueTime).pipe(
			switchMap(() => {
				let additionalHeaders = {} as { [k: string]: string };
				let stateMs = 0;
				return defer(() => fetchHttp(ctx.body, additionalHeaders)).pipe(
					catchError(error => {
						if (error instanceof TimeoutError) {
							return throwError(() => ({
								data: null,
								state: "ERROR",
								status: 408,
								statusText: "Request Timeout"
							}));
						}
						if ("status" in error) {
							const someErrorStatusCode = ctx.body.config.retryStatusCode.some(statusCode => statusCode == error.status);
							if (ctx.body.config.retryStatusCode.length == 0 || someErrorStatusCode) {
								return throwError(() => error);
							}
							return of(error);
						}
						return throwError(() => ({
							data: null,
							state: "UNKNOWN",
							status: 500,
							statusText: String(error)
						}));
					}),
					retry({
						count: ctx.body.config.retry,
						delay() {
							const retryingAt = Date.now();
							const q = ctx.db.query("UPDATE config SET retrying = 1, retryCount = retryCount + 1 WHERE configId = ? AND queueId IN (SELECT queueId FROM queue) RETURNING retryCount, retryLimit;");
							const { retryCount, retryLimit } = q.get(configId) as Pick<Config, "retryCount" | "retryLimit">;
							q.finalize();
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
							ctx.db.run("UPDATE config SET headersStringify = ?1, estimateNextRetryAt = ?2 WHERE configId = ?3 AND queueId IN (SELECT queueId FROM queue);", [
								encr(JSON.stringify(additionalHeaders), kebabCase(ctx.db.filename) + ":" + configId),
								estimateNextRetryAt,
								configId
							]);
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
				const doneAt = Date.now();
				ctx.db.transaction(() => {
					ctx.db.run("UPDATE subscriber SET tasksInQueue = tasksInQueue - 1 WHERE subscriberId = ?;", [ctx.id]);
					ctx.db.run("UPDATE queue SET state = ?1, statusCode = ?2, estimateEndAt = ?3 WHERE queueId = ?4 AND subscriberId IN (SELECT subscriberId FROM subscriber);", [
						res.state,
						res.status,
						doneAt,
						queueId
					]);
					ctx.db.run("UPDATE config SET retrying = 0, estimateNextRetryAt = 0 WHERE configId = ? AND queueId IN (SELECT queueId FROM queue);", [configId]);
				})();
				if (log) {
					console.log();
					console.log("DONE", res);
				}
			},
			error(err) {
				const errorAt = Date.now();
				ctx.db.transaction(() => {
					ctx.db.run("UPDATE subscriber SET tasksInQueue = tasksInQueue - 1 WHERE subscriberId = ?;", [ctx.id]);
					ctx.db.run("UPDATE queue SET state = ?1, statusCode = ?2, estimateEndAt = ?3 WHERE queueId = ?4 AND subscriberId IN (SELECT subscriberId FROM subscriber);", [
						"ERROR",
						err.status,
						errorAt,
						queueId
					]);
					ctx.db.run("UPDATE config SET retrying = 0, estimateNextRetryAt = 0 WHERE configId = ? AND queueId IN (SELECT queueId FROM queue);", [configId]);
				})();
				if (log) {
					console.error();
					console.error("ERROR", err);
				}
			}
		})
	});
}

function registerQueue(ctx: SubscriptionContext) {
	const queueId = genId(ctx.today);
	const configId = genId(ctx.today);
	const key = kebabCase(ctx.db.filename) + ":" + configId;
	const dueTime = !!ctx.body.config.executeAt
		? new Date(ctx.body.config.executeAt)
		: ctx.body.config.executionDelay;
	const estimateExecutionAt = typeof dueTime === "number"
		? addMilliseconds(ctx.today, dueTime).getTime()
		: dueTime.getTime();
	pushSubscription(ctx, dueTime, queueId, configId);
	ctx.db.transaction(() => {
		ctx.db.run("UPDATE subscriber SET tasksInQueue = tasksInQueue + 1 WHERE subscriberId = ?;", [ctx.id]);
		ctx.db.run("INSERT INTO queue (queueId, subscriberId, estimateExecutionAt) VALUES (?1, ?2, ?3);", [
			queueId,
			ctx.id,
			estimateExecutionAt
		]);
		ctx.db.run("INSERT INTO config (configId, queueId, url, method, timeout) VALUES (?1, ?2, ?3, ?4, ?5);", [
			configId,
			queueId,
			encr(ctx.body.httpRequest.url, key),
			ctx.body.httpRequest.method,
			ctx.body.config.timeout
		]);
		if (ctx.body.config.executeAt) {
			ctx.db.run("UPDATE config SET executeAt = ?1 WHERE configId = ?2 AND queueId IN (SELECT queueId FROM queue);", [
				ctx.body.config.executeAt,
				configId
			]);
		} else {
			ctx.db.run("UPDATE config SET executionDelay = ?1 WHERE configId = ?2 AND queueId IN (SELECT queueId FROM queue);", [
				ctx.body.config.executionDelay,
				configId
			]);
		}
		if (ctx.body.httpRequest.body) {
			const strBody = JSON.stringify(ctx.body.httpRequest.body);
			ctx.db.run("UPDATE config SET bodyStringify = ?1 WHERE configId = ?2 AND queueId IN (SELECT queueId FROM queue);", [
				encr(strBody, key),
				configId
			]);
		}
		if (ctx.body.httpRequest.query) {
			const strQuery = JSON.stringify(ctx.body.httpRequest.query);
			ctx.db.run("UPDATE config SET queryStringify = ?1 WHERE configId = ?2 AND queueId IN (SELECT queueId FROM queue);", [
				encr(strQuery, key),
				configId
			]);
		}
		if (ctx.body.httpRequest.headers) {
			const strHeaders = JSON.stringify(ctx.body.httpRequest.headers);
			ctx.db.run("UPDATE config SET headersStringify = ?1 WHERE configId = ?2 AND queueId IN (SELECT queueId FROM queue);", [
				encr(strHeaders, key),
				configId
			]);
		}
		if (ctx.body.config.retryAt) {
			ctx.db.run("UPDATE config SET retry = 1, retryAt = ?1, retryLimit = 1, retryExponential = 0 WHERE configId = ?2 AND queueId IN (SELECT queueId FROM queue);", [
				ctx.body.config.retryAt,
				configId
			]);
		}
		if (ctx.body.config.retry) {
			const retryExponential = ctx.body.config.retryExponential ? 1 : 0;
			ctx.db.run("UPDATE config SET retry = ?1, retryLimit = ?1, retryInterval = ?2, retryExponential = ?3 WHERE configId = ?4 AND queueId IN (SELECT queueId FROM queue);", [
				ctx.body.config.retry,
				ctx.body.config.retryInterval,
				retryExponential,
				configId
			]);
		}
		if (ctx.body.config.retryStatusCode.length) {
			ctx.db.run("UPDATE config SET retryStatusCode = ?1 WHERE configId = ?2 AND queueId IN (SELECT queueId FROM queue);", [
				JSON.stringify(ctx.body.config.retryStatusCode),
				configId
			]);
		}
	})();
	return {
		id: queueId,
		state: "RUNNING",
		statusCode: 0,
		estimateEndAt: 0,
		estimateExecutionAt
	} as Queue;
}

function deleteQueue(db: Database, queueId: string, forceDelete = false) {
	const queue = getQueue(db, queueId);
	if (queue == null || (queue.state != "DONE" && !forceDelete)) {
		return null;
	}
	db.run("DELETE FROM queue WHERE queueId = ? AND subscriberId IN (SELECT subscriberId FROM subscriber);", [queueId]);
	return "Done";
}

function getConfig(db: Database, id: string) {
	const q = db.query("SELECT * FROM config WHERE queueId IN (SELECT queueId FROM queue);");
	const value = q.get();
	q.finalize();
	return value;
}

function getQueues(db: Database, id: string) {
	const q = db.query("SELECT * FROM queue WHERE subscriberId = ? AND subscriberId IN (SELECT subscriberId FROM subscriber);");
	const value = q.all(id) as Array<{}> | null;
	q.finalize();
	return value;
}

function getQueue(db: Database, queueId: string) {
	const q = db.query("SELECT state, statusCode, estimateEndAt, estimateExecutionAt FROM queue WHERE queueId = ? AND subscriberId IN (SELECT subscriberId FROM subscriber) LIMIT 1;");
	const value = q.get(queueId) as {} | null;
	q.finalize();
	if (value == null) {
		return null;
	}
	return {
		id: queueId,
		...value
	} as Queue;
}

function transformQueue(db: Database, queue: ResumeQueue, beforeAt: number, terminated = false) {
	const transformAt = Date.now();
	const key = kebabCase(db.filename) + ":" + queue.configId;
	const body = {
		httpRequest: {
			url: decr(queue.url, key),
			method: queue.method,
			body: !!queue.bodyStringify
				? JSON.parse(decr(queue.bodyStringify, key))
				: undefined,
			query: !!queue.queryStringify
				? JSON.parse(decr(queue.queryStringify, key))
				: undefined,
			headers: !!queue.headersStringify
				? JSON.parse(decr(queue.headersStringify, key))
				: undefined
		},
		config: {
			executionDelay: queue.executionDelay,
			executeAt: queue.executeAt,
			retry: queue.retry,
			retryAt: queue.retryAt,
			retryInterval: queue.retryInterval,
			retryStatusCode: JSON.parse(queue.retryStatusCode),
			retryExponential: !!queue.retryExponential,
			timeout: queue.timeout
		}
	} as TaskSubscriberRequest;
	if (queue.executeAt) {
		if (queue.retrying) {
			if (queue.retryAt == 0) {
				body.config.retry = queue.retryLimit - queue.retryCount;
			}
			const delay = Math.abs(
				differenceInMilliseconds(queue.estimateNextRetryAt, beforeAt)
			);
			body.config.executeAt = addMilliseconds(transformAt, delay).getTime();
		} else {
			const diffMs = Math.abs(
				differenceInMilliseconds(queue.estimateExecutionAt, beforeAt)
			);
			body.config.executeAt = addMilliseconds(transformAt, diffMs).getTime();
		}
	} else {
		if (queue.retrying) {
			if (queue.retryAt == 0) {
				body.config.retry = queue.retryLimit - queue.retryCount;
			}
			const delay = Math.abs(
				differenceInMilliseconds(queue.estimateNextRetryAt, beforeAt)
			);
			body.config.executionDelay = delay;
		} else {
			const diffMs = Math.abs(
				differenceInMilliseconds(queue.estimateExecutionAt, beforeAt)
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
		db.run("UPDATE queue SET state = 'RUNNING', estimateEndAt = 0, estimateExecutionAt = ?1 WHERE queueId = ?2 AND subscriberId IN (SELECT subscriberId FROM subscriber);", [
			estimateExecutionAt,
			queue.queueId
		]);
	}
	return {
		subscriberId: queue.subscriberId,
		configId: queue.configId,
		queueId: queue.queueId,
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
	const q1 = db.query("SELECT q.subscriberId, q.estimateEndAt, q.estimateExecutionAt, c.*, (SELECT lastRecordAt FROM timeframe) AS lastRecordAt FROM queue AS q INNER JOIN config AS c ON q.queueId = c.queueId WHERE q.state = 'RUNNING';");
	const queueValues = q1.all(1) as Array<ResumeQueue & { lastRecordAt: number }> | null;
	q1.finalize();
	if (queueValues == null || queueValues.length == 0) {
		return null;
	}
	const stmt = db.prepare("UPDATE queue SET estimateExecutionAt = @estimateExecutionAt WHERE queueId = @queueId AND subscriberId IN (SELECT subscriberId FROM subscriber);");
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
			"@queueId": item.queueId
		}))
	);
	return resubscribes;
}

function trackLastRecord(db: Database) {
	interval(1000).subscribe({
		next() {
			db.run("UPDATE timeframe SET lastRecordAt = lastRecordAt;");
		}
	});
}

function genId(dateAt: number, start = 8, size = 10) {
	return dateAt.toString().substring(start) + randomBytes(size).toString("hex").toUpperCase();
}