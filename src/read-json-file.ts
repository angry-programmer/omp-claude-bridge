import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync } from "node:fs";

/** The global policy alone may use a final symlink to a protected account-owned file. */
export function readTextFile(path: string, trustedGlobalSymlink = false): string {
	const limit = 1024 * 1024;
	const linked = trustedGlobalSymlink && lstatSync(path).isSymbolicLink();
	if (linked) {
		try { path = realpathSync(path); }
		catch { throw new Error("Unresolvable global config symlink"); }
	}
	let fd: number;
	try { fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
	catch (error) {
		if (linked) throw new Error("Cannot open global config symlink target");
		throw error;
	}
	try {
		const stat = fstatSync(fd);
		if (!stat.isFile() || stat.size > limit) throw new Error("Expected a regular file of at most 1 MB");
		if (linked && ((stat.uid !== 0 && stat.uid !== process.getuid?.()) || (stat.mode & 0o022) !== 0)) {
			throw new Error("Global config symlink target must be account/root-owned and not group/world-writable");
		}
		const buffer = Buffer.alloc(limit + 1);
		let length = 0;
		while (length < buffer.length) {
			const bytesRead = readSync(fd, buffer, length, buffer.length - length, null);
			if (!bytesRead) break;
			length += bytesRead;
		}
		if (length > limit) throw new Error("File exceeds 1 MB");
		return buffer.toString("utf8", 0, length);
	} finally {
		closeSync(fd);
	}
}

export function readJsonFile(path: string, trustedGlobalSymlink = false): unknown {
	const text = readTextFile(path, trustedGlobalSymlink);
	try {
		return JSON.parse(text);
	} catch {
		// Native JSON errors can quote secret input; never let that escape.
		throw new SyntaxError("Invalid JSON");
	}
}
