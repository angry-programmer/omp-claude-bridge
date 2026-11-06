import { filterChildShellEnv, getDotenvEnvValues, parseEnvFile } from "@oh-my-pi/pi-utils";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TRUSTED_HOME } from "./trusted-paths.js";

function environmentName(name: string): string {
	return process.platform === "win32" ? name.toUpperCase() : name;
}

// OMP restores launcher values while filtering dotenv. Its launch map is
// private, so use the same Linux exec boundary only to check provenance of a
// value already present in that filtered base, never to reinsert raw values.
function launchEnvironment(): Map<string, string> {
	if (process.platform === "linux") {
		try {
			return new Map(readFileSync("/proc/self/environ", "utf8").split("\0").flatMap((entry) => {
				const i = entry.indexOf("=");
				return i > 0 ? [[environmentName(entry.slice(0, i)), entry.slice(i + 1)] as [string, string]] : [];
			}));
		} catch { /* Fail closed when procfs is unavailable. */ }
	}
	return new Map();
}
const launcher = launchEnvironment();
const authNames = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN"];
const deniedNames = [
	"CLAUDE_CONFIG_DIR", "NODE_EXTRA_CA_CERTS", "NODE_OPTIONS", "BASH_ENV", "ENV", "CLAUDE_CODE_SHELL_PREFIX",
	"LD_PRELOAD", "LD_LIBRARY_PATH", "ZDOTDIR", "GIT_SSH_COMMAND", "CLAUDE_CODE_ENABLE_TELEMETRY",
	"NODE_TLS_REJECT_UNAUTHORIZED", "SSL_CERT_FILE",
];
function denied(name: string): boolean {
	return authNames.includes(name) || /^ANTHROPIC_.*_URL$/.test(name) ||
		/_PROXY$/i.test(name) || /^(CLAUDE_CODE_USE_|DYLD_|GIT_CONFIG_|OTEL_)/.test(name) || deniedNames.includes(name);
}

function projectDotenv(cwd: string, base: Record<string, string>) {
	const names = new Set<string>();
	// Include Bun's default mode and both launch/current modes: NODE_ENV may
	// itself have been changed by dotenv or by a parent that preloaded it.
	const modes = new Set(["development", launcher.get("NODE_ENV"), base.NODE_ENV, process.env.NODE_ENV]);
	const files = [".env", ".env.local"];
	for (const mode of modes) if (mode) files.push(`.env.${mode}`, `.env.${mode}.local`);
	const values = new Set(getDotenvEnvValues(cwd, process.env));
	for (const file of files) for (const [name, value] of Object.entries(parseEnvFile(join(cwd, file)))) {
		names.add(environmentName(name));
		values.add(value);
	}
	return { names, values };
}

export function buildClaudeEnv(
	mode: "discovery" | "generation" | "summary",
	options: { cwd?: string; trustedEnv?: string[] } = {},
): Record<string, string> {
	const cwd = options.cwd ?? process.cwd();
	const trusted = new Set(options.trustedEnv?.map(environmentName) ?? []);
	const base: Record<string, string> = {};
	for (const [name, value] of Object.entries(filterChildShellEnv(process.env, cwd))) base[environmentName(name)] = value;
	const project = projectDotenv(cwd, base);
	const result: Record<string, string> = {};
	for (const [name, value] of Object.entries(base)) {
		// No mode or trust exception may take a value supplied by cwd dotenv,
		// including dotenv that was already loaded by a parent process.
		if (project.values.has(value) && (project.names.has(name) || trusted.has(name))) continue;
		if (trusted.has(name)) { result[name] = value; continue; }
		if (denied(name) && (project.names.has(name) || launcher.get(name) !== value)) continue;
		if (mode === "discovery" && !/^(PATH|HOME|USER|LANG|TMPDIR|TERM|LC_.*)$/.test(name) && !authNames.includes(name)) continue;
		result[name] = value;
	}
	// HOME selects Claude's credential store too. Rejected overrides retain the
	// passwd account pin, even when HOME was explicitly named in trustedEnv.
	if (!trusted.has("HOME") || result.HOME === undefined) result.HOME = TRUSTED_HOME;
	// Bun exposes some built-in variables through non-enumerable accessors.
	const candidates = new Set([...Object.keys(process.env), ...deniedNames]);
	const removed = [...candidates].filter((name) => process.env[name] !== undefined && result[environmentName(name)] === undefined);
	if (removed.length) console.error(`claude-bridge: removed child environment names: ${removed.sort().join(", ")}`);
	result.ENABLE_CLAUDEAI_MCP_SERVERS = "0";
	if (mode === "discovery") result.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = "1";
	else result.DISABLE_AUTO_COMPACT = "1";
	if (mode === "summary") result.CLAUDE_CODE_DISABLE_AUTO_MEMORY = "1";
	return result;
}
