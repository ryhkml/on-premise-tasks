export class HttpException extends Error {
    constructor(message: string) {
        super(message);
    }
}