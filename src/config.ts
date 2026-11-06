// Global security policy is rooted in the account's passwd home. Project
// configuration may only tighten trust ceilings.

import type { SettingSource } from "@anthropic-ai/claude-agent-sdk";
import type { ContextWindowMode } from "./models.js";
import { CONFIG_DIR_NAME } from "@oh-my-pi/pi-utils";
import { existsSync, readFileSync } from "fs";
import { TRUSTED_AGENT_DIR } from "./trusted-paths.js";
import { join } from "path";

const TRUSTED_CONFIG_PATH = join(TRUSTED_AGENT_DIR, "claude-bridge.json");

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
		const value = JSON.parse(readFileSync(path, "utf-8"));
		return value !== null && typeof value === "object" && !Array.isArray(value) ? value : {};
	} catch (e) {
		console.error(`claude-bridge: failed to parse ${path}: ${e}`);
		return {};
	}
}

function settingSources(value: unknown): SettingSource[] | undefined {
	if (value === undefined) return undefined;
	if (Array.isArray(value)) return value.filter((source): source is SettingSource => source === "user" || source === "project" || source === "local");
	console.error("claude-bridge: settingSources must be an array; using []");
	return [];
}

export function loadConfig(cwd: string): Config {
	const global = tryParseJson(TRUSTED_CONFIG_PATH);
	const project = tryParseJson(join(cwd, CONFIG_DIR_NAME, "claude-bridge.json"));
	const trustedSources = settingSources(global.provider?.settingSources) ?? [];
	const projectSources = settingSources(project.provider?.settingSources);
	if (projectSources?.some((source) => !trustedSources.includes(source))) {
		console.error("claude-bridge: project settingSources cannot loosen the global trust policy; extra sources ignored");
	}
	const strictMcpConfig = global.provider?.strictMcpConfig !== false;
	if (project.provider?.strictMcpConfig === false && strictMcpConfig) {
		console.error("claude-bridge: project strictMcpConfig cannot loosen the global trust policy; false ignored");
	}
	const allowFullMode = global.askClaude?.allowFullMode !== false && project.askClaude?.allowFullMode !== false;
	const defaultMode = project.askClaude?.defaultMode ?? global.askClaude?.defaultMode ?? "read";
	return {
		askClaude: {
			...global.askClaude,
			...project.askClaude,
			enabled: global.askClaude?.enabled !== false && project.askClaude?.enabled !== false,
			allowFullMode,
			defaultMode: defaultMode === "full" && !allowFullMode ? "read" : defaultMode,
			name: global.askClaude?.name,
			description: global.askClaude?.description,
		},
		provider: {
			...global.provider,
			...project.provider,
			pathToClaudeCodeExecutable: global.provider?.pathToClaudeCodeExecutable,
			settingSources: projectSources === undefined ? trustedSources : trustedSources.filter((source) => projectSources.includes(source)),
			strictMcpConfig: strictMcpConfig || project.provider?.strictMcpConfig === true,
		},
	};
}
