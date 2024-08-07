import { readableStreamToText, spawn, write } from "bun";

import { randomBytes } from "node:crypto";

import { TimeoutError, catchError, defer, map, throwError, timeout } from "rxjs";
import { isArray, isPlainObject, isString, toSafeInteger, toString } from "lodash";

export function http(req: TaskSubscriberReq, additionalHeaders?: { [k: string]: string }) {
	const id = randomBytes(32).toString("hex");
	const options = ["-s"];
	// Method
	if (req.httpRequest.method) {
		options.push("-X");
		options.push(req.httpRequest.method);
	}
	// IP. Use IP addresses only when resolving hostnames
	options.push("-" + req.config.ipVersion.toString());
	// Proto. By default, proto only enables http and https
	if (req.config.proto) {
		options.push("--proto");
		options.push("=" + req.config.proto);
	} else {
		options.push("--proto");
		options.push("-all,http,https");
	}
	// CA
	if (req.config.ca) {
		if (req.config.ca.length == 1) {
			const dataCa = Buffer.from(req.config.ca[0], "base64").toString("utf-8");
			const pathCa = "/tmp/" + id + "/ca/ca.crt";
			write(pathCa, dataCa, { mode: 440 });
			options.push("--cacert");
			options.push(pathCa);
		} else {
			for (let i = 0; i < req.config.ca.length; i++) {
				const name = "ca-" + (i + 1).toString() + ".crt";
				const dataCa = Buffer.from(req.config.ca[i], "base64").toString("utf-8");
				const pathCa = "/tmp/" + id + "/cas/" + name;
				write(pathCa, dataCa, { mode: 440 });
			}
			options.push("--capath");
			options.push("/tmp/" + id + "/cas");
		}
	}
	// Cert
	if (req.config.cert?.value) {
		const type = req.config.certType?.toLowerCase() || "pem";
		const dataCert = Buffer.from(req.config.cert.value, "base64").toString("utf-8");
		const pathCert = "/tmp/" + id + "/cert/cert." + type;
		write(pathCert, dataCert, { mode: 440 });
		if (req.config.certType) {
			options.push("--cert-type");
			options.push(req.config.certType);
		}
		options.push("--cert");
		if (req.config.cert.password) {
			const password = req.config.cert.password
				.replace(/:/g, "\\:")
				.replace(/"/g, '\\"');
			options.push(pathCert + ":" + password);
		} else {
			options.push(pathCert);
		}
	}
	if (req.config.certStatus) {
		options.push("--cert-status");
	}
	// Key
	if (req.config.key) {
		const type = req.config.keyType?.toLowerCase() || "pem";
		const dataKey = Buffer.from(req.config.key, "base64").toString("utf-8");
		const pathKey = "/tmp/" + id + "/cert/key." + type;
		write(pathKey, dataKey, { mode: 440 });
		if (req.config.keyType) {
			options.push("--key-type");
			options.push(req.config.keyType);
		}
		options.push("--key");
		options.push(pathKey);
	}
	// Location
	if (req.config.location) {
		options.push("-L");
		// Max Redirect
		if (req.config.redirectAttempts) {
			options.push("--max-redirs");
			options.push(req.config.redirectAttempts.toString());
		} else {
			options.push("--max-redirs");
			options.push("8");
		}
		// Proto redirect. By default, proto redirect only enables http and https
		if (req.config.protoRedirect) {
			options.push("--proto-redir");
			options.push("=" + req.config.protoRedirect);
		} else {
			options.push("--proto-redir");
			options.push("-all,http,https");
		}
		// Location trusted
		if (req.config.locationTrusted) {
			const { user, password } = req.config.locationTrusted;
			options.push("--location-trusted");
			options.push("-u");
			options.push(user + ":" + password);
		}
	}
	// TLS version
	if (req.config.tlsMaxVersion) {
		if (req.config.tlsMaxVersion == "1.0") {
			options.push("--tls-max");
			options.push("1.0");
		} else if (req.config.tlsMaxVersion == "1.1") {
			options.push("--tls-max");
			options.push("1.1");
		} else if (req.config.tlsMaxVersion == "1.2") {
			options.push("--tls-max");
			options.push("1.2");
		} else if (req.config.tlsMaxVersion == "1.3") {
			options.push("--tls-max");
			options.push("1.3");
		}
	}
	if (req.config.tlsVersion) {
		if (req.config.tlsVersion == "1.0") {
			options.push("--tlsv1.0");
		} else if (req.config.tlsVersion == "1.1") {
			options.push("--tlsv1.1");
		} else if (req.config.tlsVersion == "1.2") {
			options.push("--tlsv1.2");
		} else if (req.config.tlsVersion == "1.3") {
			options.push("--tlsv1.3");
		}
	}
	// HTTP basic authentication
	if (req.httpRequest.authBasic) {
		const { user, password } = req.httpRequest.authBasic;
		options.push("-u");
		options.push(user + ":" + password);
		options.push("--basic");
	}
	// HTTP digest authentication
	if (req.httpRequest.authDigest) {
		const { user, password } = req.httpRequest.authDigest;
		options.push("-u");
		options.push(user + ":" + password);
		options.push("--digest");
	}
	// HTTP NTLM authentication
	if (req.httpRequest.authNtlm) {
		const { user, password } = req.httpRequest.authNtlm;
		options.push("-u");
		options.push(user + ":" + password);
		options.push("--ntlm");
	}
	// HTTP AWS V4 signature authentication
	if (req.httpRequest.authAwsSigv4) {
		const { provider1, provider2, region, service, key, secret } = req.httpRequest.authAwsSigv4;
		options.push("--aws-sigv4");
		options.push(provider1 + ":" + provider2 + ":" + region + ":" + service);
		options.push("--user");
		options.push(key + ":" + secret);
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
			const escapeJsonStr = JSON.stringify(req.httpRequest.data)
				.replace(/\\n/g, "\\n")
				.replace(/\\'/g, "\\'")
				.replace(/\\"/g, '\\"')
				.replace(/\\&/g, "\\&")
				.replace(/\\r/g, "\\r")
				.replace(/\\t/g, "\\t")
				.replace(/\\b/g, "\\b")
				.replace(/\\f/g, "\\f")
				.trim();
			options.push(escapeJsonStr);
		} else if (isArray(req.httpRequest.data)) {
			for (let i = 0; i < req.httpRequest.data.length; i++) {
				const { name, value } = req.httpRequest.data[i];
				options.push("--form-string");
				options.push(name.trim() + "=" + value.trim());
			}
		} else {
			options.push("-H");
			options.push("content-type: plain/text");
			options.push("-d");
			options.push(toString(req.httpRequest.data).trim());
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
		if (req.config.httpVersion == "2-prior-knowledge") {
			options.push("--http2-prior-knowledge");
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
	// HSTS
	if (req.config.hsts) {
		options.push("--hsts");
		if (isString(req.config.hsts)) {
			const dataHsts = Buffer.from(req.config.hsts, "base64").toString("utf-8");
			const pathHsts = "/tmp/" + id + "/hsts/hsts.txt";
			write(pathHsts, dataHsts, { mode: 440 });
			options.push(pathHsts);
		} else {
			options.push("/dev/null");
		}
	}
	// Session id
	if (!req.config.sessionId) {
		options.push("--no-sessionid");
	}
	// HaProxy
	if (req.config.haProxyClientIp) {
		options.push("--haproxy-clientip");
		options.push(req.config.haProxyClientIp);
	}
	if (req.config.haProxyProtocol) {
		options.push("--haproxy-protocol");
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
		// Proxy auth digest
		if (req.config.proxyAuthDigest) {
			options.push("--proxy-digest");
			options.push("-U");
			const { user, password } = req.config.proxyAuthDigest;
			options.push(user + ":" + password);
		}
		// Proxy auth digest
		if (req.config.proxyAuthNtlm) {
			options.push("--proxy-ntlm");
			options.push("-U");
			const { user, password } = req.config.proxyAuthNtlm;
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
	return defer(() => curl(options)).pipe(
		map(text => {
			const [payload, code, sizeData, sizeHeader] = text.split("&&SPLIT&&") as [string, string, string, string];
			const status = toSafeInteger(code);
			const sizes = toSafeInteger(sizeData) + toSafeInteger(sizeHeader);
			if (sizes > 32768) {
				throw {
					id,
					data: Buffer.from("The response size cannot be more than 32kb"),
					state: "ERROR",
					status: 500,
					statusText: "Response payload too large"
				};
			}
			if (status >= 400 && status <= 599) {
				throw {
					id,
					data: Buffer.from(payload),
					state: "ERROR",
					status,
					statusText: "Error 4xx-5xx"
				};
			}
			return {
				id,
				data: Buffer.from(payload),
				state: "DONE",
				status,
				statusText: "Ok"
			} as FetchRes;
		}),
		timeout({
			first: !!req.config.timeoutAt
				? new Date(req.config.timeoutAt)
				: undefined,
			each: req.config.timeout
		}),
		catchError(error => {
			if (isPlainObject(error)) {
				if ("data" in error && "status" in error) {
					return throwError(() => error);
				}
				if ("info" in error) {
					return throwError(() => ({
						id,
						data: Buffer.from(toString(error.info.stderr)),
						state: "ERROR",
						status: 501,
						statusText: "Not implemented"
					}));
				}
			}
			if (error instanceof TimeoutError) {
				return throwError(() => ({
					id,
					data: Buffer.from(toString(error)),
					state: "ERROR",
					status: 408,
					statusText: "Timeout error"
				}));
			}
			return throwError(() => ({
				id,
				data: Buffer.from(toString(error)),
				state: "ERROR",
				status: 500,
				statusText: "Internal server error"
			}));
		})
	);
}

function curl(options: Array<string>) {
	const proc = spawn(["curl", ...options], { env: {} });
	return readableStreamToText(proc.stdout);
}

export const DEFAULT_CONFIG: TaskConfig = {
	executionDelay: 1,
	executeAt: 0,
	retry: 0,
	retryAt: 0,
	retryInterval: 0,
	retryStatusCode: [] as Array<number>,
	retryExponential: true,
	timeout: 30000,
	timeoutAt: 0,
	ca: null,
	cert: null,
	certType: null,
	certStatus: null,
	key: null,
	keyType: null,
	location: false,
	locationTrusted: null,
	proto: null,
	protoRedirect: null,
	dnsServer: null,
	dohInsecure: false,
	dohUrl: null,
	httpVersion: "1.1",
	insecure: false,
	keepAliveDuration: 30,
	redirectAttempts: 8,
	refererUrl: null,
	resolve: null,
	ipVersion: 4,
	hsts: null,
	sessionId: true,
	tlsVersion: null,
	tlsMaxVersion: null,
	haProxyClientIp: null,
	haProxyProtocol: null,
	proxy: null,
	proxyAuthBasic: null,
	proxyAuthDigest: null,
	proxyAuthNtlm: null,
	proxyHeaders: null,
	proxyHttpVersion: null,
	proxyInsecure: false
};