import { describe, expect, it } from "bun:test";

import { defer, firstValueFrom, map, switchMap } from "rxjs";

import { httpRequest } from "./fetch";
import { queue } from "../apis/queue";

const app = queue();

describe("TEST FETCH", () => {
    it("should respond status code 200 and string", async () => {
        const http = httpRequest({
            httpRequest: {
                url: "https://www.starlink.com",
                method: "GET"
            },
            config: app.decorator.defaultConfig
        });
        const { res, status } = await firstValueFrom(
            http.pipe(
                switchMap(res => defer(() => res.text()).pipe(
                    map(text => ({
                        res: text,
                        status: res.status
                    }))
                ))
            )
        );
        expect(status).toBe(200);
        expect(res).toBeTypeOf("string");
    });
    it("should respond status code 200 and json", async () => {
        const http = httpRequest({
            httpRequest: {
                url: "https://jsonplaceholder.typicode.com/todos/1",
                method: "GET"
            },
            config: {
                ...app.decorator.defaultConfig,
                responseType: "JSON"
            }
        });
        const { res, status } = await firstValueFrom(
            http.pipe(
                switchMap(res => defer(() => res.json()).pipe(
                    map(json => ({
                        res: json,
                        status: res.status
                    }))
                ))
            )
        );
        expect(status).toBe(200);
        expect(res).toBeTypeOf("object");
    });
});