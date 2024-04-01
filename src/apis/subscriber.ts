import { password } from "bun";
import { Database } from "bun:sqlite";

import { Elysia, t } from "elysia";
import { deburr } from "lodash";
import { monotonicFactory } from "ulid";

import { tasksDb } from "../db";
import { pluginAuth } from "../auth/auth";

export function subscriber() {
	return new Elysia({ prefix: "/subscribers" })
		.headers({
			"X-XSS-Protection": "0"
		})
		.guard({
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
		}, api => api
			.use(pluginAuth())
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
							default: 0
						}),
						tasksInQueue: t.Integer({
							default: 0
						}),
						tasksInQueueLimit: t.Integer({
							default: 1000
						})
					}),
					404: t.Object({
						message: t.Literal("Subscriber not found")
					})
				},
				type: "json"
			})
			.delete("/:name", ctx => {
				ctx.set.headers["Cache-Control"] = "no-cache, no-store, must-revalidate";
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
					422: t.Object({
						message: t.String()
					})
				},
				type: "json"
			})
		)
		.decorate("db", tasksDb())
		.derive({ as: "scoped" }, () => ({
			today: Date.now()
		}))
		.post("/register", async ctx => {
			const ulid = monotonicFactory();
			const id = ulid(ctx.today);
			const key = "t-" + Buffer.from(id + ":" + ctx.today).toString("base64");
			const secretKey = await password.hash(key, {
				algorithm: "argon2id",
				memoryCost: 4,
				timeCost: 3
			});
			addSubscriber(ctx.db, {
				subscriberId: id,
				subscriberName: ctx.body.name,
				createdAt: ctx.today,
				key: secretKey
			});
			ctx.set.headers["Cache-Control"] = "no-cache, no-store, must-revalidate";
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
				if (isSubscriberRegistered(ctx.db, ctx.body.name)) {
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
					key: t.Literal("t-" + t.String({
						contentEncoding: "base64"
					}))
				}),
				409: t.Object({
					message: t.String()
				})
			},
			type: "json"
		});
}

function isSubscriberRegistered(db: Database, name: string) {
	const q = db.query("SELECT EXISTS (SELECT 1 FROM subscriber WHERE subscriberName = ?) AS isRegistered;");
	const value = q.get(name) as { isRegistered: number };
	q.finalize();
	const isRegistered = !!value.isRegistered;
	return isRegistered;
};

function addSubscriber(db: Database, ctx: Omit<SubscriberContext, "id" | "tasksInQueue" | "tasksInQueueLimit">) {
	db.run("INSERT INTO subscriber (subscriberId, subscriberName, createdAt, key) VALUES (?1, ?2, ?3, ?4);", [
		ctx.subscriberId,
		ctx.subscriberName,
		ctx.createdAt,
		ctx.key
	]);
};

function getSubscriber(db: Database, id: string, name: string) {
	const q = db.query("SELECT subscriberId, subscriberName, createdAt, tasksInQueue, tasksInQueueLimit FROM subscriber WHERE subscriberId = ?1 AND subscriberName = ?2 LIMIT 1;");
	const value = q.get(id, name) as Omit<SubscriberContext, "id" | "key"> | null;
	q.finalize();
	if (value == null) {
		return null;
	}
	return value;
};

function deleteSubscriber(db: Database, id: string, name: string) {
	const q = db.query("SELECT tasksInQueue FROM subscriber WHERE subscriberId = ?1 AND subscriberName = ?2 AND tasksInQueue = 0 LIMIT 1;");
	const value = q.get(id, name) as Pick<SubscriberContext, "tasksInQueue"> | null;
	q.finalize();
	if (value == null) {
		return null;
	}
	db.run("DELETE FROM subscriber WHERE subscriberId = ?;", [id]);
	return "Done";
};