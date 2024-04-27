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
To get started with this app, simply paste this command into your terminal:
```bash
./init.sh
```

## Development
To start the development server, run:
```bash
bun run dev
```

## Test
To start the test server, run:
```bash
bun run test
# For file specific test
bun test <FILENAME>
```

## Single file executable
To start the single file executable, run:
```bash
# Compile
bun run bin
# Run
NODE_ENV=production ./tasks
```

## Docker build
To start the docker build, run:
```bash
# Build
docker compose -p <STACK_NAME> --env-file .env.production up -d --build
# Down
docker compose -p <STACK_NAME> down
```

## Path configuration
You can use absolute path or current working path, for example:
```ts
// Absolute path
"/etc/tasks/db/tasks.db"
// Current working path
"./db/tasks.db"
```

## API
### Subscriber
- `GET /subscribers/:name` ✅
- `DELETE /subscribers/:name` ✅
- `POST /subscribers/register` ✅

### Queue
- `GET /queues` ✅
- `GET /queues/:id` ✅
- `PATCH /queues/:id` ❌
- `DELETE /queues/:id` ✅
- `GET /queues/:id/config` ❌
- `PATCH /queues/:id/pause` ✅
- `PATCH /queues/:id/resume` ✅
- `PATCH /queues/:id/unsubscribe` ✅
- `POST /queues/register` ✅

### Types
```ts
interface TaskSubscriberRequest {
    httpRequest: TasksHttp;
    config?: TasksConfig;
}

interface TasksHttp {
    url: string;
    method: "GET" | "POST" | "DELETE" | "PATCH" | "PUT";
    body?: {
        [key: string]: string | number;
    };
    query?: {
        [key: string]: string;
    };
    headers?: {
        [key: string]: string;
    };
}

interface TasksConfig {
    executionDelay?: number; // Default 1ms, min: 0
    executeAt?: number; // Default 0
    retry?: number; // Default 0, min: 0, max: 4096
    retryAt?: number; // Default 0
    retryInterval?: number; // Default 0, min: 0, max: 604800000ms
    retryStatusCode?: Array<number>; // Default []
    retryExponential?: boolean; // Default true
    timeout?: number; // Default 30000ms, min: 1000ms, max: 3600000ms
}
```
An example of requesting a Task
```json
{
    "httpRequest": {
        "url": "https://dummyjson.com/todos/1",
        "method": "GET"
    },
    "config": {
        "executionDelay": 86400000,
        "retry": 5,
        "retryInterval": 3600000,
        "retryExponential": false
    }
}
```
```sh
curl -X POST \
    -H "authorization: Bearer <KEY>" \
    -H "content-type: application/json" \
    -H "x-tasks-subscriber-id: <ID>" \
    -d @req.json \
    http://localhost:3200/queues/register
```

The example above, the task will be executed after waiting for 1 day. If the task receives a 4xx-5xx error response, it will be run again 5 times with a 1-hour interval between each execution. If `retryExponential = true`, the interval between each execution will increase

```
retryInterval = 3600000ms

Retry-1, 3600000 * 1 = 3600000ms
Retry-2, 3600000 * 2 = 7200000ms
Retry-3, 3600000 * 3 = 10800000ms

And so on...
```
Additionally, you can make a specific request by using `executeAt`
```json
{
    "httpRequest": {
        "url": "https://dummyjson.com/todos/1",
        "method": "GET"
    },
    "config": {
        "executeAt": 2619277200000
    }
}
```
```sh
curl -X POST \
    -H "authorization: Bearer <KEY>" \
    -H "content-type: application/json" \
    -H "x-tasks-subscriber-id: <ID>" \
    -d @req.json \
    http://localhost:3200/queues/register
```
Please note that properties ending with `"At"` are in UNIX time format:
- `executeAt`
- `retryAt`

To find out milliseconds in various programming languages, you can visit https://currentmillis.com and remember to set the environment variable `TZ=UTC` on the Tasks Server.

## SQLite Backup

There are two backup methods:
1. Local. The local method copies the database file, then moves it to another directory. This method is active by default
2. Google Cloud Storage. The Google Cloud Storage method uploads database files to a Google Cloud Storage.

You can set it via env variable
```ts
type SqliteBackupMethod = "LOCAL" | "GOOGLE_CLOUD_STORAGE"
```
```sh
BACKUP_METHOD_SQLITE="LOCAL"
```

You can also set the backup interval using the cron format
```sh
# Default: Every day at midnight
BACKUP_CRON_PATTERN_SQLITE=
```

### Set up authentication for Google Cloud Storage

1. [Create a service account](https://cloud.google.com/iam/docs/service-accounts-create#creating) and do not grant any access, just create!
2. [Create a new key](https://cloud.google.com/iam/docs/keys-create-delete#creating) (select the JSON format)
3. Go to Google Cloud Storage, create a bucket
4. Click the three-dot icon in the corner of the bucket table to perform more actions, then click edit access
5. Click add principal
6. Enter the service account email and assign roles:
	- **Storage Object User**
	- **Storage Object Viewer**
7. Click save