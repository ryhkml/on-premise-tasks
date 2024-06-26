import { password } from "bun";

import { Elysia } from "elysia";

import { toString } from "lodash";

import { stmtSubscriberKey } from "../db";

export function pluginAuth() {
	return new Elysia({ name: "pluginAuth" })
		.decorate("stmtSubscriberKey", stmtSubscriberKey())
		.derive({ as: "scoped" }, ctx => {
			const auth = ctx.headers["authorization"];
			return {
				id: toString(ctx.headers["x-tasks-subscriber-id"]).trim(),
				key: auth?.startsWith("Bearer ")
					? auth.slice(7).trim()
					: "",
				today: Date.now()
			};
		})
		.onBeforeHandle({ as: "scoped" }, async ctx => {
			const subscriber = ctx.stmtSubscriberKey.get(ctx.id);
			if (subscriber == null) {
				return ctx.error("Unauthorized", {
					message: "The request did not include valid authentication"
				});
			}
			const isInvalidKey = !(await password.verify(ctx.key, subscriber.key, "argon2id"));
			if (isInvalidKey) {
				return ctx.error("Forbidden", {
					message: "The server did not accept valid authentication"
				});
			}
		});
}