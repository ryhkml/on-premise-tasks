import { Observable, timeout } from "rxjs";

export function fetchHttp(req: TaskSubscriberReq, additionalHeaders?: { [k: string]: string }) {
	const source$ = new Observable<FetchRes>(observer => {
		let headers = {};
		if (req.httpRequest.headers) {
			headers = req.httpRequest.headers;
		}
		if (additionalHeaders) {
			if (req.httpRequest.headers) {
				headers = {
					...headers,
					...additionalHeaders
				};
			} else {
				headers = {
					...additionalHeaders
				};
			}
		}
		const query = !!req.httpRequest.query
			? "?" + new URLSearchParams(req.httpRequest.query).toString()
			: "";
		fetch(req.httpRequest.url + query, {
			method: req.httpRequest.method,
			cache: "no-cache",
			body: !!req.httpRequest.body
				? JSON.stringify(req.httpRequest.body)
				: undefined,
			headers: {
				...headers,
				"Cache-Control": "no-cache, no-store, must-revalidate",
				"Expires": "0",
				"User-Agent": "Op-Tasks/1.0.0"
			}
		})
		.then(async res => {
			try {
				const MAX_SIZE_DATA_RESPONSE = 32768;
				const text = await res.text();
				const len = Buffer.byteLength(text, "utf-8");
				if (res.ok) {
					observer.next({
						data: len > MAX_SIZE_DATA_RESPONSE
							? Buffer.from("The response data size exceeds the limit")
							: Buffer.from(text),
						state: "DONE",
						status: res.status,
						statusText: res.statusText || "Unknown"
					});
					observer.complete();
				} else {
					observer.error({
						data: len > MAX_SIZE_DATA_RESPONSE
							? Buffer.from("The response data size exceeds the limit")
							: Buffer.from(text),
						state: "ERROR",
						status: res.status,
						statusText: res.statusText || "Unknown"
					});
				}
			} catch (err) {
				observer.error(err);
			}
		})
		.catch(err => observer.error(err));
	});
	return source$.pipe(
		timeout({ each: req.config.timeout })
	);
}