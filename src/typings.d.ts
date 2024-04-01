import { Subscription } from "rxjs";

declare global {

	type SafeAny = any;

	type SubscriberTable = {
		id: string;
		subscriberId: string;
		subscriberName: string;
		createdAt: number;
		key: string;
		tasksInQueue: number;
		tasksInQueueLimit: number;
	}

	type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

	type TaskHttp = {
		url: string;
		method: Method;
		body?: {
			[key: string]: string;
		};
		query?: {
			[key: string]: string;
		};
		headers?: {
			[key: string]: string;
		};
	}

	type TaskConfig = {
		executionDelay: number;
		executeAt: number;
		retry: number;
		retryAt: number;
		retryInterval: number;
		retryStatusCode: Array<number>;
		retryExponential: boolean;
		timeout: number;
	}

	type TaskSubscriberReq = {
		httpRequest: TaskHttp;
		config: TaskConfig;
	}

	type QueueTable = {
		id: string;
		subscriberId: string;
		state: string;
		statusCode: number;
		estimateEndAt: number;
		estimateExecutionAt: number;
	}

	type QueueSafe = {
		id: string;
		subscription: Subscription;
	}

	type ConfigTable = {
		id: string;
		configId: string;
		queueId: string;
		url: string;
		method: Method;
		bodyStringify: string | null;
		queryStringify: string | null;
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
		 * Parse => number[]
		*/
		retryStatusCode: string;
		retryExponential: number;
		estimateNextRetryAt: number;
		timeout: number;
	}
}