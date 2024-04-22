import { password } from "bun";
import { Database } from "bun:sqlite";

import { Elysia, t } from "elysia";
import { deburr } from "lodash";
import { monotonicFactory } from "ulid";
import { customAlphabet } from "nanoid";

import { stmtSubscriberRegistered, tasksDb } from "../db";
import { pluginAuth } from "../plugins/auth";
import { pluginContentLength } from "../plugins/content-length";

export function subscriber() {
	return new Elysia({ prefix: "/subscribers" })
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
			subscriberName: t.Object({
				name: t.String({
					default: null,
					pattern: "^(?![0-9-])(?!.*--)[a-z0-9-]{5,32}(?<!-)$"
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
		.decorate("db", tasksDb())
		.guard({ headers: "authHeaders", params: "subscriberName" }, app => {
			return app
				.use(pluginAuth())
				// Get subscriber
				.get("/:name", ctx => {
					const subscriber = getSubscriber(ctx.db, ctx.id, ctx.params.name);
					if (subscriber == null) {
						return ctx.error("Not Found", {
							message: "Subscriber not found"
						});
					}
					return subscriber;
				}, {
					response: {
						200: t.Object({
							id: t.String(),
							name: t.String(),
							createdAt: t.Integer(),
							tasksInQueue: t.Integer(),
							tasksInQueueLimit: t.Integer()
						}),
						404: t.Object({
							message: t.String()
						})
					},
					type: "json"
				})
				// Delete subscriber
				.delete("/:name", ctx => {
					const isDeleted = deleteSubscriber(ctx.db, ctx.id, ctx.params.name);
					if (isDeleted == null) {
						return ctx.error("Unprocessable Content", {
							message: "The request did not meet one of it's preconditions"
						});
					}
					ctx.set.status = "OK";
					return {
						message: "Done"
					};
				}, {
					response: {
						200: t.Object({
							message: t.Literal("Done")
						}),
						422: t.Object({
							message: t.String()
						})
					},
					type: "json"
				});
		})
		.decorate("stmtSubscriberRegistered", stmtSubscriberRegistered())
		.derive({ as: "local" }, () => ({
			today: Date.now()
		}))
		.post("/register", async ctx => {
			const ulid = monotonicFactory();
			const id = ulid(ctx.today);
			const key = genKey();
			const secretKey = await password.hash(key, {
				algorithm: "argon2id",
				memoryCost: 4,
				timeCost: 3
			});
			const subscriber = addSubscriber(ctx.db, {
				id,
				key: secretKey,
				name: ctx.body.name,
				createdAt: ctx.today
			});
			if (subscriber == null) {
				return ctx.error("Internal Server Error", {
					message: "There was an error"
				});
			}
			ctx.set.status = "Created";
			return {
				id,
				key
			};
		}, {
			transform(ctx) {
				ctx.body.name = deburr(ctx.body.name).toLowerCase().trim();
			},
			beforeHandle(ctx) {
				const isSubscriberRegistered = !!ctx.stmtSubscriberRegistered.get(ctx.body.name)?.isRegistered;
				if (isSubscriberRegistered) {
					return ctx.error("Conflict", {
						message: "Subscriber has already registered"
					});
				}
			},
			body: "subscriberName",
			response: {
				201: t.Object({
					id: t.String(),
					key: t.String()
				}),
				409: t.Object({
					message: t.String()
				})
			},
			type: "json"
		});
}

function addSubscriber(db: Database, ctx: Omit<SubscriberTable, "tasksInQueue" | "tasksInQueueLimit">) {
	const q = db.query<{ id: string }, [string, string, string, number]>("INSERT INTO subscriber (id, key, name, createdAt) VALUES (?1, ?2, ?3, ?4) RETURNING id;");
	const subscriber = q.get(ctx.id, ctx.key, ctx.name, ctx.createdAt);
	q.finalize();
	if (subscriber == null) {
		return null;
	}
	return subscriber.id;
};

type SubscriberQuery = Omit<SubscriberTable, "key">;

function getSubscriber(db: Database, id: string, name: string) {
	const q = db.query<SubscriberQuery, [string, string]>("SELECT id, name, createdAt, tasksInQueue, tasksInQueueLimit FROM subscriber WHERE id = ?1 AND name = ?2;");
	const subscriber = q.get(id, name);
	q.finalize();
	if (subscriber == null) {
		return null;
	}
	return subscriber;
};

function deleteSubscriber(db: Database, id: string, name: string) {
	const q = db.query<{ deleted: "Done" }, [string, string]>("DELETE FROM subscriber WHERE id = ?1 AND name = ?2 AND tasksInQueue = 0 RETURNING 'Done' AS deleted;");
	const subscriber = q.get(id, name);
	q.finalize();
	if (subscriber == null) {
		return null;
	}
	return subscriber.deleted;
};

function genKey() {
	const key = customAlphabet("0123456789abcdefghijklmnopqrsuvwxyzABCDEFGHIJKLMNOPQRSUVWXYZ", 48);
	return "t-" + key();
}