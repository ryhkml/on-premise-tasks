import { spawn } from "bun";

import { Observable, TimeoutError, catchError, map, throwError, timeout } from "rxjs";
import { isArray, isPlainObject, toSafeInteger, toString } from "lodash";

export function http(req: TaskSubscriberReq, additionalHeaders?: { [k: string]: string }) {
	const options = ["-s", "-L", "-4"];
	// Method
	if (req.httpRequest.method) {
		options.push("-X");
		options.push(req.httpRequest.method);
	}
	// HTTP basic authentication
	if (req.httpRequest.authBasic) {
		const { user, password } = req.httpRequest.authBasic;
		options.push("-u");
		options.push(user + ":" + password);
		options.push("--basic");
	}
	// Headers
	if (req.httpRequest.headers) {
		for (const [key, value] of Object.entries(req.httpRequest.headers)) {
			options.push("-H");
			options.push(key.toLowerCase() + ": " + value);
		}
	}
	if (additionalHeaders) {
		for (const [key, value] of Object.entries(additionalHeaders)) {
			options.push("-H");
			options.push(key.toLowerCase() + ": " + value);
		}
	}
	// Data
	if (req.httpRequest.data) {
		if (isPlainObject(req.httpRequest.data)) {
			options.push("-H");
			options.push("content-type: application/json");
			options.push("-d");
			options.push(JSON.stringify(req.httpRequest.data));
		} else if (isArray(req.httpRequest.data)) {
			for (let i = 0; i < req.httpRequest.data.length; i++) {
				const { name, value } = req.httpRequest.data[i];
				options.push("--form-string");
				options.push(name + "=" + value);
			}
		} else {
			options.push("-H");
			options.push("content-type: plain/text");
			options.push("-d");
			options.push(req.httpRequest.data as string);
		}
	}
	// Cookie
	if (req.httpRequest.cookie) {
		for (let i = 0; i < req.httpRequest.cookie.length; i++) {
			const { name, value } = req.httpRequest.cookie[i];
			options.push("-b");
			options.push(name + "=" + value);
		}
	}
	// User-Agent
	const isUaNotExists = !options.some(option => option.includes(`user-agent:`));
	if (isUaNotExists) {
		options.push("-A");
		options.push("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (On-Premise Tasks)");
	}
	// DNS Server
	if (req.config.dnsServer) {
		options.push("--dns-servers");
		options.push(req.config.dnsServer.join(","));
	}
	// DOH URL
	if (req.config.dohUrl) {
		options.push("--doh-url");
		options.push(req.config.dohUrl);
	}
	// DOH Insecure
	if (req.config.dohInsecure) {
		options.push("--doh-insecure");
	}
	// HTTP Version
	if (req.config.httpVersion) {
		if (req.config.httpVersion == "0.9") {
			options.push("--http0.9");
		}
		if (req.config.httpVersion == "1.0") {
			options.push("--http1.0");
		}
		if (req.config.httpVersion == "1.1") {
			options.push("--http1.1");
		}
		if (req.config.httpVersion == "2") {
			options.push("--http2");
		}
	} else {
		options.push("--http1.1");
	}
	// Insecure
	if (req.config.insecure) {
		options.push("-k");
	}
	// Referer URL
	if (req.config.refererUrl) {
		if (req.config.refererUrl == "AUTO") {
			options.push("-e");
			options.push(";auto");
		} else {
			options.push("-e");
			options.push(req.config.refererUrl);
		}
	}
	// Max Redirect
	if (req.config.redirectAttempts) {
		options.push("--max-redirs");
		options.push(req.config.redirectAttempts.toString());
	} else {
		options.push("--max-redirs");
		options.push("8");
	}
	// Keep Alive Duration
	if (req.config.keepAliveDuration) {
		if (req.config.keepAliveDuration == 0) {
			options.push("--no-keepalive");
		} else {
			options.push("--keepalive-time");
			options.push(req.config.keepAliveDuration.toString());
		}
	} else {
		options.push("--keepalive-time");
		options.push("30");
	}
	// Resolve
	if (req.config.resolve) {
		const resolves = req.config.resolve.map(r => `${r.host}:${r.port.toString()}:${r.address.join(",")}`);
		for (let i = 0; i < resolves.length; i++) {
			const resolve = resolves[i];
			options.push("--resolve");
			options.push(resolve);
		}
	}
	// Proxy
	if (req.config.proxy) {
		if (req.config.proxyHttpVersion == "1.0") {
			options.push("--proxy1.0");
		} else {
			options.push("-x");
		}
		const { protocol, host, port } = req.config.proxy;
		if (port && req.config.proxyHttpVersion == "1.1") {
			options.push(protocol + "://" + host + ":" + port.toString());
		} else {
			options.push(protocol + "://" + host);
		}
		// Proxy auth basic
		if (req.config.proxyAuthBasic) {
			options.push("--proxy-basic");
			options.push("-U");
			const { user, password } = req.config.proxyAuthBasic;
			options.push(user + ":" + password);
		}
		// Proxy headers
		if (req.config.proxyHeaders) {
			for (const [key, value] of Object.entries(req.config.proxyHeaders)) {
				options.push("--proxy-header");
				options.push(key.toLowerCase() + ": " + value);
			}
		}
		// Proxy insecure
		if (req.config.proxyInsecure) {
			options.push("--proxy-insecure");
		}
	}
	const url = !!req.httpRequest.query
		? new URL(req.httpRequest.url + "?" + new URLSearchParams(req.httpRequest.query).toString()).toString()
		: new URL(req.httpRequest.url).toString();
	options.push("-w");
	options.push("&&SPLIT&&%{response_code}&&SPLIT&&%{size_download}&&SPLIT&&%{size_header}");
	options.push("--url");
	options.push(url);
	return curl(options).pipe(
		map(text => {
			const [payload, code, sizeData, sizeHeader] = text.split("&&SPLIT&&") as [string, string, string, string];
			const status = toSafeInteger(code);
			const sizes = toSafeInteger(sizeData) + toSafeInteger(sizeHeader);
			if (sizes > 32768) {
				throw {
					data: Buffer.from("The response size cannot be more than 32kb"),
					state: "ERROR",
					status: 500,
					statusText: "Response payload too large"
				};
			}
			if (status >= 400 && status <= 599) {
				throw {
					data: Buffer.from(payload),
					state: "ERROR",
					status,
					statusText: "Error 4xx-5xx"
				};
			}
			return {
				data: Buffer.from(payload),
				state: "DONE",
				status,
				statusText: "Ok"
			} as FetchRes;
		}),
		timeout({
			each: req.config.timeout
		}),
		catchError(error => {
			if (isPlainObject(error)) {
				if ("data" in error && "status" in error) {
					return throwError(() => error);
				}
				if ("info" in error) {
					return throwError(() => ({
						data: Buffer.from(toString(error.info.stderr)),
						state: "ERROR",
						status: 501,
						statusText: "Not implemented"
					}));
				}
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

function curl(options: Array<string>) {
	return new Observable<string>(observer => {
		const proc = spawn(["curl", ...options], { env: {} });
		new Response(proc.stdout).text()
			.then(text => {
				observer.next(text.trim());
				observer.complete();
			})
			.catch(error => observer.error(error));
	});
}