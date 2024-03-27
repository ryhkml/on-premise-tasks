import { Subscription } from "rxjs";

declare global {
	type SubscriberContext = {
		id: string;
		subscriberId: string;
		subscriberName: string;
		createdAt: number;
		key: string;
		tasksInQueue: number;
		tasksInQueueLimit: number;
	}

	type TaskHttp = {
		url: string;
		method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
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

	type TaskSubscriberRequest = {
		httpRequest: TaskHttp;
		config: TaskConfig;
	}

	type Queue = {
		id: string;
		state: string;
		statusCode: number;
		estimateEndAt: number;
		estimateExecutionAt: number;
	}

	type SafeQueue = {
		id: string;
		subscription: Subscription;
	}

	type Config = {
		configId: string;
		queueId: string;
		url: string;
		method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
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