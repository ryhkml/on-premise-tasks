import { env, Serve } from "bun";

import { Elysia } from "elysia";
import { cron, Patterns } from "@elysiajs/cron";
import { lastValueFrom } from "rxjs";
import { toSafeInteger } from "lodash";

import { subscriber } from "./apis/subscriber";
import { queue } from "./apis/queue";
import { backupDb } from "./utils/backup";
import { startup } from "./startup";
import { error, info } from "./utils/logger";

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
				message: "A request includes an invalid credential or value"
			};
		}
		if (ctx.code == "NOT_FOUND") {
			return new Response(null, {
				status: 404,
				headers: {
					"Permissions-Policy": "camera=(), microphone=(), interest-cohort=()",
					"Strict-Transport-Security": "max-age=31536000; includeSubDomains",
					"X-Content-Type-Options": "nosniff",
					"X-Frame-Options": "DENY",
					"X-XSS-Protection": "1; mode=block"
				}
			});
		}
		error(ctx.error.message);
		return ctx.error;
	})
	.use(subscriber())
	.use(queue())
	.use(cron({
		name: "backupDatabase",
		pattern: env.BACKUP_CRON_PATTERN_SQLITE || Patterns.EVERY_DAY_AT_MIDNIGHT,
		protect: true,
		timezone: env.BACKUP_CRON_TZ_SQLITE || env.TZ,
		run() {
			backupDb(env.BACKUP_METHOD_SQLITE as SqliteBackupMethod);
		}
	}));

const [cert, key, ca] = await lastValueFrom(
	// @ts-ignore
	startup(app)
);

const options: Partial<Serve> = {
	maxRequestBodySize: toSafeInteger(env.MAX_SIZE_BODY_REQUEST) || 32768,
	port: toSafeInteger(env.PORT) || 3200,
	cert,
	key,
	ca
};

app.listen(options, server => info(`Server listening on ${server.url.origin}`));