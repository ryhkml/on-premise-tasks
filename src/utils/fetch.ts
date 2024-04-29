import { $, ShellPromise } from "bun";

import { TimeoutError, catchError, defer, map, throwError, timeout } from "rxjs";
import { isEmpty, isPlainObject, toSafeInteger, toString } from "lodash";

export function fetchHttp(req: TaskSubscriberReq, additionalHeaders?: { [k: string]: string }) {
	let sh: ShellPromise;
	const options = [] as Array<string>;
	if (req.httpRequest.headers && !isEmpty(req.httpRequest.headers)) {
		for (const [key, value] of Object.entries(req.httpRequest.headers)) {
			options.push(`-H "${key.toLowerCase()}:${value}"`);
		}
	}
	if (additionalHeaders && !isEmpty(additionalHeaders)) {
		for (const [key, value] of Object.entries(additionalHeaders)) {
			options.push(`-H "${key.toLowerCase()}:${value}"`);
		}
	}
	if (req.httpRequest.data && !isEmpty(req.httpRequest.data)) {
		if (isPlainObject(req.httpRequest.data)) {
			options.push(`-H "content-type: application/json"`);
			options.push(`-d "${JSON.stringify(req.httpRequest.data)}"`);
		} else {
			options.push(`-d "${req.httpRequest.data}"`);
		}
	}
	const isUaNotExists = !options.some(option => option.includes(`user-agent:`));
	if (isUaNotExists) {
		options.push(`-A "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (On-Premise Tasks)"`);
	}
	options.push(`--no-keepalive`);
	const url = !!req.httpRequest.query && !isEmpty(req.httpRequest.query)
		? req.httpRequest.url + "?" + new URLSearchParams(req.httpRequest.query).toString()
		: req.httpRequest.url;
	if (req.httpRequest.method == null) {
		sh = $`curl -sL --write-out "\n%{response_code}" --url "${url}" ${options.join(" ")}`;
	} else {
		sh = $`curl -sL -X ${req.httpRequest.method} --write-out "\n%{response_code}" --url "${url}" ${options.join(" ")}`;
	}
	return defer(() => sh.text()).pipe(
		map(text => {
			const res = text.split("\n").map(v => v.trim()).filter(v => !!v) as [string, string];
			const status = toSafeInteger(res[1]);
			const dataLen = Buffer.byteLength(res[0], "utf-8");
			const data = dataLen > 32768
				? Buffer.from("The response data size exceeds the limit")
				: Buffer.from(res[0]);
			if (status >= 400 && status <= 599) {
				throw {
					data,
					state: "ERROR",
					status,
					statusText: "Http error"
				};
			}
			return {
				data,
				state: "DONE",
				status,
				statusText: ""
			} as FetchRes;
		}),
		timeout({
			each: req.config.timeout
		}),
		catchError(error => {
			if (isPlainObject(error) && "data" in error && "status" in error) {
				return throwError(() => error);
			}
			if (error instanceof TimeoutError) {
				return throwError(() => ({
					data: Buffer.from(toString(error)),
					state: "ERROR",
					status: 408,
					statusText: "Timeout error"
				}));
			}
			return throwError(() => ({
				data: Buffer.from(toString(error)),
				state: "ERROR",
				status: 500,
				statusText: "Internal server error"
			}));
		})
	);
}