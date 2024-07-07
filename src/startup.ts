import { $, env, file } from "bun";

import { exit } from "node:process";

import { Elysia } from "elysia";
import { EMPTY, catchError, concat, defer, finalize, forkJoin, map, of, switchMap, tap, throwError } from "rxjs";

import { connectivity } from "./utils/connectivity";
import { setPragma } from "./db";
import { error, warn } from "./utils/logger";

export function startup(app: Elysia) {
	return concat(
		// Commands
		defer(() => $`tar --version`.text()).pipe(
			catchError(e => EMPTY.pipe(
				finalize(() => warn(`${String(e)}: "tar" command not found, "libtar.so" will be used automatically`))
			)),
			switchMap(() => EMPTY)
		),
		defer(() => $`curl -V`.text()).pipe(
			catchError(e => throwError(() => String(e)).pipe(
				finalize(() => {
					error(`${String(e)}: "curl" command not found, try installing curl`);
					exit(1);
				})
			)),
			switchMap(() => EMPTY)
		),
		// Database
		// @ts-ignore
		defer(() => file(app.decorator.db.filename).exists()).pipe(
			tap({
				next(v) {
					if (v) {
						// @ts-ignore
						setPragma(app.decorator.db);
					} else {
						error("Database not found");
						exit(1);
					}
				}
			}),
			switchMap(() => EMPTY)
		),
		// Internet connection
		connectivity().pipe(
			tap({
				error(e) {
					error(String(e));
					exit(1);
				}
			}),
			switchMap(() => EMPTY)
		),
		// Env variables
		forkJoin([of(env.TZ), of(env.CIPHER_KEY?.trim())]).pipe(
			tap({
				next([tz, ck]) {
					if (tz != "UTC") {
						error("Invalid value. Env variable \"TZ\" must be UTC");
						exit(1);
					}
					if (ck == "" || ck == null) {
						error("Invalid value. Env variable \"CIPHER_KEY\" is required");
						exit(1);
					}
				}
			}),
			switchMap(() => EMPTY)
		),
		// TLS/SSL
		forkJoin([
			defer(() => file(env.PATH_TLS_CERT!).text()).pipe(
				catchError(() => of(undefined))
			),
			defer(() => file(env.PATH_TLS_KEY!).text()).pipe(
				catchError(() => of(undefined))
			),
			defer(() => file(env.PATH_TLS_CA!).text()).pipe(
				catchError(() => of(undefined))
			)
		]).pipe(
			map(tls => {
				if (tls[0] && tls[1] == null) {
					tls[0] = undefined;
				}
				if (tls[1] && tls[0] == null) {
					tls[1] = undefined;
				}
				return tls;
			})
		)
	);
}