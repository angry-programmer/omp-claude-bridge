import {
	query as sdkQuery,
	type ModelInfo,
	type Query,
	type SettingSource,
} from "@anthropic-ai/claude-agent-sdk";

/** OMP aborts runtime provider discovery at 15 seconds; finish first. */
export const CLAUDE_MODEL_DISCOVERY_TIMEOUT_MS = 10_000;

type QueryFactory = (params: Parameters<typeof sdkQuery>[0]) => Query;

export type ClaudeModelDiscoveryOptions = {
	cwd?: string;
	pathToClaudeCodeExecutable?: string;
	settingSources?: SettingSource[];
	timeoutMs?: number;
	queryFn?: QueryFactory;
};
function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<never>((_resolve, reject) => {
		timer = setTimeout(() => reject(new Error(`Claude model discovery timed out after ${timeoutMs}ms`)), timeoutMs);
	});
	return Promise.race([promise, timeout]).finally(() => {
		clearTimeout(timer);
	});
}

/**
 * Start a no-turn Agent SDK query solely to read its initialization catalog.
 * The query is always closed, including timeout and initialization failures.
 */
export async function discoverClaudeModels(options: ClaudeModelDiscoveryOptions = {}): Promise<ModelInfo[]> {
	const cwd = options.cwd ?? process.cwd();
	const timeoutMs = options.timeoutMs ?? CLAUDE_MODEL_DISCOVERY_TIMEOUT_MS;
	const queryFn = options.queryFn ?? sdkQuery;
	const sdkQueryInstance = queryFn({
		prompt: "",
		options: {
			cwd,
			maxTurns: 0,
			tools: [],
			strictMcpConfig: true,
			mcpServers: {},
			persistSession: false,
			permissionMode: "dontAsk",
			settingSources: options.settingSources ?? ["user", "project"],
			env: {
				...process.env,
				CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
				ENABLE_CLAUDEAI_MCP_SERVERS: "0",
			},
			...(options.pathToClaudeCodeExecutable
				? { pathToClaudeCodeExecutable: options.pathToClaudeCodeExecutable }
			: {}),
		},
	});

	try {
		const models = await withTimeout(sdkQueryInstance.supportedModels(), timeoutMs);
		if (models.length === 0) throw new Error("Claude model discovery returned an empty catalog");
		return models;
	} finally {
		try {
			sdkQueryInstance.close();
		} catch {
			// Preserve the discovery failure (if any); close is best effort.
		}
	}
}
