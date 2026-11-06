// User-facing extension config. Loaded at extension registration from OMP's
// agent directory and the project's OMP config directory. Project settings
// override global settings except the trusted executable path. Missing or
// unparseable files are ignored so the extension always starts.

import type { SettingSource } from "@anthropic-ai/claude-agent-sdk";
import type { ContextWindowMode } from "./models.js";
import { CONFIG_DIR_NAME, getAgentDir } from "@oh-my-pi/pi-utils";
import { existsSync, readFileSync } from "fs";
import { join } from "path";

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
		settingSources?: SettingSource[];
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
	const global = tryParseJson(join(getAgentDir(), "claude-bridge.json"));
	const project = tryParseJson(join(cwd, CONFIG_DIR_NAME, "claude-bridge.json"));
	return {
		askClaude: { ...global.askClaude, ...project.askClaude },
		provider: {
			...global.provider,
			...project.provider,
			pathToClaudeCodeExecutable: global.provider?.pathToClaudeCodeExecutable,
		},
	};
}
