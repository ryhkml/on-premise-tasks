import { Database } from "bun:sqlite";

import { Elysia, t } from "elysia";

import { addMilliseconds, isBefore } from "date-fns";
import { catchError, defer, map, retry, switchMap, tap, throwError, timer } from "rxjs";
import { toSafeInteger } from "lodash";
import { AxiosError } from "axios";
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
		.onStart(() => {
			// Queue re-registration mechanism if the server goes down
		});
}

function isTasksInQueueReachTheLimit(db: Database, id: string) {
	const q = db.query("SELECT tasksInQueue, tasksInQueueLimit FROM subscriber WHERE subscriberId = ?;");
	const value = q.get(id) as Pick<SubscriberContext, "tasksInQueue" | "tasksInQueueLimit">;
	return value.tasksInQueue >= value.tasksInQueueLimit;
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
	const queueId = ulid().toLowerCase().substring(0, 13) + Date.now().toString().substring(6);
	const dueTime = body.config.executeAt
		? new Date(body.config.executeAt)
		: body.config.executionDelay;
	const estimateExecutionAt = typeof dueTime === "number"
		? addMilliseconds(today, dueTime)
		: dueTime;
	const increment = db.prepare("UPDATE subscriber SET tasksInQueue = tasksInQueue + 1 WHERE subscriberId = ?;");
	const decrement = db.prepare("UPDATE subscriber SET tasksInQueue = tasksInQueue - 1 WHERE subscriberId = ?;");
	const updateQueue = db.prepare("UPDATE queue SET state = ?1, statusCode = ?2, estimateEndAt = ?3 WHERE queueId = ?4 AND subscriberId IN (SELECT subscriberId FROM subscriber);");
	const subscription = timer(dueTime).pipe(
		switchMap(() => {
			let additionalHeaders = {} as { [k: string]: string };
			return defer(() => httpRequest(body, additionalHeaders)).pipe(
				map(res => ({
					data: res.data,
					status: res.status,
					statusText: res.statusText
				})),
				catchError(error => throwError(() => {
					if (error instanceof AxiosError) {
						return {
							status: toSafeInteger(error.response?.status)
						};
					}
					return {
						status: 422
					};
				})),
				retry({
					count: body.config.retry,
					delay(_, count) {
						const dueTimeError = body.config.retryExponential
							? body.config.retryInterval * count
							: body.config.retryInterval;
						const todayError = Date.now();
						const tapError = () => {
							additionalHeaders = {
								...additionalHeaders,
								"X-Tasks-Queue-Id": queueId,
								"X-Tasks-Retry-Limit": body.config.retry.toString(),
								"X-Tasks-Retry-Count": count.toString(),
								"X-Tasks-Estimate-Next-Retry-At": addMilliseconds(todayError, body.config.retryInterval * count).getTime().toString()
							};
							if (body.config.retry == count) {
								delete additionalHeaders["X-Tasks-Estimate-Next-Retry-At"];
							}
						}
						return timer(dueTimeError).pipe(
							tap(() => tapError())
						);
					}
				})
			);
		})
	)
	.subscribe({
		next(res) {
			db.transaction(() => {
				increment.run(id);
				updateQueue.run("DONE", res.status, Date.now(), queueId);
			})();
		},
		error(err) {
			db.transaction(() => {
				decrement.run(id);
				updateQueue.run("ERROR", err.status, Date.now(), queueId);
			})();
		}
	});
	db.transaction(() => {
		increment.run(id);
		db.run("INSERT INTO queue (queueId, subscriberId, state, statusCode, estimateEndAt, estimateExecutionAt) VALUES (?1, ?2, ?3, ?4, ?5, ?6);", [
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

function deleteQueue(db: Database, queueId: string) {
	db.run("DELETE FROM queue WHERE queueId = ? AND subscriberId IN (SELECT subscriberId FROM subscriber);", [queueId]);
}

function getQueue(db: Database, queueId: string) {
	const q = db.query("SELECT queueId, state, statusCode, estimateEndAt, estimateExecutionAt FROM queue WHERE queueId = ? AND subscriberId IN (SELECT subscriberId FROM subscriber);");
	return q.get(queueId) as Queue | null;
}