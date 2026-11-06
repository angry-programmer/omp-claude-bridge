import { execFileSync } from "node:child_process";
import { userInfo } from "node:os";
import { isAbsolute, join } from "node:path";

// Bun's userInfo().homedir consults HOME before passwd. Never use a cwd- or
// launcher-controlled HOME to locate security policy. Absolute binaries and an
// empty environment keep the account lookup independent of project settings.
const nativeHome = userInfo().homedir;
function accountHome(): string {
	if (process.platform === "win32") return nativeHome;
	const uid = process.getuid!();
	const command = process.platform === "darwin" ? "/usr/bin/id" : "/usr/bin/getent";
	const args = process.platform === "darwin" ? ["-P", String(uid)] : ["passwd", String(uid)];
	const fields = execFileSync(command, args, { encoding: "utf8", env: {}, timeout: 5000 }).trim().split(":");
	const home = fields.at(-2);
	if (Number(fields[2]) !== uid || !home || !isAbsolute(home)) throw new Error("claude-bridge: cannot determine passwd home for trusted config");
	if (nativeHome !== home) console.error("claude-bridge: native home differs from passwd home; using passwd home for trusted config");
	return home;
}

export const TRUSTED_HOME = accountHome();
export const TRUSTED_AGENT_DIR = join(TRUSTED_HOME, ".omp", "agent");
