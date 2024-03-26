import { password } from "bun";

import { Elysia } from "elysia";

import { toString } from "lodash";

import { tasksDb } from "../db";

export function pluginAuth() {
	return new Elysia({ name: "pluginAuth" })
		.decorate("db", tasksDb())
		.derive({ as: "global" }, ctx => {
			const auth = ctx.headers["authorization"];
			return {
				id: toString(ctx.headers["x-tasks-subscriber-id"]).trim(),
				key: auth?.startsWith("Bearer ")
					? auth.slice(7).trim()
					: "",
				today: Date.now()
			};
		})
		.onBeforeHandle({ as: "global" }, async ctx => {
			if (ctx.id == "" || ctx.key == "") {
				return ctx.error("Unauthorized", {
					message: "The request did not include valid authentication"
				});
			}
			const q = ctx.db.query("SELECT key FROM subscriber WHERE subscriberId = ? LIMIT 1;");
			const value = q.get(ctx.id) as Pick<SubscriberContext, "key"> | null;
			q.finalize();
			if (value == null) {
				return ctx.error("Unauthorized", {
					message: "The request did not include valid authentication"
				});
			}
			const isValidKey = await password.verify(ctx.key, value.key, "argon2id");
			if (!isValidKey) {
				return ctx.error("Forbidden", {
					message: "The server did not accept valid authentication"
				});
			}
		});
}