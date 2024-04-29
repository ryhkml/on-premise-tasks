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

	interface TaskHttp {
		url: string;
		method?: HttpMethod;
		data?: string | {
			[key: string]: string | number;
		};
		query?: {
			[key: string]: string;
		};
		headers?: {
			[key: string]: string;
		};
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
		method: HttpMethod;
		/**
		 * ATTENTION
		 *
		 * `dataStringify` property must be decrypt first and then parse into an object
		 *
		 * @example JSON.parse(decr(dataStringify, env.CHIPER_KEY))
		*/
		dataStringify: string | null;
		/**
		 * ATTENTION
		 *
		 * `queryStringify` property must be decrypt first and then parse into an object
		 *
		 * @example JSON.parse(decr(queryStringify, env.CHIPER_KEY))
		*/
		queryStringify: string | null;
		/**
		 * ATTENTION
		 *
		 * `headersStringify` property must be decrypt first and then parse into an object
		 *
		 * @example JSON.parse(decr(headersStringify, env.CHIPER_KEY))
		*/
		headersStringify: string | null;
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
		 * `retryStatusCode` property must be parse first to be an array number data type
		 *
		 * @example JSON.parse(retryStatusCode)
		*/
		retryStatusCode: string;
		retryExponential: number;
		estimateNextRetryAt: number;
		timeout: number;
	}

	type FetchRes = {
		data: Buffer | null;
		state: Exclude<TaskState, "PAUSED" | "RUNNING">;
		status: number;
		statusText: string;
	}

	type SqliteBackupMethod = "LOCAL" | "GOOGLE_CLOUD_STORAGE";
}