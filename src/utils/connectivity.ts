import { env } from "bun";

import { resolve } from "node:dns";

import { Observable, TimeoutError, catchError, throwError, timeout } from "rxjs";
import { toString } from "lodash";

export function connectivity() {
	const source$ = new Observable<string>(observer => {
		const hostname = env.CONNECTIVITY_HOSTNAME || "google.com";
		resolve(hostname, err => {
			if (err) {
				observer.error(toString(err));
			} else {
				observer.next("Online");
				observer.complete();
			}
		});
	});
	return source$.pipe(
		timeout({ each: 30000 }),
		catchError(err => {
			if (err instanceof TimeoutError) {
				return throwError(() => "Make sure the server is connected to the internet");
			}
			return throwError(() => err);
		})
	);
}