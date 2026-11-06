import { filterChildShellEnv } from "@oh-my-pi/pi-utils";
import { readFileSync } from "node:fs";
import { TRUSTED_HOME } from "./trusted-paths.js";

// OMP's public shell filter restores launcher values overwritten by dotenv, but
// its authoritative launch map is private. Use the same Linux exec boundary to
// distinguish launcher credentials from runtime/project additions. Elsewhere,
// no provenance means deny by default; trustedEnv is the explicit escape hatch.
function launchEnvironment(): Map<string, string> {
	if (process.platform === "linux") {
		try {
			return new Map(readFileSync("/proc/self/environ", "utf8").split("\0").flatMap((entry) => {
				const i = entry.indexOf("=");
				return i > 0 ? [[entry.slice(0, i), entry.slice(i + 1)] as [string, string]] : [];
			}));
		} catch { /* Fail closed when procfs is unavailable. */ }
	}
	if (process.execArgv.includes("--no-env-file")) return new Map(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
	return new Map();
}
const launcher = launchEnvironment();
const authNames = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN"];
const deniedNames = ["CLAUDE_CONFIG_DIR", "NODE_EXTRA_CA_CERTS", "NODE_OPTIONS", "BASH_ENV", "ENV", "CLAUDE_CODE_SHELL_PREFIX"];
function denied(name: string): boolean {
	return authNames.includes(name) || /^ANTHROPIC_.*_URL$/.test(name) ||
		/_PROXY$/i.test(name) || /^CLAUDE_CODE_USE_/.test(name) || deniedNames.includes(name);
}
export function buildClaudeEnv(
	mode: "discovery" | "generation" | "summary",
	options: { cwd?: string; trustedEnv?: string[] } = {},
): Record<string, string> {
	const trusted = new Set(options.trustedEnv ?? []);
	const discoveryBase = mode === "discovery" ? filterChildShellEnv(process.env, options.cwd ?? process.cwd()) : undefined;
	const result: Record<string, string> = {};
	const removed: string[] = [];
	for (const [name, value] of Object.entries(process.env)) {
		if (value === undefined) continue;
		if (trusted.has(name)) { result[name] = value; continue; }
		if (mode === "discovery") {
			if (/^(PATH|HOME|USER|LANG|TMPDIR|TERM|LC_.*)$/.test(name)) {
				if (discoveryBase?.[name] !== undefined) result[name] = discoveryBase[name];
			} else if (authNames.includes(name) && launcher.has(name)) result[name] = launcher.get(name)!;
			else removed.push(name);
		} else if (denied(name)) {
			if (launcher.has(name)) result[name] = launcher.get(name)!;
			else removed.push(name);
		} else result[name] = value;
	}
	// HOME selects Claude's credential store too: pin it to the same account as
	// trusted bridge policy unless global policy explicitly trusts that name.
	if (!trusted.has("HOME")) result.HOME = TRUSTED_HOME;
	if (removed.length) console.error(`claude-bridge: removed child environment names: ${removed.sort().join(", ")}`);
	result.ENABLE_CLAUDEAI_MCP_SERVERS = "0";
	if (mode === "discovery") result.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = "1";
	else result.DISABLE_AUTO_COMPACT = "1";
	if (mode === "summary") result.CLAUDE_CODE_DISABLE_AUTO_MEMORY = "1";
	return result;
}
