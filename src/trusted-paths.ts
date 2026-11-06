import { execFileSync } from "node:child_process";
import { userInfo } from "node:os";
import { isAbsolute, join } from "node:path";

// Bun's userInfo().homedir consults HOME before passwd. Never use a cwd- or
// launcher-controlled HOME to locate security policy. Absolute binaries and an
// empty environment keep the account lookup independent of project settings.
function accountHome(): string {
	let nativeHome: string | undefined;
	try { nativeHome = userInfo().homedir; } catch { /* POSIX passwd lookup below is authoritative. */ }
	if (process.platform === "win32") {
		if (!nativeHome) throw new Error("claude-bridge: native account home lookup failed; refusing to load trusted configuration");
		return nativeHome;
	}
	const uid = process.getuid!();
	const command = process.platform === "darwin" ? "/usr/bin/id" : "/usr/bin/getent";
	const args = process.platform === "darwin" ? ["-P", String(uid)] : ["passwd", String(uid)];
	let home: string;
	try {
		const fields = execFileSync(command, args, { encoding: "utf8", env: {}, timeout: 5000 }).trim().split(":");
		const candidate = fields.at(-2);
		if (Number(fields[2]) !== uid || !candidate || !isAbsolute(candidate)) throw new Error("Invalid passwd entry");
		home = candidate;
	} catch (error) {
		const failure = error as NodeJS.ErrnoException & { status?: number };
		const reason = failure.code === "ENOENT" ? "lookup binary unavailable"
			: failure.code === "ETIMEDOUT" ? "lookup timed out"
			: typeof failure.status === "number" ? `lookup exited with status ${failure.status}`
			: "missing or invalid account entry";
		throw new Error(`claude-bridge: passwd home lookup failed for uid ${uid} via ${command} (${reason}); refusing to load trusted configuration; HOME overrides are not used`);
	}
	if (nativeHome !== undefined && nativeHome !== home) console.error("claude-bridge: native home differs from passwd home; using passwd home for trusted config");
	return home;
}

export const TRUSTED_HOME = accountHome();
export const TRUSTED_AGENT_DIR = join(TRUSTED_HOME, ".omp", "agent");
