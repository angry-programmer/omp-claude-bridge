// Trusted bridge config is anchored to the native account/launch home, not OMP's
// dotenv-sensitive directory resolver. Project config may override ordinary
// settings, but only tighten settings/MCP trust ceilings. Missing or unparseable
// files are ignored so the extension always starts.

import type { SettingSource } from "@anthropic-ai/claude-agent-sdk";
import type { ContextWindowMode } from "./models.js";
import { CONFIG_DIR_NAME } from "@oh-my-pi/pi-utils";
import { existsSync, readFileSync } from "fs";
import { userInfo } from "node:os";
import { join } from "path";

// Bun loads cwd .env before application code. process.env.HOME, profile,
// PI_CONFIG_DIR and PI_CODING_AGENT_DIR cannot identify trusted configuration.
const TRUSTED_CONFIG_PATH = join(userInfo().homedir, ".omp", "agent", "claude-bridge.json");

export interface Config {
	askClaude?: {
		enabled?: boolean;
		name?: string;
		label?: string;
		description?: string;
		defaultMode?: "full" | "read" | "none";
		defaultIsolated?: boolean;
		allowFullMode?: boolean;
		appendSkills?: boolean;
	};
	/** Low-level Claude Agent SDK plumbing. Most users won't need these. */
	provider?: {
		appendSystemPrompt?: boolean;
		/** Global trust ceiling; projects may only remove sources. Default []. */
		settingSources?: SettingSource[];
		/** Global trust ceiling; projects may only enable strict mode. Default true. */
		strictMcpConfig?: boolean;
		/** Trusted global config only; ignored in project config. */
		pathToClaudeCodeExecutable?: string;
		/**
		 * Explicit model ids opt out of SDK discovery and stay on the static
		 * metadata/context-window path. An omitted or empty list enables runtime
		 * discovery through Claude Agent SDK supportedModels().
		 */
		models?: string[];
		/** Expose non-versioned SDK aliases in the catalog (default false). */
		includeAliases?: boolean;
		// Default window for retained models; both supported windows stay pickable.
		// "auto" uses per-model policy; "1m"/"200k" choose the preferred default.
		contextWindow?: ContextWindowMode;
	};
}

export function tryParseJson(path: string): Partial<Config> {
	if (!existsSync(path)) return {};
	try {
		return JSON.parse(readFileSync(path, "utf-8"));
	} catch (e) {
		console.error(`claude-bridge: failed to parse ${path}: ${e}`);
		return {};
	}
}

export function loadConfig(cwd: string): Config {
	const global = tryParseJson(TRUSTED_CONFIG_PATH);
	const project = tryParseJson(join(cwd, CONFIG_DIR_NAME, "claude-bridge.json"));
	const trustedSources = global.provider?.settingSources ?? [];
	const projectSources = project.provider?.settingSources;
	if (projectSources?.some((source) => !trustedSources.includes(source))) {
		console.error("claude-bridge: project settingSources cannot loosen the global trust policy; extra sources ignored");
	}
	const strictMcpConfig = global.provider?.strictMcpConfig !== false;
	if (project.provider?.strictMcpConfig === false && strictMcpConfig) {
		console.error("claude-bridge: project strictMcpConfig cannot loosen the global trust policy; false ignored");
	}
	return {
		askClaude: { ...global.askClaude, ...project.askClaude },
		provider: {
			...global.provider,
			...project.provider,
			pathToClaudeCodeExecutable: global.provider?.pathToClaudeCodeExecutable,
			settingSources: projectSources === undefined ? trustedSources : trustedSources.filter((source) => projectSources.includes(source)),
			strictMcpConfig: strictMcpConfig || project.provider?.strictMcpConfig === true,
		},
	};
}
