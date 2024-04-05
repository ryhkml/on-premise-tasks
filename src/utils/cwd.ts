import { cwd as current } from "node:process";
import { join } from "node:path";

export function cwd(path: string) {
	return join(current(), path);
}