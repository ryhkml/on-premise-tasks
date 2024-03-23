import { AES, enc } from "crypto-js";

export function encr(message: string, key: string) {
	return AES.encrypt(message, key).toString();
}

export function decr(chiper: string, key: string) {
	return AES.decrypt(chiper, key).toString(enc.Utf8);
}