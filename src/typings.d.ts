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
		[k: string]: string | number;
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
	}

	interface TaskHttp {
		url: string;
		method?: HttpMethod;
		data?: PlainTextData | Array<MultipartFormData> | ApplicationJsonData;
		query?: ObjectStrData;
		cookie?: Array<Cookie>;
		headers?: ObjectStrData;
		authBasic?: AuthBasic;
	}

	type HttpVersion = "0.9" | "1.0" | "1.1" | "2";

	type ResolveProvider = {
		host: string;
		port: number;
		address: Array<string>;
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
		redirectAttempts: number;
		keepAliveDuration: number;
		resolve: Array<ResolveProvider> | null;
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
	}

	type FetchRes = {
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