import { Elysia, t } from "elysia";

type HttpTasks = {
    url: string;
    data?: string;
    method: string;
    query?: {
        [key: string]: string;
    };
    headers?: {
        [key: string]: string;
    };
}

type HttpTasksConfig = {
    // 
    executionDelay: number;
    executionAt: number;
    // 
    retry: number;
    retryAt: number;
    retryInterval: number;
    retryExponential: boolean;
    // 
    timeout: number;
}

type HttpRequest = {
    httpRequest: HttpTasks;
    config: Partial<HttpTasksConfig>;
}

export const subscription = new Elysia({ prefix: "/v1beta" })
    .onBeforeHandle(({ request, set }) => {
        const ds = request.headers.get("X");
        if (ds == null) {
            set.status = 401;
            return {};
        }
    })
    .get("/queues/:id", c => {})

    .post("/subscribe", ({ body }) => {

    }, {
        body: t.Object({
            httpRequest: t.Object({
                url: t.String({
                    format: "uri"
                }),
                method: t.Union([
                    t.Literal("POST"),
                    t.Literal("PATCH"),
                    t.Literal("PUT"),
                    t.Literal("DELETE")
                ], {
                    default: "POST"
                }),
                data: t.Optional(
                    t.String({
                        contentEncoding: "base64"
                    })
                )
            }),
            config: t.Optional(
                t.Object({
    
                })
            )
        }),
        transform: ({ body }) => {
            const config = body.config;
            if (config == null) {
                body.config = {};
            }
        }
    });