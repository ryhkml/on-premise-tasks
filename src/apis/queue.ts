import { Database } from "bun:sqlite";

import { randomBytes } from "node:crypto";

import { Elysia, t } from "elysia";

import { addMilliseconds, isBefore } from "date-fns";
import { catchError, defer, map, retry, switchMap, tap, throwError, timer } from "rxjs";
import { kebabCase, toSafeInteger } from "lodash";
import { AxiosError } from "axios";

import { pluginApi } from "../plugin";
import { httpRequest } from "../utils/fetch";
import { isValidSubscriber } from "../auth/auth";
import { encr } from "../utils/crypto";

export function queue() {
	return new Elysia({ prefix: "/queues" })
		.use(pluginApi())
		.onBeforeHandle(async ctx => {
			return await isValidSubscriber(ctx);
		})
		.state("queues", [] as Array<SafeQueue>)
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
				const index = ctx.store.queues.findIndex(queue => queue.id == ctx.params.id);
				if (index == -1) {
					return ctx.error("Not Found", {
						message: "A request includes an invalid credential or value"
					});
				}
				return getQueue(ctx.db, ctx.params.id);
			})
			.get("/:id/config", ctx => {

			})
			.patch("/:id/pause", ctx => {

			})
			.patch("/:id/resume", ctx => {

			})
			.patch("/:id/unsubscribe", ctx => {
				const index = ctx.store.queues.findIndex(queue => queue.id == ctx.params.id);
				if (index == -1 || ctx.store.queues[index].subscription == null) {
					return ctx.error("Bad Request", {
						message: "A request includes an invalid credential or value"
					});
				}
				ctx.store.queues[index].subscription!.unsubscribe();
				ctx.store.queues[index].subscription = null;
				unsubscribeQueue(ctx.db, ctx.id, ctx.params.id);
				return {
					message: "Done"
				};
			})
			.delete("/:id", ctx => {
				const index = ctx.store.queues.findIndex(queue => queue.id == ctx.params.id);
				if (index == -1 || ctx.store.queues[index].subscription) {
					return ctx.error("Bad Request", {
						message: "A request includes an invalid credential or value"
					});
				}
				ctx.store.queues = ctx.store.queues.filter(queue => queue.subscription != null);
				deleteQueue(ctx.db, ctx.params.id);
				return {
					message: "Done"
				};
			})
		)
		.decorate("defaultConfig", {
			executionDelay: 1,
			executeAt: 0,
			retry: 0,
			retryAt: 0,
			retryInterval: 0,
			retryExponential: true,
			timeout: 30000
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
					configId: t.String(),
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
		.onStart(() => {
			// Queue re-registration mechanism if the server goes down
		});
}

function isTasksInQueueReachTheLimit(db: Database, id: string) {
	const q = db.query("SELECT 1 FROM subscriber WHERE subscriberId = ? AND tasksInQueue < tasksInQueueLimit;");
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

function registerQueue(db: Database, id: string, today: number, body: TaskSubscriberRequest) {
	const queueId = randomBytes(6).toString("hex").toUpperCase() + today.toString();
	const configId = randomBytes(6).toString("hex").toUpperCase() + today.toString();
	const key = kebabCase(db.filename) + ":" + configId;
	const dueTime = body.config.executeAt
		? new Date(body.config.executeAt)
		: body.config.executionDelay;
	const estimateExecutionAt = typeof dueTime === "number"
		? addMilliseconds(today, dueTime)
		: dueTime;
	const subscription = timer(dueTime).pipe(
		switchMap(() => {
			let additionalHeaders = {} as { [k: string]: string };
			let estimateNextRetryAt = 0;
			return defer(() => httpRequest(body, additionalHeaders)).pipe(
				map(res => ({
					data: res.data,
					status: res.status,
					statusText: res.statusText
				})),
				catchError(error => {
					if (body.config.retryAt) {
						db.run("UPDATE config SET retrying = 1, estimateNextRetryAt = ?1 WHERE configId = ?2 AND queueId IN (SELECT queueId FROM queue);", [
							body.config.retryAt,
							configId
						]);
					} else {
						if (estimateNextRetryAt == 0) {
							estimateNextRetryAt = addMilliseconds(Date.now(), body.config.retryInterval).getTime()
						}
						db.run("UPDATE config SET retrying = 1, estimateNextRetryAt = ?1 WHERE configId = ?2 AND queueId IN (SELECT queueId FROM queue);", [
							estimateNextRetryAt,
							configId
						]);
					}
					return throwError(() => {
						if (error instanceof AxiosError) {
							return {
								status: toSafeInteger(error.response?.status)
							};
						}
						return {
							status: 422
						};
					})
				}),
				retry({
					count: body.config.retry,
					delay(_, count) {
						const errorToday = Date.now();
						const errorDueTime = body.config.retryExponential
							? body.config.retryInterval * count
							: body.config.retryInterval;
						const errorTap = () => {
							estimateNextRetryAt = addMilliseconds(errorToday, errorDueTime).getTime();
							additionalHeaders = {
								...additionalHeaders,
								"X-Tasks-Queue-Id": queueId,
								"X-Tasks-Retry-Limit": body.config.retry.toString(),
								"X-Tasks-Retry-Count": count.toString(),
								"X-Tasks-Estimate-Next-Retry-At": estimateNextRetryAt.toString()
							};
							if (body.config.retry == count) {
								delete additionalHeaders["X-Tasks-Estimate-Next-Retry-At"];
							}
							db.run("UPDATE config SET retryCount = retryCount + 1 WHERE configId = ? AND queueId IN (SELECT queueId FROM queue);", [configId]);
						}
						return timer(errorDueTime).pipe(
							tap(() => errorTap())
						);
					}
				})
			);
		})
	)
	.subscribe({
		next(res) {
			db.transaction(() => {
				db.run("UPDATE subscriber SET tasksInQueue = tasksInQueue - 1 WHERE subscriberId = ?;", [id]);
				db.run("UPDATE queue SET state = ?1, statusCode = ?2, estimateEndAt = ?3 WHERE queueId = ?4 AND subscriberId IN (SELECT subscriberId FROM subscriber);", [
					"DONE",
					res.status,
					Date.now(),
					queueId
				]);
				db.run("UPDATE config SET retrying = 0, estimateNextRetryAt = 0 WHERE configId = ? AND queueId IN (SELECT queueId FROM queue);", [configId]);
			})();
		},
		error(error) {
			db.transaction(() => {
				db.run("UPDATE subscriber SET tasksInQueue = tasksInQueue - 1 WHERE subscriberId = ?;", [id]);
				db.run("UPDATE queue SET state = ?1, statusCode = ?2, estimateEndAt = ?3 WHERE queueId = ?4 AND subscriberId IN (SELECT subscriberId FROM subscriber);", [
					"ERROR",
					error.status,
					Date.now(),
					queueId
				]);
				db.run("UPDATE config SET retrying = 0, estimateNextRetryAt = 0 WHERE configId = ? AND queueId IN (SELECT queueId FROM queue);", [configId]);
			})();
		}
	});
	db.transaction(() => {
		db.run("UPDATE subscriber SET tasksInQueue = tasksInQueue + 1 WHERE subscriberId = ?;", [id]);
		db.run("INSERT INTO queue (queueId, subscriberId, estimateExecutionAt) VALUES (?1, ?2, ?3);", [
			queueId,
			id,
			estimateExecutionAt.getTime()
		]);
		db.run("INSERT INTO config (configId, queueId, url, method, timeout) VALUES (?1, ?2, ?3, ?4, ?5);", [
			configId,
			queueId,
			encr(body.httpRequest.url, key),
			body.httpRequest.method,
			body.config.timeout
		]);
		if (body.config.executeAt) {
			db.run("UPDATE config SET executeAt = ?1 WHERE configId = ?2 AND queueId IN (SELECT queueId FROM queue);", [
				body.config.executeAt,
				configId
			]);
		} else {
			db.run("UPDATE config SET executionDelay = ?1 WHERE configId = ?2 AND queueId IN (SELECT queueId FROM queue);", [
				body.config.executionDelay,
				configId
			]);
		}
		if (body.httpRequest.body) {
			const strBody = JSON.stringify(body.httpRequest.body);
			db.run("UPDATE config SET bodyStringify = ?1 WHERE configId = ?2 AND queueId IN (SELECT queueId FROM queue);", [
				encr(strBody, key),
				configId
			]);
		}
		if (body.httpRequest.query) {
			const strQuery = JSON.stringify(body.httpRequest.query);
			db.run("UPDATE config SET queryStringify = ?1 WHERE configId = ?2 AND queueId IN (SELECT queueId FROM queue);", [
				encr(strQuery, key),
				configId
			]);
		}
		if (body.httpRequest.headers) {
			const strHeaders = JSON.stringify(body.httpRequest.headers);
			db.run("UPDATE config SET headersStringify = ?1 WHERE configId = ?2 AND queueId IN (SELECT queueId FROM queue);", [
				encr(strHeaders, key),
				configId
			]);
		}
		if (body.config.retryAt) {
			db.run("UPDATE config SET retry = 1, retryAt = ?1, retryLimit = 1, retryExponential = 0 WHERE configId = ?2 AND queueId IN (SELECT queueId FROM queue);", [
				body.config.retryAt,
				configId
			]);
		}
		if (body.config.retry) {
			const retryExponential = body.config.retryExponential ? 1 : 0;
			db.run("UPDATE config SET retry = ?1, retryLimit = ?1, retryInterval = ?2, retryExponential = ?3 WHERE configId = ?4 AND queueId IN (SELECT queueId FROM queue);", [
				body.config.retry,
				body.config.retryInterval,
				retryExponential,
				configId
			]);
		}
	})();
	return {
		id: queueId,
		estimateExecutionAt: estimateExecutionAt.getTime(),
		subscription
	};
}

function deleteQueue(db: Database, id: string) {
	db.run("DELETE FROM queue WHERE queueId = ? AND subscriberId IN (SELECT subscriberId FROM subscriber);", [id]);
}

function getConfig(db: Database) {
	const q = db.query("SELECT * FROM config WHERE queueId IN (SELECT queueId FROM queue);");
	const value = q.get();
	q.finalize();
	return value;
}

function getQueues(db: Database, id: string) {
	const q = db.query("SELECT * FROM queue WHERE subscriberId = ? AND subscriberId IN (SELECT subscriberId FROM subscriber);");
	const value = q.all(id) as Array<Queue> | null;
	q.finalize();
	return value;
}

function getQueue(db: Database, id: string) {
	const q = db.query("SELECT * FROM queue WHERE queueId = ? AND subscriberId IN (SELECT subscriberId FROM subscriber);");
	const value = q.get(id) as Queue | null;
	q.finalize();
	return value;
}