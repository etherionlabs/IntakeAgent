import type { TurnContext, TurnResult, AgentDeps, ToolCallRecord } from './types';
import { buildSystemPrompt, renderUserMessage } from './prompt';
import { buildTools } from './tools';
import { recordAgentRun } from './audit';

export async function runAgentTurn(
  ctx: TurnContext,
  deps: AgentDeps,
): Promise<TurnResult> {
  const apiKey = process.env.OPENROUTER_API_KEY ?? '';
  const triggerMessageIds = ctx.batchMessages.map((m) => m.id);
  const toolCalls: ToolCallRecord[] = [];

  // Construimos las tools con un wrapper que registra cada llamada.
  const rawTools = buildTools(ctx, deps);
  const wrappedTools = rawTools.map((tool) => ({
    ...tool,
    execute: async (args: unknown) => {
      let result: unknown;
      let errorMsg: string | null = null;
      try {
        result = await tool.execute(args as never);
        if (typeof result === 'object' && result && 'ok' in result && (result as any).ok === false) {
          errorMsg = String((result as any).error ?? 'tool returned ok=false');
        }
      } catch (err) {
        errorMsg = err instanceof Error ? err.message : String(err);
        result = { ok: false, error: errorMsg };
      }
      toolCalls.push({ name: tool.name, args, result, error: errorMsg });
      return result;
    },
  }));

  const instructions = buildSystemPrompt({
    profile: deps.profile,
    config: deps.config,
    intake: ctx.intake,
    jobId: ctx.job.id,
    jobStatus: ctx.job.status,
    otherOpenJobs: ctx.otherOpenJobs,
    now: new Date(ctx.now),
  });
  const userMessage = renderUserMessage(ctx.batchMessages);

  let responseText = '';
  let inputTokens = 0;
  let outputTokens = 0;
  let costUsd: number | null = null;
  let error: string | null = null;

  try {
    const agent = await deps.createAgent({
      apiKey,
      model: deps.config.model,
      instructions,
      tools: wrappedTools,
      maxSteps: deps.config.maxSteps,
      temperature: deps.config.temperature,
    });
    const response = await agent.sendSync(userMessage);
    responseText = response.text;
    inputTokens = response.usage?.inputTokens ?? 0;
    outputTokens = response.usage?.outputTokens ?? 0;
    costUsd = response.usage?.costUsd ?? null;
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
    responseText = deps.config.fallbackOnError;
  }

  await recordAgentRun(deps.prisma, {
    jobId: ctx.job.id,
    triggerMessageIds,
    model: deps.config.model,
    inputTokens,
    outputTokens,
    costUsd,
    toolCalls,
    responseText,
    configHash: deps.profile.hash,
    error,
  });

  return {
    responseText,
    toolCalls,
    inputTokens,
    outputTokens,
    costUsd,
    error,
  };
}
