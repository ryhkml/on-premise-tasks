import { defer, map, race, timer } from "rxjs";

export function httpRequest(req: TaskSubscriberRequest, additionalHeaders?: { [k: string]: string }) {
    const source$ = defer(() => {
        let headers = {};
        if (req.httpRequest.headers) {
            headers = req.httpRequest.headers;
        }
        if (additionalHeaders) {
            if (req.httpRequest.headers) {
                headers = {
                    ...headers,
                    ...additionalHeaders
                };
            } else {
                headers = {
                    ...additionalHeaders
                };
            }
        }
        const query = req.httpRequest.query
            ? "?" + new URLSearchParams(req.httpRequest.query).toString()
            : "";
        return fetch(req.httpRequest.url + query, {
            method: req.httpRequest.method,
            body: req.httpRequest.body
                ? JSON.stringify(req.httpRequest.body)
                : undefined,
            headers: {
                ...headers,
                "User-Agent": "Op-Tasks/1.0.0"
            }
        });
    });
    return race(
        timer(req.config.timeout).pipe(
            map(() => {
                throw "Request Timeout";
            })
        ),
        source$
    );
}