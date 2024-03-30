import { env } from "bun";

import { exit } from "node:process";

import { Elysia } from "elysia";

import { toString } from "lodash";

import { subscriber } from "./apis/subscriber";
import { queue } from "./apis/queue";
import { connectivity } from "./utils/connectivity";

new Elysia()
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
	.use(queue())
	.onStart(ctx => {
		connectivity().subscribe({
			next() {
				try {
					console.log("Connectivity ok");
					ctx.decorator.db.exec("PRAGMA journal_mode = WAL;");
					ctx.decorator.db.exec("PRAGMA foreign_keys = ON;");
					console.log("Database ok");
					console.log("Server listening on port", ctx.server?.port);
				} catch (e) {
					console.error("ERROR DATABASE:", toString(e));
					exit(1);
				}
			},
			error(err) {
				console.error(err);
				exit(1);
			}
		})
	})
	.listen(+env.PORT! || 3200);