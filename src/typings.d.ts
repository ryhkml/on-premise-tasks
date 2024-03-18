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
        method: "POST" | "PATCH" | "PUT" | "DELETE";
        query?: {
            [key: string]: string;
        };
        body?: {
            [key: string]: string;
        };
        headers?: {
            [key: string]: string;
        };
    }
    
    type TaskConfig = {
        executionDelay?: number;
        executionAt?: number;
        retry?: number;
        retryAt?: number;
        retryInterval?: number;
        retryExponential?: boolean;
        timeout?: number;
        responseType?: TaskResponseType;
    }
    
    type TaskSubscriberRequest = {
        httpRequest: TaskHttp;
        config: TaskConfig;
    }
    
    type SafeQueue = {
        id: string;
        subscription: Subscription;
    }
}