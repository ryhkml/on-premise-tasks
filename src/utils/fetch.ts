import { Agent as HttpAgent } from "node:http";
import { Agent as HttpsAgent } from "node:https";

import { defer } from "rxjs";

import axios from "axios";

export function fetch(req: TaskSubscriberRequest, additionalHeaders?: { [k: string]: string }) {
	return defer(() => {
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
		const query = req.httpRequest.query
			? "?" + new URLSearchParams(req.httpRequest.query).toString()
			: "";
		return axios({
			maxRedirects: 8,
			adapter: "http",
			timeout: req.config.timeout,
			method: req.httpRequest.method,
			data: req.httpRequest.body,
			url: req.httpRequest.url + query,
			headers: {
				...headers,
				"Cache-Control": "no-cache, no-store, must-revalidate",
				"User-Agent": "Op-Tasks/1.0.0"
			},
			httpAgent: new HttpAgent({
				keepAlive: true
			}),
			httpsAgent: new HttpsAgent({
				keepAlive: true
			})
		});
	});
}