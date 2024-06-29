export function info(message: string) {
	const log = console.log;
	log(`[${today()}] \x1b[32m${message}\x1b[0m`);
}

export function warn(message: string) {
	const log = console.warn;
	log(`[${today()}] \x1b[33mWARNING: ${message}\x1b[0m`);
}

export function error(message: string) {
	const log = console.error;
	log(`[${today()}] \x1b[31mERROR: ${message}\x1b[0m`);
}

function today() {
	return new Date().toISOString();
}