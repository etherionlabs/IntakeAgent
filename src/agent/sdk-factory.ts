import type { AgentFactory, AgentLike, AgentResponse } from './types';

/**
 * Factory that wraps @openrouter/sdk callModel into an AgentLike interface.
 * The SDK is ESM-only, so we use dynamic import.
 */
export const defaultAgentFactory: AgentFactory = async (cfg) => {
  // Dynamic ESM import since SDK is ESM-only
  const { OpenRouter } = await import('@openrouter/sdk');

  // Create SDK instance
  const sdk = new OpenRouter({
    apiKey: cfg.apiKey,
  });

  // Map our flat tools to the SDK's nested format:
  //   our tool: { name, description, inputSchema, execute }
  //   SDK tool: { type: 'function', function: { name, description, inputSchema, execute } }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sdkTools = (cfg.tools as any[]).map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
      // El SDK pasa (args, ctx) al execute; nuestra tool solo usa args.
      execute: async (args: unknown) => t.execute(args),
    },
  })) as never[];

  const wrapper: AgentLike = {
    on: (event: string, handler: (...args: unknown[]) => void) => {
      // For now, no-op. The SDK doesn't have a simple event emitter interface
      // like the mock did. In a full implementation, we could listen to
      // ModelResult's internal event emitters.
      void event; // Mark as used
      void handler; // Mark as used
    },
    sendSync: async (userMessage: string) => {
      // Build the input for callModel
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const input: any = [
        {
          role: 'user' as const,
          content: userMessage,
        },
      ];

      // Call the SDK's callModel with the user message
      const result = sdk.callModel({
        model: cfg.model,
        input,
        instructions: cfg.instructions,
        tools: sdkTools,
        // maxSteps is not directly supported by ResponsesRequest
        // It's controlled via stopWhen, which defaults to 5 steps
        ...(cfg.temperature !== undefined && { temperature: cfg.temperature }),
      });

      // Wait for the response and extract text + usage
      const response = await result.getResponse();
      const text = await result.getText();

      const agentResponse: AgentResponse = {
        text,
      };

      // Add usage if available and has the expected fields
      if (response?.usage) {
        agentResponse.usage = {
          inputTokens: response.usage.inputTokens,
          outputTokens: response.usage.outputTokens,
          costUsd: response.usage.cost ?? undefined,
        };
      }

      return agentResponse;
    },
  };

  return wrapper;
};
