import { $, env, file } from "bun";

import { exit } from "node:process";

import { Elysia } from "elysia";
import { EMPTY, catchError, concat, defer, forkJoin, of, switchMap, tap } from "rxjs";
import { toString } from "lodash";

import { connectivity } from "./utils/connectivity";
import { setPragma } from "./db";

export function startup(app: Elysia) {
	return concat(
		// Commands
		defer(() => $`tar --version`.text()).pipe(
			tap({
				error(e) {
					console.warn(toString(e));
				}
			}),
			switchMap(() => EMPTY)
		),
		defer(() => $`curl -V`.text()).pipe(
			tap({
				error(e) {
					console.error(toString(e));
					exit(1);
				}
			}),
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
						console.error("Database not found");
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
					console.error(e);
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
						console.error("Invalid value. Env variable \"TZ\" must be UTC");
						exit(1);
					}
					if (ck == "" || ck == null) {
						console.error("Invalid value. Env variable \"CIPHER_KEY\" is required");
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
		])
	);
}