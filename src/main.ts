import { env, file } from "bun";

import { exit } from "node:process";

import { Elysia } from "elysia";
import { catchError, defer, forkJoin, of, switchMap, take } from "rxjs";
import { toSafeInteger } from "lodash";

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

connectivity().pipe(
	switchMap(() => forkJoin([
		defer(() => file(env.PATH_TLS_CERT!).text()).pipe(
			catchError(() => of(""))
		),
		defer(() => file(env.PATH_TLS_KEY!).text()).pipe(
			catchError(() => of(""))
		),
		defer(() => file(env.PATH_TLS_CA!).text()).pipe(
			catchError(() => of(""))
		)
	])),
	take(1)
)
.subscribe({
	next([cert, key, ca]) {
		console.log("\x1b[32mConnectivity ok!\x1b[0m");
		if (env.TZ != "UTC") {
			console.log("\x1b[33mTime zone is not using UTC. Make sure the UNIX time request has the same time zone as the server\x1b[0m");
		} else {
			console.log("\x1b[32mTimezone ok!\x1b[0m");
		}
		if (env.CIPHER_KEY == null) {
			console.error("Set the value of the CIPHER_KEY environment variable first");
			exit(1);
		}
		app.listen({
			maxRequestBodySize: toSafeInteger(env.MAX_SIZE_BODY_REQUEST),
			port: toSafeInteger(env.PORT) || 3200,
			cert: cert || undefined,
			key: key || undefined,
			ca: ca || undefined
		});
		if (app.server?.url.protocol == "https:") {
			console.log("Secure server listening on", app.server?.url.origin);
		} else {
			console.log("Server listening on", app.server?.url.origin);
		}
	},
	error(err) {
		console.error(err);
		exit(1);
	}
});