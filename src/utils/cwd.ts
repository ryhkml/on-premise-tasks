import { resolveSync } from "bun";

/**
 * Synchronously resolve a file as though it were imported from parent
 *
 * Visit https://bun.sh/docs/api/utils#bun-resolvesync
*/
export function cwd(path: string) {
	return resolveSync(path, ".");
}