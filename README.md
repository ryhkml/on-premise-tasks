<div align="center">
    <h1>
        <b>On-Premise Tasks</b>
    </h1>
</div>

**On-Premise Tasks** is a managed service that handles the execution and distribution of tasks. A task is essentially an object that signifies a resource meant for one-time use. You can request tasks from **On-Premise Tasks**, and they will be carried out at a later time.

<br>

<div align="center">
	<img src="./diagram.png" alt="Diagram On-Premise Tasks">
</div>

## Features
1. HTTP request with curl options (not all options)
2. Retry mechanism
3. Scheduling

## Getting Started
Make sure you have [bun](https://bun.sh/docs/installation) and [rust](https://www.rust-lang.org/tools/install) installed, then run:
```sh
./init.sh
```

## Development
To start the development server, run:
```sh
bun run dev
```

## Test
To start the test server, run:
```sh
bun run test
# Or test specifically the file name
bun test <FILENAME>
```

## Single file executable
To start the single file executable, run:
```sh
# Compile
bun run bin
# Run
./tasks
```

## Docker or Podman build
To start docker or podman during development, run:
```sh
# For docker
docker compose -p <STACK_NAME> --env-file <ENV_FILE> up -d --build
# For podman
podman compose -p <STACK_NAME> --file docker-podman-compose.yaml --env-file <ENV_FILE> up -d --build
# Cleanup
docker/podman compose -p <STACK_NAME> down
```
**Why Nix Store?** The Nix store is an abstraction to store immutable file system data (such as software packages) that can have dependencies on other such data. In this case, On-Premise Tasks copies the nix store directory to a final stage that only requires the curl binary and its dependencies.

## Path configuration
You can use absolute path or current working path, for example:
```sh
# Absolute path
/tmp/tasks/db/tasks.db
# Current working path
./db/tasks.db
```

## APIs
### Subscriber
- ✅ `GET /subscribers/:name`
- ✅ `DELETE /subscribers/:name`
- ✅ `POST /subscribers/register`

### Queue
- ✅ `GET /queues`
- ✅ `GET /queues/:id`
- ❌ `PATCH /queues/:id`
- ✅ `DELETE /queues/:id`
- ❌ `GET /queues/:id/config`
- ✅ `PATCH /queues/:id/pause`
- ✅ `PATCH /queues/:id/resume`
- ✅ `PATCH /queues/:id/unsubscribe`
- ✅ `POST /queues/register`

### Types
```ts
interface TaskSubscriberRequest {
    httpRequest: TasksHttp;
    config?: TasksConfig;
}

type PlainTextData = string;
type MultipartFormData = {
    name: string;
    value: string;
}
type ApplicationJsonData = {
    [key: string]: any;
}

interface TasksHttp {
    url: string;
    method?: "GET" | "POST" | "DELETE" | "PATCH" | "PUT";
    data?: PlainTextData | Array<MultipartFormData> | ApplicationJsonData;
    query?: {
        [key: string]: string;
    };
    cookie?: Array<{
        name: string;
        value: string;
    }>;
    headers?: {
        [key: string]: string;
    };
    authBasic?: {
        user: string;
        password: string;
    };
    authDigest?: {
        user: string;
        password: string;
    };
    authNtlm?: {
        user: string;
        password: string;
    };
    authAwsSigv4?: {
        provider1: string;
        provider2: string;
        region: string;
        service: string;
        key: string;
        secret: string;
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
    timeoutAt?: number; // Default 0
    //
    // The configuration below refers to the curl options (not all options are supported)
    // Visit https://curl.se/docs/manpage.html for more information
    //
    ca?: Array<string base64> | null;
    location?: boolean; // Default false
    locationTrusted?: {
        user: string;
        password: string;
    } | null; // Default null
    dnsServer?: Array<string> | null; // Default null
    dohInsecure?: boolean; // Default false
    dohUrl?: string | null; // Default null
    httpVersion?: "0.9" | "1.0" | "1.1" | "2" | "2-prior-knowledge"; // Default "1.1"
    insecure?: boolean; // Default false
    refererUrl?: string | "AUTO" | null; // Default "AUTO"
    redirectAttempts?: number; // Default 8
    keepAliveDuration?: number; // Default 30, in seconds
    resolve?: Array<{
        host: string;
        port: number;
        address: Array<string>;
    }> | null; // Default null
	ipv?: 4 | 6; // Default 4
	hsts?: boolean; // Default false
	sessionId?: boolean; // Default true
    tlsVersion?: "1.0" | "1.1" | "1.2" | "1.3";
    tlsMaxVersion?: "1.0" | "1.1" | "1.2" | "1.3";
    haProxyClientIp?: string | null;
    haProxyProtocol?: boolean | null;
    proxy?: {
        protocol: "http" | "https";
        host: string;
        port?: number;
    } | null; // Default EMPTY
    proxyAuthBasic?: {
        user: string;
        password: string;
    } | null; // Default EMPTY
    proxyAuthDigest?: {
        user: string;
        password: string;
    } | null; // Default EMPTY
    proxyAuthNtlm?: {
        user: string;
        password: string;
    } | null; // Default EMPTY
    proxyHeaders?: {
        [key: string]: string;
    } | null; // Default EMPTY
    proxyHttpVersion?: "1.0" | "1.1"; // Default EMPTY
    proxyInsecure?: boolean; // Default EMPTY
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

```txt
retryInterval = 3600000ms

Retry-1: 3600000 * 1 = 3600000ms
Retry-2: 3600000 * 2 = 7200000ms
Retry-3: 3600000 * 3 = 10800000ms

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
- `timeoutAt`

Attention:
- `retryAt` is the same as `retry = 1` with a specific time
- `timeoutAt` will be executed only once. If the task has been retried several times, then it will continue using `timeout`.

To find out milliseconds in various programming languages, you can visit https://currentmillis.com and remember to set the environment variable `TZ=UTC` on the Tasks Server.

## SQLite Backup

There are two backup methods:
1. **Local**. The local method copies the database file, then moves it to another directory. This method is active by default
2. **Google Cloud Storage**. The Google Cloud Storage method uploads database files to a Google Cloud Storage. This step is highly recommended.

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
BACKUP_CRON_PATTERN_SQLITE="0 0 * * *"
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