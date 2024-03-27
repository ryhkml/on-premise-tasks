import { Database } from "bun:sqlite";

import { randomBytes } from "node:crypto";

import { Context, Elysia, t } from "elysia";

import { addMilliseconds, differenceInMilliseconds, isBefore } from "date-fns";
import { BehaviorSubject, catchError, defer, delay, filter, finalize, map, mergeMap, of, retry, switchMap, tap, throwError, timer } from "rxjs";
import { kebabCase, toSafeInteger } from "lodash";
import { AxiosError } from "axios";

import { fetch } from "../utils/fetch";
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
				if (index == -1) {
					return ctx.error("Unprocessable Content", {
						message: "The request did not meet one of it's preconditions"
					});
				}
				ctx.store.queues[index].subscription.unsubscribe();
				pauseQueue(ctx.db, ctx.params.id);
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
				// @ts-ignore
				pushSubscription({ ...ctx, body: resume.body }, resume.dueTime, resume.queueId, resume.configId);
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
				const deleted = deleteQueue(ctx.db, ctx.params.id);
				if (deleted == null) {
					return ctx.error("Unprocessable Content", {
						message: "The request did not meet one of it's preconditions"
					});
				}
				return {
					message: "Done"
				};
			}, {
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
					// for (let i = 0; i < ctx.store.queues.length; i++) {
					// 	const { id, subscription } = ctx.store.queues[i];
					// 	console.log(id, subscription);
					// }
					ctx.store.queues = ctx.store.queues.filter(queue => !queue.subscription?.closed);
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
	db.transaction(() => {
		db.run("UPDATE subscriber SET tasksInQueue = tasksInQueue - 1 WHERE subscriberId = ?;", [id]);
		db.run("UPDATE queue SET state = 'DONE', statusCode = 0, estimateEndAt = ?1 WHERE queueId = ?2 AND subscriberId IN (SELECT subscriberId FROM subscriber);", [
			Date.now(),
			queueId
		]);
	})();
}

interface ResumeQueue extends Pick<Queue, "estimateEndAt" | "estimateExecutionAt">, Config {}

function resumeQueue(db: Database, queueId: string) {
	const q = db.query("SELECT q.estimateEndAt, q.estimateExecutionAt, * FROM queue AS q INNER JOIN config AS c ON q.queueId = c.queueId WHERE q.queueId = ? AND q.state = 'PAUSED';");
	const value = q.get(queueId) as ResumeQueue | null;
	if (value == null) {
		return null;
	}
	const key = kebabCase(db.filename) + ":" + value.configId;
	const body = {
		httpRequest: {
			url: decr(value.url, key),
			method: value.method,
			body: !!value.bodyStringify
				? JSON.parse(decr(value.bodyStringify, key))
				: undefined,
			query: !!value.queryStringify
				? JSON.parse(decr(value.queryStringify, key))
				: undefined,
			headers: !!value.headersStringify
				? JSON.parse(decr(value.headersStringify, key))
				: undefined
		},
		config: {
			executionDelay: value.executionDelay,
			executeAt: value.executeAt,
			retry: value.retry,
			retryAt: value.retryAt,
			retryInterval: value.retryInterval,
			retryStatusCode: JSON.parse(value.retryStatusCode),
			retryExponential: !!value.retryExponential,
			timeout: value.timeout
		}
	} as TaskSubscriberRequest;
	const today = Date.now();
	if (value.executeAt) {
		const diffMs = Math.abs(
			differenceInMilliseconds(value.estimateExecutionAt, value.estimateEndAt)
		);
		body.config.executeAt = addMilliseconds(today, diffMs).getTime();
	} else {
		const diffMs = Math.abs(
			differenceInMilliseconds(value.estimateExecutionAt, value.estimateEndAt)
		);
		body.config.executionDelay = diffMs;
	}
	if (value.retrying) {
		body.config.retry = value.retry - value.retryCount;
	}
	const estimateExecutionAt = !!body.config.executeAt
		? body.config.executeAt
		: addMilliseconds(today, body.config.executionDelay).getTime();
	db.run("UPDATE queue SET state = 'RUNNING', estimateEndAt = 0, estimateExecutionAt = ?1 WHERE queueId = ?2 AND subscriberId IN (SELECT subscriberId FROM subscriber);", [
		estimateExecutionAt,
		queueId
	]);
	return {
		dueTime: !!body.config.executeAt
			? new Date(body.config.executeAt)
			: body.config.executionDelay,
		queueId,
		configId: value.configId,
		body
	};
}

function pauseQueue(db: Database, queueId: string) {
	db.run("UPDATE queue SET state = 'PAUSED', estimateEndAt = ?1 WHERE queueId = ?2 AND subscriberId IN (SELECT subscriberId FROM subscriber);", [
		Date.now(),
		queueId
	]);
}

