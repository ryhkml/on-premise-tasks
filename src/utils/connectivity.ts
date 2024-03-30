import { env } from "bun";

import { lookup } from "node:dns";

import { Observable, timeout } from "rxjs";
import { toString } from "lodash";

export function connectivity() {
	const source$ = new Observable<string>(observer => {
		const hostname = env.CONNECTIVITY_HOSTNAME || "8.8.8.8";
		lookup(hostname, (err, _) => {
			if (err) {
				observer.error(toString(err));
			} else {
				observer.next("Online");
				observer.complete();
			}
		});
	});
	return source$.pipe(
		timeout({ each: 30000 })
	);
}