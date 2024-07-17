import { Subscription } from "rxjs";

declare global {

	type SafeAny = any;

	type SubscriberTable = {
		id: string;
		name: string;
		createdAt: number;
		key: string;
		tasksInQueue: number;
		tasksInQueueLimit: number;
	}

	type HttpMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

	type PlainTextData = string;

	type MultipartFormData = {
		name: string;
		value: string;
	}

	type ApplicationJsonData = {
		[k: string]: SafeAny;
	}

	type ObjectStrData = {
		[k: string]: string;
	}

	type Cookie = {
		name: string;
		value: string;
	}

	type AuthBasic = {
		user: string;
		password: string;
	};

	type AuthAwsSigv4 = {
		provider1: string;
		provider2: string;
		region: string;
		service: string;
		key: string;
		secret: string;
	}

	interface TaskHttp {
		url: string;
		method?: HttpMethod;
		data?: PlainTextData | Array<MultipartFormData> | ApplicationJsonData;
		query?: ObjectStrData;
		cookie?: Array<Cookie>;
		headers?: ObjectStrData;
		authBasic?: AuthBasic;
		authDigest?: AuthBasic;
		authNtlm?: AuthBasic;
		authAwsSigv4?: AuthAwsSigv4;
	}

	type HttpVersion = "0.9" | "1.0" | "1.1" | "2" | "2-prior-knowledge";

	type TlsVersion = "1.0" | "1.1" | "1.2" | "1.3";

	type ResolveProvider = {
		host: string;
		port: number;
		address: Array<string>;
	}

	type ProxyProvider = {
		protocol: "http" | "https";
		host: string;
		port?: number;
	}

	interface TaskConfig {
		executionDelay: number;
		executeAt: number;
		retry: number;
		retryAt: number;
		retryInterval: number;
		retryStatusCode: Array<number>;
		retryExponential: boolean;
		timeout: number;
		timeoutAt: number;
		// CA
		ca: string[] | null,
		// Redirections
		location: boolean;
		locationTrusted: AuthBasic | null;
		proto: "http" | "https" | null;
		protoRedirect: "http" | "https" | null;
		redirectAttempts: number;
		// DNS
		dnsServer: Array<string> | null;
		dohUrl: string | null;
		/**
		 * WARNING
		 *
		 * Using this option makes the transfer insecure, but used for DoH (DNS-over-HTTPS)
		 *
		 * @default false
		*/
		dohInsecure: boolean;
		httpVersion: HttpVersion;
		/**
		 * WARNING
		 *
		 * Using this option makes the transfer insecure
		 *
		 * @default false
		*/
		insecure: boolean;
		refererUrl: string | "AUTO" | null;
		keepAliveDuration: number;
		resolve: Array<ResolveProvider> | null;
		ipVersion: 4 | 6;
		hsts: string | boolean | null;
		sessionId: boolean;
		tlsVersion: TlsVersion | null;
		tlsMaxVersion: TlsVersion | null;
		// HaProxy
		haProxyClientIp: string | null;
		haProxyProtocol: boolean | null;
		// Proxy
		proxy: ProxyProvider | null;
		proxyAuthBasic: AuthBasic | null;
		proxyAuthDigest: AuthBasic | null;
		proxyAuthNtlm: AuthBasic | null;
		proxyHeaders: ObjectStrData | null;
		proxyHttpVersion: Exclude<HttpVersion, "0.9" | "2" | "2-prior-knowledge"> | null;
		/**
		 * WARNING
		 *
		 * Using this option makes the transfer to the proxy insecure
		 *
		 * @default false
		*/
		proxyInsecure: boolean;
	}

	type TaskState = "DONE" | "ERROR" | "PAUSED" | "RUNNING";

	interface TaskSubscriberReq {
		httpRequest: TaskHttp;
		config: TaskConfig;
	}

	type QueueTable = {
		id: string;
		subscriberId: string;
		state: TaskState;
		statusCode: number;
		finalize: Uint8Array | null;
		createdAt: number;
		expiredAt: number;
		estimateEndAt: number;
		estimateExecutionAt: number;
	}

	type QueueSafe = {
		id: string;
		subscription: Subscription;
	}

	type ConfigTable = {
		id: string;
		/**
		 * ATTENTION
		 *
		 * `url` property must be decrypt first to become readable plain url
		 *
		 * @example decr(url, env.CHIPER_KEY)
		*/
		url: string;
		method: HttpMethod | null;
		/**
		 * ATTENTION
		 *
		 * `data` property must be decrypt first and then parse into an object
		 *
		 * @example JSON.parse(decr(data, env.CHIPER_KEY))
		*/
		data: string | null;
		/**
		 * ATTENTION
		 *
		 * `queryStringify` property must be decrypt first and then parse into an object
		 *
		 * @example JSON.parse(decr(queryStringify, env.CHIPER_KEY))
		*/
		query: string | null;
		/**
		 * ATTENTION
		 *
		 * `cookie` property must be decrypt first to become readable plain text
		*/
		cookie: string | null;
		/**
		 * ATTENTION
		 *
		 * `headersStringify` property must be decrypt first and then parse into an object
		 *
		 * @example JSON.parse(decr(headersStringify, env.CHIPER_KEY))
		*/
		headers: string | null;
		/**
		 * ATTENTION
		 *
		 * `authBasic` property must be decrypt first and then parse into an object
		*/
		authBasic: string | null;
		/**
		 * ATTENTION
		 *
		 * `authDigest` property must be decrypt first and then parse into an object
		*/
		authDigest: string | null;
		/**
		 * ATTENTION
		 *
		 * `authNtlm` property must be decrypt first and then parse into an object
		*/
		authNtlm: string | null;
		/**
		 * ATTENTION
		 *
		 * `authAwsSigv4` property must be decrypt first and then parse into an object
		*/
		authAwsSigv4: string | null;
		// 
		executionDelay: number;
		executeAt: number;
		retry: number;
		retryAt: number;
		retrying: number;
		retryCount: number;
		retryLimit: number;
		retryInterval: number;
		/**
		 * ATTENTION
		 *
		 * `retryStatusCode` property must be parse first to be an array number
		 *
		 * @example JSON.parse(retryStatusCode)
		*/
		retryStatusCode: string;
		retryExponential: number;
		estimateNextRetryAt: number;
		timeout: number;
		timeoutAt: number;
		// 
		ca: string | null;
		// 
		location: number | null;
		locationTrusted: string | null;
		proto: string | null;
		protoRedirect: string | null;
		/**
		 * ATTENTION
		 *
		 * `dnsServer` property must be decrypt first and then parse into an array string
		*/
		dnsServer: string | null;
		/**
		 * ATTENTION
		 *
		 * `dohUrl` property must be decrypt first to become readable plain url
		*/
		dohUrl: string | null;
		dohInsecure: number;
		httpVersion: HttpVersion;
		/**
		 * ATTENTION
		 *
		 * `refererUrl` property must be decrypt first to become readable plain url
		*/
		insecure: number;
		refererUrl: string | null;
		redirectAttempts: number;
		keepAliveDuration: number;
		/**
		 * ATTENTION
		 *
		 * `resolve` property must be decrypt first and then parse into an array string
		*/
		resolve: string | null;
		ipVersion: number;
		hsts: string | null;
		sessionId: number;
		tlsVersion: string | null;
		tlsMaxVersion: string | null;
		// 
		haProxyClientIp: string | null;
		haProxyProtocol: number | null;
		//
		proxy: string | null;
		proxyAuthBasic: string | null;
		proxyAuthDigest: string | null;
		proxyAuthNtlm: string | null;
		proxyHeaders: string | null;
		proxyHttpVersion: string | null;
		proxyInsecure: number | null;
	}

	type FetchRes = {
		/**
		 * This id is an http response identifier. Not a queue id
		*/
		id: string;
		data: Buffer | null;
		state: Exclude<TaskState, "PAUSED" | "RUNNING">;
		status: number;
		statusText: string;
	}

	type SqliteBackupMethod = "LOCAL" | "GOOGLE_CLOUD_STORAGE";

	type FetchTestRes = {
		res: {
			cookie: string | null;
			data: {
				payload: {
					[k: string]: Uint8Array | ApplicationJsonData;
				};
				type: string;
			},
			query: {
				payload: ObjectStrData;
				type: string;
			},
			headers: {
				payload: ObjectStrData;
			};
			method: HttpMethod;
			path: string;
			protocol: string;
		}
	}
}