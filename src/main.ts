import { env } from "bun";

import { exit } from "node:process";

import { Elysia } from "elysia";

import { subscriber } from "./apis/subscriber";
import { queue } from "./apis/queue";
import { connectivity } from "./utils/connectivity";

const app = new Elysia()
	.headers({
		"Permissions-Policy": "camera=(), microphone=(), interest-cohort=()",
		"Strict-Transport-Security": "max-age=31536000; includeSubDomains",
		"X-Content-Type-Options": "nosniff",
		"X-Frame-Options": "DENY",
		"X-XSS-Protection": "1; mode=block"
	})
	.onError(ctx => {
		if (ctx.code == "VALIDATION") {
			ctx.set.status = "Bad Request";
			return {
				message: ctx.error.validator.Errors(ctx.error.value).First()
			};
		}
		if (ctx.code == "NOT_FOUND") {
			return {
				message: "The request did not match any resource"
			};
		}
		console.error("ERROR HTTP EXCEPTION:", ctx.error.message);
		return ctx.error;
	})
	.use(subscriber())
	.use(queue());

connectivity().subscribe({
	next() {
		console.log("Connectivity ok!");
		if (env.TZ == "UTC") {
			console.log("Timezone ok!");
		} else {
			console.error("Set env variable \"TZ\" to UTC");
			exit(1);
		}
		app.listen(+env.PORT! || 3200);
		if (app.decorator.db.filename) {
			console.log("Database ok!");
		} else {
			console.error("Database is empty");
			exit(1);
		}
		console.log("Server listening on port", app.server?.port);
	},
	error(err) {
		console.error(err);
		exit(1);
	}
});