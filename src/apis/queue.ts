import { env } from "bun";
import { Database } from "bun:sqlite";

import { rmSync } from "node:fs";

import { randomBytes } from "node:crypto";

import { Elysia, t } from "elysia";
import { cron, Patterns } from "@elysiajs/cron";

import { addMilliseconds, differenceInMilliseconds, isAfter, isBefore, millisecondsToSeconds } from "date-fns";
import { BehaviorSubject, catchError, defer, delay, filter, finalize, map, mergeMap, of, retry, switchMap, tap, throwError, timer } from "rxjs";
import { isPlainObject, isString, kebabCase, toSafeInteger, toString } from "lodash";

import { DEFAULT_CONFIG, http } from "../utils/http";
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
		.decorate("defaultConfig", DEFAULT_CONFIG)
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
					ctx.body.httpRequest.method = ctx.body.httpRequest.method.toUpperCase() as HttpMethod;
					if (ctx.body.httpRequest.data && (ctx.body.httpRequest.method == "GET" || ctx.body.httpRequest.method == "DELETE")) {
						ctx.body.httpRequest.data = undefined;
					}
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
				if (ctx.body.config.dohUrl) {
					ctx.body.config.dohUrl = new URL(ctx.body.config.dohUrl).toString();
				}
				if (ctx.body.config.refererUrl) {
					if (ctx.body.config.refererUrl.toUpperCase() == "AUTO") {
						ctx.body.config.refererUrl = ctx.body.config.refererUrl.toUpperCase();
					}
					if (ctx.body.config.refererUrl != "AUTO") {
						ctx.body.config.refererUrl = new URL(ctx.body.config.refererUrl).toString();
					}
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
					if (ctx.body.config.timeoutAt) {
						const estimateTimeoutAt = new Date(ctx.body.config.timeoutAt);
						if (isAfter(estimateTimeoutAt, estimateRetryAt)) {
							return ctx.error("Bad Request", {
								message: "Timeout date must be less than retry date"
							});
						}
					}
				} else {
					if (ctx.body.config.timeoutAt) {
						const estimateTimeoutAt = new Date(ctx.body.config.timeoutAt);
						if (isBefore(estimateTimeoutAt, stateEstimateExecutionDate)) {
							return ctx.error("Bad Request", {
								message: "Timeout date must be greater than execution date"
							});
						}
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
							// Plain text
							t.String({
								default: null,
								minLength: 1,
								maxLength: Number.MIN_SAFE_INTEGER
							}),
							// Form
							t.Array(
								t.Object({
									name: t.String({
										minLength: 1,
										maxLength: 128,
										pattern: "^[a-zA-Z0-9\-\_\:\.]$"
									}),
									value: t.String({
										minLength: 1,
										maxLength: Number.MAX_SAFE_INTEGER
									})
								}),
								{
									default: null,
									minItems: 1,
									maxItems: 4096
								}
							),
							// Json
							t.Record(
								t.String({
									minLength: 1,
									maxLength: 128,
									pattern: "^[a-zA-Z0-9\-\_\:\.]$"
								}),
								t.Any(),
								{
									default: null,
									minProperties: 1,
									maxProperties: Number.MAX_SAFE_INTEGER,
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
							}),
							{
								minProperties: 1,
								maxProperties: Number.MAX_SAFE_INTEGER
							}
						)
					),
					cookie: t.Optional(
						t.Array(
							t.Object({
								name: t.String({
									minLength: 1,
									maxLength: 128,
									pattern: "^[a-zA-Z0-9\-\_\:\.]$"
								}),
								value: t.String({
									minLength: 1,
									maxLength: 4096
								})
							}),
							{
								default: null,
								minItems: 1,
								maxItems: 4096,
								uniqueItems: true
							}
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
								default: null,
								minProperties: 1,
								maxProperties: Number.MAX_SAFE_INTEGER
							}
						)
					),
					authBasic: t.Optional(
						t.Object({
							user: t.String({
								minLength: 1,
								maxLength: 128
							}),
							password: t.String({
								minLength: 1,
								maxLength: 4096
							})
						}, {
							default: null
						})
					),
					authDigest: t.Optional(
						t.Object({
							user: t.String({
								minLength: 1,
								maxLength: 128
							}),
							password: t.String({
								minLength: 1,
								maxLength: 4096
							})
						}, {
							default: null
						})
					),
					authNtlm: t.Optional(
						t.Object({
							user: t.String({
								minLength: 1,
								maxLength: 128
							}),
							password: t.String({
								minLength: 1,
								maxLength: 4096
							})
						}, {
							default: null
						})
					),
					authAwsSigv4: t.Optional(
						t.Object({
							provider1: t.String({
								minLength: 3
							}),
							provider2: t.String({
								minLength: 3
							}),
							region: t.String(),
							service: t.String({
								minLength: 2
							}),
							key: t.String(),
							secret: t.String()
						}, {
							default: null
						})
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
						maximum: Number.MAX_SAFE_INTEGER
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
							maxItems: 40,
							uniqueItems: true
						}
					),
					retryExponential: t.Boolean({
						default: true
					}),
					timeout: t.Integer({
						default: 30000,
						minimum: 1000,
						maximum: 3600000
					}),
					timeoutAt: t.Integer({
						default: 0,
						minimum: 0,
						maximum: Number.MAX_SAFE_INTEGER
					}),
					ca: t.Union([
						t.Array(t.String({ contentEncoding: "base64" }), {
							minItems: 1,
							maxItems: 32,
							uniqueItems: true
						}),
						t.Null()
					], {
						default: null
					}),
					cert: t.Union([
						t.Object({
							value: t.String({ contentEncoding: "base64" }),
							password: t.Optional(t.String({
								minLength: 1,
								maxLength: Number.MAX_SAFE_INTEGER
							}))
						}, {
							minProperties: 1,
							maxProperties: 2
						}),
						t.Null()
					], {
						default: null
					}),
					certType: t.Union([
						t.Literal("DER"),
						t.Literal("ENG"),
						t.Literal("P12"),
						t.Literal("PEM"),
						t.Null()
					], {
						default: null
					}),
					certStatus: t.Union([
						t.Boolean(),
						t.Null()
					], {
						default: null
					}),
					key: t.Union([
						t.String({ contentEncoding: "base64" }),
						t.Null()
					], {
						default: null
					}),
					keyType: t.Union([
						t.Literal("DER"),
						t.Literal("ENG"),
						t.Literal("PEM"),
						t.Null()
					], {
						default: null
					}),
					location: t.Boolean({
						default: false
					}),
					locationTrusted: t.Union([
						t.Object({
							user: t.String({
								minLength: 1,
								maxLength: 128
							}),
							password: t.String({
								minLength: 1,
								maxLength: 4096
							})
						}),
						t.Null()
					], {
						default: null
					}),
					proto: t.Union([
						t.Literal("http"),
						t.Literal("https"),
						t.Null()
					], {
						default: null
					}),
					protoRedirect: t.Union([
						t.Literal("http"),
						t.Literal("https"),
						t.Null()
					], {
						default: null
					}),
					dnsServer: t.Union([
						t.Array(
							t.String({
								format: "ipv4"
							}),
							{
								default: null,
								minItems: 1,
								maxItems: 4,
								uniqueItems: true
							}
						),
						t.Array(
							t.String({
								format: "ipv6"
							}),
							{
								default: null,
								minItems: 1,
								maxItems: 4,
								uniqueItems: true
							}
						),
						t.Null()
					], {
						default: null
					}),
					dohUrl: t.Union([
						t.String({
							pattern: "^https?:\/\/(\w+(-\w+)*)(\.(\w+(-\w+)*))*(\.\w{2,})\/dns-query$"
						}),
						t.Null()
					], {
						default: null
					}),
					dohInsecure: t.Boolean({
						default: false
					}),
					httpVersion: t.Union([
						t.Literal("0.9"),
						t.Literal("1.0"),
						t.Literal("1.1"),
						t.Literal("2"),
						t.Literal("2-prior-knowledge")
					], {
						default: "1.1"
					}),
					insecure: t.Boolean({
						default: false
					}),
					refererUrl: t.Union([
						t.String({
							pattern: "^(http|https)://([a-zA-Z0-9]+([-.][a-zA-Z0-9]+)*\.[a-zA-Z]{2,})(/[a-zA-Z0-9_.-]*)*/?$",
							maxLength: 2048
						}),
						t.Literal("AUTO"),
						t.Null()
					], {
						default: null
					}),
					redirectAttempts: t.Integer({
						default: 8,
						minimum: 0,
						maximum: 64
					}),
					keepAliveDuration: t.Integer({
						default: 30,
						minimum: 0,
						maximum: 259200
					}),
					resolve: t.Union([
						t.Array(
							t.Object({
								host: t.Union([
									t.String({
										pattern: "^(([a-zA-Z0-9]|[a-zA-Z0-9][a-zA-Z0-9\-]*[a-zA-Z0-9])\.)*([A-Za-z0-9]|[A-Za-z0-9][A-Za-z0-9\-]*[A-Za-z0-9])$"
									}),
									t.Literal("*")
								]),
								port: t.Integer({
									minimum: 1,
									maximum: 65535
								}),
								address: t.Union([
									t.Array(
										t.String({
											format: "ipv4"
										}),
										{
											default: null,
											minItems: 1,
											maxItems: 8,
											uniqueItems: true
										}
									),
									t.Array(
										t.String({
											format: "ipv6"
										}),
										{
											default: null,
											minItems: 1,
											maxItems: 8,
											uniqueItems: true
										}
									),
								], {
									default: []
								})
							}),
							{
								default: null,
								minItems: 1,
								maxItems: 128,
								uniqueItems: true
							}
						),
						t.Null()
					], {
						default: null
					}),
					ipVersion: t.Union([
						t.Literal(4),
						t.Literal(6)
					], {
						default: 4
					}),
					hsts: t.Union([
						t.String({ contentEncoding: "base64" }),
						t.Boolean(),
						t.Null()
					], {
						default: null
					}),
					sessionId: t.Boolean({
						default: true
					}),
					tlsVersion: t.Union([
						t.Literal("1.0"),
						t.Literal("1.1"),
						t.Literal("1.2"),
						t.Literal("1.3"),
						t.Null()
					], {
						default: null
					}),
					tlsMaxVersion: t.Union([
						t.Literal("1.0"),
						t.Literal("1.1"),
						t.Literal("1.2"),
						t.Literal("1.3"),
						t.Null()
					], {
						default: null
					}),
					haProxyClientIp: t.Union([
						t.String({
							format: "ipv4"
						}),
						t.String({
							format: "ipv6"
						}),
						t.Null()
					], {
						default: null
					}),
					haProxyProtocol: t.Union([
						t.Boolean(),
						t.Null()
					], {
						default: null
					}),
					proxy: t.Union([
						t.Object({
							protocol: t.Union([
								t.Literal("http"),
								t.Literal("https")
							]),
							host: t.Union([
								t.String({
									format: "ipv4"
								}),
								t.String({
									pattern: "^(([a-zA-Z0-9]|[a-zA-Z0-9][a-zA-Z0-9\-]*[a-zA-Z0-9])\.)*([A-Za-z0-9]|[A-Za-z0-9][A-Za-z0-9\-]*[A-Za-z0-9])$",
									maxLength: 2048
								})
							]),
							port: t.Optional(
								t.Integer({
									minimum: 1,
									maximum: 65535
								})
							)
						}),
						t.Null()
					], {
						default: null
					}),
					proxyAuthBasic: t.Union([
						t.Object({
							user: t.String({
								minLength: 1,
								maxLength: 128
							}),
							password: t.String({
								minLength: 1,
								maxLength: 4096
							})
						}, {
							default: null
						}),
						t.Null()
					], {
						default: null
					}),
					proxyAuthDigest: t.Union([
						t.Object({
							user: t.String({
								minLength: 1,
								maxLength: 128
							}),
							password: t.String({
								minLength: 1,
								maxLength: 4096
							})
						}, {
							default: null
						}),
						t.Null()
					], {
						default: null
					}),
					proxyAuthNtlm: t.Union([
						t.Object({
							user: t.String({
								minLength: 1,
								maxLength: 128
							}),
							password: t.String({
								minLength: 1,
								maxLength: 4096
							})
						}, {
							default: null
						}),
						t.Null()
					], {
						default: null
					}),
					proxyHeaders: t.Union([
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
								default: null,
								minProperties: 1,
								maxProperties: Number.MAX_SAFE_INTEGER
							}
						),
						t.Null()
					], {
						default: null
					}),
					proxyHttpVersion: t.Union([
						t.Literal("1.0"),
						t.Literal("1.1"),
						t.Null()
					], {
						default: null
					}),
					proxyInsecure: t.Boolean({
						default: false
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
	let resId = "";
	const log = toSafeInteger(env.LOG) == 1;
	const stmtQ = ctx.db.prepare<void, [string, number, Buffer, number, string]>("UPDATE queue SET state = ?1, statusCode = ?2, finalize = ?3, estimateEndAt = ?4 WHERE id = ?5 AND subscriberId IN (SELECT id FROM subscriber);");
	const stmtC = ctx.db.prepare<Pick<ConfigTable, "retryCount" | "retryLimit">, string>("UPDATE config SET retrying = 1 WHERE id = ? AND id IN (SELECT id FROM queue) RETURNING retryCount, retryLimit;");
	const stmtQErr = ctx.db.prepare<void, [number, Buffer, string]>("UPDATE queue SET statusCode = ?1, finalize = ?2 WHERE id = ?3 AND subscriberId IN (SELECT id FROM subscriber);");
	const stmtCErr = ctx.db.prepare<void, [string, number, string]>("UPDATE config SET headers = ?1, estimateNextRetryAt = ?2 WHERE id = ?3 AND id IN (SELECT id FROM queue);");
	ctx.store.queues.push({
		id: queueId,
		subscription: timer(dueTime).pipe(
			switchMap(() => {
				let additionalHeaders = {} as { [k: string]: string };
				let stateMs = 0;
				return defer(() => http(ctx.body, additionalHeaders)).pipe(
					tap({
						next: ({ id }) => resId = id
					}),
					catchError((error: FetchRes) => {
						resId = error.id;
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
			},
			complete() {
				rmSync("/tmp/" + resId, {
					recursive: true,
					force: true
				});
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
	let raw = "UPDATE config SET";
	const rawBindings = [] as Array<string | number>;
	if (ctx.body.httpRequest.method) {
		raw += " method = ?,";
		rawBindings.push(ctx.body.httpRequest.method);
	}
	if (ctx.body.config.executeAt) {
		raw += " executeAt = ?,";
		rawBindings.push(ctx.body.config.executeAt);
	} else {
		raw += " executionDelay = ?,";
		rawBindings.push(ctx.body.config.executionDelay);
	}
	if (ctx.body.httpRequest.data) {
		raw += " data = ?,";
		rawBindings.push(
			encr(JSON.stringify(ctx.body.httpRequest.data), key)
		);
	}
	if (ctx.body.httpRequest.query) {
		raw += " query = ?,";
		rawBindings.push(
			encr(JSON.stringify(ctx.body.httpRequest.query), key)
		);
	}
	if (ctx.body.httpRequest.cookie) {
		raw += " cookie = ?,";
		rawBindings.push(
			encr(JSON.stringify(ctx.body.httpRequest.cookie), key)
		);
	}
	if (ctx.body.httpRequest.headers) {
		raw += " headers = ?,";
		rawBindings.push(
			encr(JSON.stringify(ctx.body.httpRequest.headers), key)
		);
	}
	if (ctx.body.httpRequest.authBasic) {
		raw += " authBasic = ?,";
		rawBindings.push(
			encr(JSON.stringify(ctx.body.httpRequest.authBasic), key)
		);
	}
	if (ctx.body.httpRequest.authDigest) {
		raw += " authDigest = ?,";
		rawBindings.push(
			encr(JSON.stringify(ctx.body.httpRequest.authDigest), key)
		);
	}
	if (ctx.body.httpRequest.authNtlm) {
		raw += " authNtlm = ?,";
		rawBindings.push(
			encr(JSON.stringify(ctx.body.httpRequest.authNtlm), key)
		);
	}
	if (ctx.body.httpRequest.authAwsSigv4) {
		raw += " authAwsSigv4 = ?,";
		rawBindings.push(
			encr(JSON.stringify(ctx.body.httpRequest.authAwsSigv4), key)
		);
	}
	if (ctx.body.config.retryAt) {
		raw += " retry = 1, retryAt = ?, retryLimit = 1, retryExponential = 0,";
		rawBindings.push(ctx.body.config.retryAt);
	} else {
		const retryExponential = ctx.body.config.retryExponential ? 1 : 0;
		raw += " retry = ?, retryLimit = ?, retryInterval = ?, retryExponential = ?,";
		rawBindings.push(ctx.body.config.retry);
		rawBindings.push(ctx.body.config.retry);
		rawBindings.push(ctx.body.config.retryInterval);
		rawBindings.push(retryExponential);
	}
	if (ctx.body.config.retryStatusCode.length) {
		raw += " retryStatusCode = ?,";
		rawBindings.push(JSON.stringify(ctx.body.config.retryStatusCode));
	}
	if (ctx.body.config.timeout != 30000) {
		raw += " timeout = ?,";
		rawBindings.push(ctx.body.config.timeout);
	}
	if (ctx.body.config.timeoutAt) {
		raw += " timeoutAt = ?,";
		rawBindings.push(ctx.body.config.timeoutAt);
	}
	if (ctx.body.config.proto) {
		raw += " proto = ?,";
		rawBindings.push(ctx.body.config.proto);
	}
	if (ctx.body.config.ca) {
		raw += " ca = ?,";
		rawBindings.push(
			encr(JSON.stringify(ctx.body.config.ca), key)
		);
	}
	if (ctx.body.config.cert?.value) {
		raw += " cert = ?,";
		rawBindings.push(
			encr(JSON.stringify(ctx.body.config.cert), key)
		);
		if (ctx.body.config.certType) {
			raw += " certType = ?,";
			rawBindings.push(
				encr(ctx.body.config.certType, key)
			);
		}
	}
	if (ctx.body.config.certStatus) {
		raw += " certStatus = 1,";
	}
	if (ctx.body.config.key) {
		raw += " key = ?,";
		rawBindings.push(
			encr(ctx.body.config.key, key)
		);
		if (ctx.body.config.keyType) {
			raw += " keyType = ?,";
			rawBindings.push(
				encr(ctx.body.config.keyType, key)
			);
		}
	}
	if (ctx.body.config.location) {
		raw += " location = 1,";
		if (ctx.body.config.redirectAttempts != 8) {
			raw += " redirectAttempts = ?,";
			rawBindings.push(ctx.body.config.redirectAttempts);
		}
		if (ctx.body.config.protoRedirect) {
			raw += " protoRedirect = ?,";
			rawBindings.push(ctx.body.config.protoRedirect);
		}
		if (ctx.body.config.locationTrusted) {
			raw += " locationTrusted = ?,";
			rawBindings.push(
				encr(JSON.stringify(ctx.body.config.locationTrusted), key)
			);
		}
	}
	if (ctx.body.config.dnsServer) {
		raw += " dnsServer = ?,";
		rawBindings.push(
			encr(JSON.stringify(ctx.body.config.dnsServer), key)
		);
	}
	if (ctx.body.config.dohUrl) {
		raw += " dohUrl = ?,";
		rawBindings.push(
			encr(JSON.stringify(ctx.body.config.dohUrl), key)
		);
	}
	if (ctx.body.config.dohInsecure) {
		raw += " dohInsecure = 1,";
	}
	if (ctx.body.config.httpVersion != "1.1") {
		raw += " httpVersion = ?,";
		rawBindings.push(ctx.body.config.httpVersion);
	}
	if (ctx.body.config.insecure) {
		raw += " insecure = 1,";
	}
	if (ctx.body.config.refererUrl) {
		raw += " refererUrl = ?,";
		rawBindings.push(
			encr(ctx.body.config.refererUrl, key)
		);
	}
	if (ctx.body.config.keepAliveDuration != 30) {
		raw += " keepAliveDuration = ?,";
		rawBindings.push(ctx.body.config.keepAliveDuration);
	}
	if (ctx.body.config.resolve) {
		raw += " resolve = ?,";
		rawBindings.push(
			encr(JSON.stringify(ctx.body.config.resolve), key)
		);
	}
	raw += " ipVersion = ?,";
	rawBindings.push(ctx.body.config.ipVersion);
	if (ctx.body.config.hsts) {
		if (isString(ctx.body.config.hsts)) {
			raw += " hsts = ?,";
			rawBindings.push(
				encr(JSON.stringify(ctx.body.config.hsts), key)
			);
		} else {
			raw += " hsts = 1,";
		}
	}
	if (!ctx.body.config.sessionId) {
		raw += " sessionId = 0,";
	}
	if (ctx.body.config.tlsMaxVersion) {
		raw += " tlsMaxVersion = ?,";
		rawBindings.push(ctx.body.config.tlsMaxVersion);
	}
	if (ctx.body.config.tlsVersion) {
		raw += " tlsVersion = ?,";
		rawBindings.push(ctx.body.config.tlsVersion);
	}
	if (ctx.body.config.haProxyClientIp) {
		raw += " haProxyClientIp = ?,";
		rawBindings.push(
			encr(ctx.body.config.haProxyClientIp, key)
		);
	}
	if (ctx.body.config.haProxyProtocol) {
		raw += " haProxyProtocol = 1,";
	}
	if (ctx.body.config.proxy) {
		raw += " proxy = ?,";
		rawBindings.push(
			encr(JSON.stringify(ctx.body.config.proxy), key)
		);
		if (ctx.body.config.proxyHttpVersion) {
			raw += " proxyHttpVersion = ?,";
			rawBindings.push(ctx.body.config.proxyHttpVersion);
		}
		if (ctx.body.config.proxyAuthBasic) {
			raw += " proxyAuthBasic = ?,";
			rawBindings.push(
				encr(JSON.stringify(ctx.body.config.proxyAuthBasic), key)
			);
		}
		if (ctx.body.config.proxyAuthDigest) {
			raw += " proxyAuthDigest = ?,";
			rawBindings.push(
				encr(JSON.stringify(ctx.body.config.proxyAuthDigest), key)
			);
		}
		if (ctx.body.config.proxyAuthNtlm) {
			raw += " proxyAuthNtlm = ?,";
			rawBindings.push(
				encr(JSON.stringify(ctx.body.config.proxyAuthNtlm), key)
			);
		}
		if (ctx.body.config.proxyHeaders) {
			raw += " proxyHeaders = ?,";
			rawBindings.push(
				encr(JSON.stringify(ctx.body.config.proxyHeaders), key)
			);
		}
		if (ctx.body.config.proxyInsecure) {
			raw += " proxyInsecure = 1,";
		}
	}
	raw = raw.substring(0, raw.length - 1);
	raw += " WHERE id = ? AND id IN (SELECT id FROM queue);";
	rawBindings.push(queueId);
	ctx.db.transaction(() => {
		ctx.db.run("INSERT INTO queue (id, subscriberId, createdAt, estimateExecutionAt) VALUES (?1, ?2, ?3, ?4);", [
			queueId,
			ctx.id,
			ctx.today,
			estimateExecutionAt
		]);
		ctx.db.run("INSERT INTO config (id, url) VALUES (?1, ?2);", [
			queueId,
			encr(ctx.body.httpRequest.url, key)
		]);
		ctx.db.run(raw, rawBindings);
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

function transformQueue(db: Database, rq: ResumeQueueQuery, beforeAt: number, terminated = false) {
	const transformAt = Date.now();
	const key = genKey(rq.id);
	const body = {
		httpRequest: {
			url: decr(rq.url, key),
			method: rq.method,
			data: !!rq.data
				? JSON.parse(decr(rq.data, key))
				: undefined,
			query: !!rq.query
				? JSON.parse(decr(rq.query, key))
				: undefined,
			cookie: !!rq.cookie
				? JSON.parse(decr(rq.cookie, key))
				: undefined,
			headers: !!rq.headers
				? JSON.parse(decr(rq.headers, key))
				: undefined,
			authBasic: !!rq.authBasic
				? JSON.parse(decr(rq.authBasic, key))
				: undefined,
			authDigest: !!rq.authDigest
				? JSON.parse(decr(rq.authDigest, key))
				: undefined,
			authNtlm: !!rq.authNtlm
				? JSON.parse(decr(rq.authNtlm, key))
				: undefined,
			authAwsSigv4: !!rq.authAwsSigv4
				? JSON.parse(decr(rq.authAwsSigv4, key))
				: undefined
		},
		config: {
			executionDelay: rq.executionDelay,
			executeAt: rq.executeAt,
			retry: rq.retry,
			retryAt: rq.retryAt,
			retryInterval: rq.retryInterval,
			retryStatusCode: JSON.parse(rq.retryStatusCode),
			retryExponential: !!rq.retryExponential,
			timeout: rq.timeout,
			timeoutAt: rq.timeoutAt,
			ca: !!rq.ca
				? JSON.parse(decr(rq.ca, key))
				: null,
			cert: !!rq.cert
				? JSON.parse(decr(rq.cert, key))
				: null,
			certType: !!rq.certType
				? decr(rq.certType, key)
				: null,
			certStatus: !!rq.certStatus,
			key: !!rq.key
				? decr(rq.key, key)
				: null,
			keyType: !!rq.keyType
				? decr(rq.keyType, key)
				: null,
			location: !!rq.location,
			locationTrusted: !!rq.locationTrusted
				? JSON.parse(decr(rq.locationTrusted, key))
				: null,
			proto: rq.proto,
			protoRedirect: rq.protoRedirect,
			dnsServer: !!rq.dnsServer
				? JSON.parse(decr(rq.dnsServer, key))
				: null,
			dohUrl: !!rq.dohUrl
				? decr(rq.dohUrl, key)
				: null,
			dohInsecure: !!rq.dohInsecure,
			httpVersion: rq.httpVersion,
			insecure: !!rq.insecure,
			refererUrl: !!rq.refererUrl
				? decr(rq.refererUrl, key)
				: null,
			redirectAttempts: rq.redirectAttempts,
			keepAliveDuration: rq.keepAliveDuration,
			resolve: !!rq.resolve
				? JSON.parse(decr(rq.resolve, key))
				: null,
			ipVersion: rq.ipVersion,
			hsts: !!rq.hsts
				? (rq.hsts == "1" || null)
				: !!rq.hsts && rq.hsts != "1"
					? JSON.parse(decr(rq.hsts, key))
					: null,
			sessionId: !!rq.sessionId,
			tlsVersion: rq.tlsVersion,
			tlsMaxVersion: rq.tlsMaxVersion,
			haProxyClientIp: !!rq.haProxyClientIp
				? decr(rq.haProxyClientIp, key)
				: null,
			haProxyProtocol: !!rq.haProxyProtocol,
			proxy: !!rq.proxy
				? JSON.parse(decr(rq.proxy, key))
				: null,
			proxyAuthBasic: !!rq.proxyAuthBasic
				? JSON.parse(decr(rq.proxyAuthBasic, key))
				: null,
			proxyAuthDigest: !!rq.proxyAuthDigest
				? JSON.parse(decr(rq.proxyAuthDigest, key))
				: null,
			proxyAuthNtlm: !!rq.proxyAuthNtlm
				? JSON.parse(decr(rq.proxyAuthNtlm, key))
				: null,
			proxyHeaders: !!rq.proxyAuthBasic
				? JSON.parse(decr(rq.proxyAuthBasic, key))
				: null,
			proxyHttpVersion: rq.proxyHttpVersion,
			proxyInsecure: !!rq.proxyInsecure
		}
	} as TaskSubscriberReq;
	if (rq.executeAt) {
		if (rq.retrying) {
			if (rq.retryAt == 0) {
				body.config.retry = rq.retryLimit - rq.retryCount;
			}
			const delay = Math.abs(
				differenceInMilliseconds(rq.estimateNextRetryAt, beforeAt)
			);
			body.config.executeAt = addMilliseconds(transformAt, delay).getTime();
		} else {
			const diffMs = Math.abs(
				differenceInMilliseconds(rq.estimateExecutionAt, beforeAt)
			);
			body.config.executeAt = addMilliseconds(transformAt, diffMs).getTime();
		}
	} else {
		if (rq.retrying) {
			if (rq.retryAt == 0) {
				body.config.retry = rq.retryLimit - rq.retryCount;
			}
			const delay = Math.abs(
				differenceInMilliseconds(rq.estimateNextRetryAt, beforeAt)
			);
			body.config.executionDelay = delay;
		} else {
			const diffMs = Math.abs(
				differenceInMilliseconds(rq.estimateExecutionAt, beforeAt)
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
			rq.id
		]);
	}
	return {
		subscriberId: rq.subscriberId,
		id: rq.id,
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