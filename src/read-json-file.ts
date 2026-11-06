import { closeSync, constants, fstatSync, openSync, readSync } from "node:fs";

/** Small local policy/catalog files only; never follow a final symlink or block on a FIFO. */
export function readJsonFile(path: string): unknown {
	const limit = 1024 * 1024;
	const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
	try {
		const stat = fstatSync(fd);
		if (!stat.isFile() || stat.size > limit) throw new Error("Expected a regular JSON file of at most 1 MB");
		const buffer = Buffer.alloc(limit + 1);
		let length = 0;
		while (length < buffer.length) {
			const bytesRead = readSync(fd, buffer, length, buffer.length - length, null);
			if (!bytesRead) break;
			length += bytesRead;
		}
		if (length > limit) throw new Error("JSON file exceeds 1 MB");
		try {
			return JSON.parse(buffer.toString("utf8", 0, length));
		} catch {
			// Native JSON errors can quote secret input; never let that escape.
			throw new SyntaxError("Invalid JSON");
		}
	} finally {
		closeSync(fd);
	}
}
