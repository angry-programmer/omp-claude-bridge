import { filterChildShellEnv, parseEnvFile } from "@oh-my-pi/pi-utils";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { readTextFile } from "./read-json-file.js";
import { TRUSTED_HOME } from "./trusted-paths.js";

const launchCwd = process.cwd();

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

function projectEnvironment(cwd: string) {
	const modes = new Set(["development"]);
	for (const value of [launcher.get("NODE_ENV"), process.env.NODE_ENV]) {
		if (value === undefined) continue;
		if (!/^[A-Za-z0-9_-]{1,32}$/.test(value)) throw new Error("claude-bridge: NODE_ENV is invalid; refusing dotenv probing");
		modes.add(value);
	}
	const files = [".env", ".env.local"];
	for (const mode of modes) files.push(`.env.${mode}`, `.env.${mode}.local`);
	const names = new Set<string>();
	const values = new Map<string, Set<string>>();
	let base: Record<string, string> | undefined;
	// OMP's parser/filter reads whole files and follows links. Give it a private
	// bounded snapshot, not attacker-controlled paths that can change after a check.
	const snapshot = mkdtempSync(join(tmpdir(), "claude-bridge-env-"));
	try {
		for (const dir of new Set([launchCwd, resolve(cwd)])) {
			const view = join(snapshot, base === undefined ? "launch" : "child");
			mkdirSync(view, { mode: 0o700 });
			for (const file of files) {
				let text: string;
				try { text = readTextFile(join(dir, file)); }
				catch (error) {
					if ((error as NodeJS.ErrnoException)?.code === "ENOENT") continue;
					throw new Error(`claude-bridge: cannot safely read dotenv ${join(dir, file)}`);
				}
				const safePath = join(view, file);
				writeFileSync(safePath, text, { mode: 0o600 });
				const expanded: Record<string, string> = {};
				for (const [key, value] of Object.entries(parseEnvFile(safePath))) {
					// Same expansion as OMP's env.ts; keep values keyed by name.
					expanded[key] = value.replace(
						/(\\)?\$(?:\{([A-Za-z_][A-Za-z0-9_]*)\}|([A-Za-z_][A-Za-z0-9_]*))/g,
						(match, escaped: string | undefined, braced: string | undefined, bare: string | undefined) =>
							escaped ? match.slice(1) : process.env[braced ?? bare!] ?? expanded[braced ?? bare!] ?? "",
					);
					const name = environmentName(key);
					names.add(name);
					const matches = values.get(name) ?? new Set<string>();
					matches.add(value); matches.add(expanded[key]);
					values.set(name, matches);
				}
			}
			const filtered: Record<string, string> = {};
			for (const [name, value] of Object.entries(filterChildShellEnv(process.env, view))) filtered[environmentName(name)] = value;
			if (base === undefined) base = filtered;
			else for (const [name, value] of Object.entries(base)) {
				if (filtered[name] === undefined) delete base[name];
				else if (filtered[name] !== value) {
					// Both candidates came through OMP; prefer its restored launcher
					// value, otherwise reject ambiguous values across the two cwds.
					if (filtered[name] === launcher.get(name)) base[name] = filtered[name];
					else if (value !== launcher.get(name)) delete base[name];
				}
			}
		}
		return { base: base!, names, values };
	} finally { rmSync(snapshot, { recursive: true, force: true }); }
}

export function buildClaudeEnv(
	mode: "discovery" | "generation" | "summary",
	options: { cwd?: string; trustedEnv?: string[] } = {},
): Record<string, string> {
	const cwd = options.cwd ?? process.cwd();
	const trusted = new Set(options.trustedEnv?.map(environmentName) ?? []);
	const project = projectEnvironment(cwd);
	const base = project.base;
	const result: Record<string, string> = {};
	for (const [name, value] of Object.entries(base)) {
		// Match only this name's raw/OMP-expanded values, never an unrelated
		// dotenv value equal to a trusted launcher's proxy or ordinary variable.
		if (project.values.get(name)?.has(value)) continue;
		if (trusted.has(name)) { result[name] = value; continue; }
		if (denied(name) && (project.names.has(name) || launcher.get(name) !== value)) continue;
		if (mode === "discovery" && !/^(PATH|HOME|USER|LANG|TMPDIR|TERM|LC_.*)$/.test(name) && !authNames.includes(name)) continue;
		result[name] = value;
	}
	if (!result.PATH) {
		const original = launcher.get("PATH");
		result.PATH = original || (process.platform === "win32" ? "C:\\Windows\\System32;C:\\Windows" : "/usr/local/bin:/usr/bin:/bin");
		console.error(`claude-bridge: PATH removed or empty; using ${original ? "launcher" : "fixed system"} PATH fallback`);
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