interface SubscriptionContext extends Context {
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
	ctx.store.queues.push({
		id: queueId,
		subscription: timer(dueTime).pipe(
			switchMap(() => {
				let additionalHeaders = {} as { [k: string]: string };
				let estimateNextRetryAt = 0;
				return defer(() => fetch(ctx.body, additionalHeaders)).pipe(
					map(res => ({
						data: res.data,
						state: "DONE",
						status: res.status,
						statusText: res.statusText
					})),
					catchError(error => {
						if (error instanceof AxiosError) {
							const errorStatus = toSafeInteger(error.response?.status);
							const someErrorStatus = ctx.body.config.retryStatusCode.some(status => status == errorStatus);
							if (ctx.body.config.retryStatusCode.length == 0 || someErrorStatus) {
								if (ctx.body.config.retryAt) {
									ctx.db.run("UPDATE config SET retrying = 1, estimateNextRetryAt = ?1 WHERE configId = ?2 AND queueId IN (SELECT queueId FROM queue);", [
										ctx.body.config.retryAt,
										configId
									]);
								} else {
									if (estimateNextRetryAt == 0) {
										estimateNextRetryAt = addMilliseconds(Date.now(), ctx.body.config.retryInterval).getTime()
									}
									ctx.db.run("UPDATE config SET retrying = 1, estimateNextRetryAt = ?1 WHERE configId = ?2 AND queueId IN (SELECT queueId FROM queue);", [
										estimateNextRetryAt,
										configId
									]);
								}
								return throwError(() => ({
									status: errorStatus
								}));
							}
							return of({
								data: null,
								state: "ERROR",
								status: errorStatus,
								statusText: error.response?.statusText || ""
							});
						}
						return throwError(() => ({
							status: 500
						}))
					}),
					retry({
						count: ctx.body.config.retry,
						delay(_, count) {
							const errorDueTime = ctx.body.config.retryExponential
								? ctx.body.config.retryInterval * count
								: ctx.body.config.retryInterval;
							const errorTap = () => {
								estimateNextRetryAt = addMilliseconds(Date.now(), errorDueTime).getTime();
								additionalHeaders = {
									...additionalHeaders,
									"X-Tasks-Queue-Id": queueId,
									"X-Tasks-Retry-Limit": ctx.body.config.retry.toString(),
									"X-Tasks-Retry-Count": count.toString(),
									"X-Tasks-Estimate-Next-Retry-At": estimateNextRetryAt.toString()
								};
								if (ctx.body.config.retry == count) {
									delete additionalHeaders["X-Tasks-Estimate-Next-Retry-At"];
								}
								ctx.db.run("UPDATE config SET retryCount = retryCount + 1, headersStringify = ?1 WHERE configId = ?2 AND queueId IN (SELECT queueId FROM queue);", [
									encr(JSON.stringify(additionalHeaders), kebabCase(ctx.db.filename) + ":" + configId),
									configId
								]);
							}
							return timer(errorDueTime).pipe(
								tap(() => errorTap())
							);
						}
					})
				);
			}),
			finalize(() => ctx.subject.next(null))
		)
		.subscribe({
			next(res) {
				ctx.db.transaction(() => {
					ctx.db.run("UPDATE subscriber SET tasksInQueue = tasksInQueue - 1 WHERE subscriberId = ?;", [ctx.id]);
					ctx.db.run("UPDATE queue SET state = ?1, statusCode = ?2, estimateEndAt = ?3 WHERE queueId = ?4 AND subscriberId IN (SELECT subscriberId FROM subscriber);", [
						res.state,
						res.status,
						Date.now(),
						queueId
					]);
					ctx.db.run("UPDATE config SET retrying = 0, estimateNextRetryAt = 0 WHERE configId = ? AND queueId IN (SELECT queueId FROM queue);", [configId]);
				})();
			},
			error(error) {
				ctx.db.transaction(() => {
					ctx.db.run("UPDATE subscriber SET tasksInQueue = tasksInQueue - 1 WHERE subscriberId = ?;", [ctx.id]);
					ctx.db.run("UPDATE queue SET state = ?1, statusCode = ?2, estimateEndAt = ?3 WHERE queueId = ?4 AND subscriberId IN (SELECT subscriberId FROM subscriber);", [
						"ERROR",
						error.status,
						Date.now(),
						queueId
					]);
					ctx.db.run("UPDATE config SET retrying = 0, estimateNextRetryAt = 0 WHERE configId = ? AND queueId IN (SELECT queueId FROM queue);", [configId]);
				})();
			}
		})
	});
}

function registerQueue(ctx: SubscriptionContext) {
	const queueId = randomBytes(6).toString("hex").toUpperCase() + ctx.today.toString();
	const configId = randomBytes(6).toString("hex").toUpperCase() + ctx.today.toString();
	const key = kebabCase(ctx.db.filename) + ":" + configId;
	const dueTime = !!ctx.body.config.executeAt
		? new Date(ctx.body.config.executeAt)
		: ctx.body.config.executionDelay;
	const estimateExecutionAt = typeof dueTime === "number"
		? addMilliseconds(ctx.today, dueTime)
		: dueTime;
	pushSubscription(ctx, dueTime, queueId, configId);
	ctx.db.transaction(() => {
		ctx.db.run("UPDATE subscriber SET tasksInQueue = tasksInQueue + 1 WHERE subscriberId = ?;", [ctx.id]);
		ctx.db.run("INSERT INTO queue (queueId, subscriberId, estimateExecutionAt) VALUES (?1, ?2, ?3);", [
			queueId,
			ctx.id,
			estimateExecutionAt.getTime()
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
		estimateExecutionAt: estimateExecutionAt.getTime()
	} as Queue;
}

function deleteQueue(db: Database, id: string) {
	const queue = getQueue(db, id);
	if (queue == null) {
		return null;
	}
	db.run("DELETE FROM queue WHERE queueId = ? AND subscriberId IN (SELECT subscriberId FROM subscriber);", [id]);
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

function getQueue(db: Database, id: string) {
	const q = db.query("SELECT state, statusCode, estimateEndAt, estimateExecutionAt FROM queue WHERE queueId = ? AND subscriberId IN (SELECT subscriberId FROM subscriber) LIMIT 1;");
	const value = q.get(id) as {} | null;
	q.finalize();
	if (value == null) {
		return null;
	}
	return {
		id,
		...value
	} as Queue;
}