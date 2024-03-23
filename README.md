<div align="center">
    <h1>
        <b>On-Premise Tasks</b>
    </h1>
</div>

On-Premise Tasks is a managed execution service for task delivery or distribution needs. Technically, a Task is an object that represents a single-use execution resource. You can request tasks from On-Premise Tasks, which will then be executed at a future time. As long as you have an API service, On-Premise Tasks will execute them and send them to the specified target URL.

```
Your app                        Tasks server                Target server
[TASK] ------(register)------>  [QUEUE] ------(http)------> [SERVER]
                                [QUEUE] <------------------ [SERVER]
```

## Features
1. HTTP request
2. Retry mechanism
3. Scheduling

## Getting Started
To get started with this template, simply paste this command into your terminal:
```bash
chmod +x init.sh && ./init.sh
```

## Development
To start the development server run:
```bash
bun dev
```

## Test
To start the test server run:
```bash
bun test
```

## Single-file executable
To start the single-file executable run:
```bash
bun bin
```

## API
### Subscriber
- `GET /subscribers/:name`
- `DELETE /subscribers/:name`
- `POST /subscribers/register`

### Queue
- `GET /queues/:id`
- `GET /queues/:id/config`
- `DELETE /queues/:id`
- `PATCH /queues/:id/pause`
- `PATCH /queues/:id/resume`
- `PATCH /queues/:id/unsubscribe`
- `POST /queues/register`

### Types
```ts
type TaskSubscriberRequest = {
    httpRequest: TasksHttp;
    config?: TasksConfig;
}

type TasksHttp = {
    url: string;
    method: "GET" | "POST" | "DELETE" | "PATCH" | "PUT";
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

type TasksConfig = {
    executionDelay?: number; // Default 1
    executeAt?: number; // Default 0
    retry?: number; // Default 0, min: 0, max: 128
    retryAt?: number; // Default 0
    retryInterval?: number; // Default 0, min: 0, max: 86400000
    retryExponential?: boolean; // Default true
    timeout?: number; // Default 30000, min: 1000, max: 300000
}
```
An example of requesting a Task

```sh
curl -X POST \
    -H "authorization: Bearer <KEY>" \
    -H "content-type: application/json" \
    -H "x-tasks-subscriber-id: <ID>" \
    -d "{
        "httpRequest": {
            "url": "https://api.starlink.com",
            "method": "GET"
        },
        "config": {
            "executionDelay": 1710880762570,
            "retry": 5,
            "retryInterval": 3600000,
            "retryExponential": false
        }
    }" \
    http://localhost:3200/queues/register
```

The example above, the task will be executed after waiting for 1 day. If the task receives a 4xx-5xx error response, it will be run again 5 times with a 1-hour interval between each execution. If `retryExponential = true`, the interval between each execution will increase

```
retryInterval = 3600000

Retry-1, 3600000 * 1 = 3600000
Retry-2, 3600000 * 2 = 7200000
Retry-3, 3600000 * 3 = 10800000

And so on...
```
Additionally, you can make specific requests for when tasks will be executed using `executeAt`

```sh
curl -X POST \
    -H "authorization: Bearer <KEY>" \
    -H "content-type: application/json" \
    -H "x-tasks-subscriber-id: <ID>" \
    -d "{
        "httpRequest": {
            "url": "https://api.starlink.com",
            "method": "GET"
        },
        "config": {
            "executeAt": 1710880762570
        }
    }" \
    http://localhost:3200/queues/register
```
Please note that properties ending with `"At"` are in UNIX time format:
- `executeAt`
- `retryAt`

To find out milliseconds in various programming languages, you can visit the website https://currentmillis.com. And remember to set the environment variable `TZ=UTC` on the Tasks Server.