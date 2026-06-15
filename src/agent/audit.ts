import type { PrismaClient, AgentRun } from '@prisma/client';
import type { ToolCallRecord } from './types';

export interface AgentRunInput {
  jobId: string;
  triggerMessageIds: string[];
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number | null;
  toolCalls: ToolCallRecord[];
  responseText: string | null;
  configHash: string;
  error: string | null;
}

export async function recordAgentRun(
  prisma: PrismaClient,
  tenantId: string,
  input: AgentRunInput,
): Promise<AgentRun> {
  return prisma.agentRun.create({
    data: {
      tenantId,
      jobId: input.jobId,
      triggerMessageIds: JSON.stringify(input.triggerMessageIds),
      model: input.model,
      inputTokens: input.inputTokens,
      outputTokens: input.outputTokens,
      costUsd: input.costUsd ?? null,
      toolCalls: JSON.stringify(input.toolCalls),
      responseText: input.responseText,
      configHash: input.configHash,
      error: input.error,
    },
  });
}
