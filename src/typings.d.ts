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

	type TaskResponseType = "TEXT" | "JSON";

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
		retryExponential: boolean;
		timeout: number;
	}

	type TaskSubscriberRequest = {
		httpRequest: TaskHttp;
		config: TaskConfig;
	}

	type Queue = {
		queueId: string;
		state: string;
		statusCode: number;
		estimateEndAt: number;
		estimateExecutionAt: number;
	}

	type SafeQueue = {
		id: string;
		subscription: Subscription | null;
	}
}