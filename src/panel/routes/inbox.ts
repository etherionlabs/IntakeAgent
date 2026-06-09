import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { loadDashboardData } from './dashboard';
import { generateSummary, extractActionsFromToolCalls } from '../services/receptionist-summary';
import { groupConversationsByState } from '../services/grouping';
import { formatTimelineItems } from '../services/timeline';
import type { Conversation } from '../services/grouping';
import type { TimelineItem } from '../services/timeline';
import type { ConnectionStateProvider } from '../adapter-state';

/**
 * Loads recent agent actions to generate an operational summary.
 * Fetches the latest agent runs (last 3) and extracts actions from tool calls.
 */
async function loadRecentActions(prisma: PrismaClient) {
  const recentRuns = await prisma.agentRun.findMany({
    orderBy: { createdAt: 'desc' },
    take: 3,
  });

  const allActions = [];
  for (const run of recentRuns) {
    try {
      const toolCalls = JSON.parse(run.toolCalls) as Array<{
        name: string;
        args: unknown;
        result: unknown;
      }>;
      const actions = extractActionsFromToolCalls(toolCalls);
      allActions.push(...actions);
    } catch (err) {
      // If parsing fails, skip this run
      console.error(`Failed to parse toolCalls for run ${run.id}:`, err);
    }
  }

  return allActions;
}

/**
 * Photo entry with URL and timestamp
 */
interface PhotoEntry {
  url: string;
  timestamp?: string;
}

/**
 * Extracts vehicle and client information from job intake data.
 * Used to populate the artifact panel header.
 */
interface ArtifactData {
  vehicleYear?: string;
  vehicleMake?: string;
  vehicleModel?: string;
  clientName?: string;
  clientPhone?: string;
  photos?: PhotoEntry[];
}

/**
 * Calculates completion percentage from intake data
 */
function calculateIntakeCompletion(intakeJson: string | null): {
  completionPercentage: number;
  completedItems: number;
  totalItems: number;
} {
  const defaultResult = {
    completionPercentage: 0,
    completedItems: 0,
    totalItems: 0,
  };

  if (!intakeJson) return defaultResult;

  try {
    const intake = JSON.parse(intakeJson) as Record<string, any>;

    // Define key intake fields to track
    const requiredFields = [
      'vehicle.year',
      'vehicle.make',
      'vehicle.model',
      'client.name',
      'client.phone',
      'condition',
      'damages',
    ];

    let completedCount = 0;

    for (const field of requiredFields) {
      const parts = field.split('.');
      let value: any = intake;

      for (const part of parts) {
        value = value?.[part];
      }

      if (value && value !== '' && (!Array.isArray(value) || value.length > 0)) {
        completedCount++;
      }
    }

    const total = requiredFields.length;
    const percentage = Math.round((completedCount / total) * 100);

    return {
      completionPercentage: percentage,
      completedItems: completedCount,
      totalItems: total,
    };
  } catch (err) {
    console.error('Failed to calculate intake completion:', err);
    return defaultResult;
  }
}

function extractArtifactFromIntake(intakeJson: string | null): ArtifactData | null {
  if (!intakeJson) return null;

  try {
    const intake = JSON.parse(intakeJson) as Record<string, any>;

    // Extract vehicle info — supports common field naming patterns
    const vehicleYear = intake.vehicle?.year || intake.vehicle_year || intake.vehicleYear || '';
    const vehicleMake = intake.vehicle?.make || intake.vehicle_make || intake.vehicleMake || '';
    const vehicleModel = intake.vehicle?.model || intake.vehicle_model || intake.vehicleModel || '';

    // Extract client info
    const clientName = intake.client?.name || intake.client_name || intake.clientName || '';
    const clientPhone = intake.client?.phone || intake.client_phone || intake.clientPhone || '';

    // Return artifact only if there's at least some vehicle data
    if (vehicleYear || vehicleMake || vehicleModel) {
      return {
        vehicleYear: vehicleYear || undefined,
        vehicleMake: vehicleMake || undefined,
        vehicleModel: vehicleModel || undefined,
        clientName: clientName || undefined,
        clientPhone: clientPhone || undefined,
      };
    }

    return null;
  } catch (err) {
    console.error('Failed to parse intake JSON for artifact:', err);
    return null;
  }
}

/**
 * Loads conversations from the database for the inbox view.
 * Fetches all jobs with their associated contact and message information.
 */
async function loadConversations(prisma: PrismaClient): Promise<Conversation[]> {
  const jobs = await prisma.job.findMany({
    include: {
      contact: true,
      messages: {
        orderBy: { createdAt: 'desc' },
        take: 1, // Get only the most recent message
      },
      agentRuns: {
        orderBy: { createdAt: 'desc' },
        take: 1, // Get only the most recent agent run
      },
      _count: { select: { messages: true } },
    },
    orderBy: { openedAt: 'desc' },
    take: 100, // Limit to 100 conversations for performance
  });

  return jobs.map((job) => {
    const lastMessage = job.messages[0];
    const lastAgentRun = job.agentRuns[0];
    const contactName =
      job.contact.displayName || job.contact.phoneE164 || 'Unknown';
    const lastMessageText = lastMessage?.body || '(no messages)';
    const isWaitingForClient = job.status === 'READY_FOR_REVIEW';

    return {
      id: job.id,
      contactName,
      contactPhone: job.contact.phoneE164,
      lastMessage: lastMessageText,
      lastMessageTime: lastMessage?.createdAt || job.openedAt,
      messageCount: job._count.messages,
      isWaitingForClient,
      lastAgentResponseTime: lastAgentRun?.createdAt,
      status: job.status,
    };
  });
}

export function registerInboxRoute(
  app: FastifyInstance,
  prisma: PrismaClient,
  adapterState: ConnectionStateProvider,
): void {
  app.get('/panel/inbox', async (req, reply) => {
    if (!(req as any).panelUser) {
      reply.redirect('/panel/login', 303);
      return;
    }
    const data = await loadDashboardData(prisma);
    const username = (req as any).panelUser;
    const userInitials = username
      .split(/\s+/)
      .map((n: string) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2) || 'YM';

    // Load recent actions and generate operational summary
    const recentActions = await loadRecentActions(prisma);
    const operationalSummary = generateSummary(recentActions);

    // Load conversations and group them by state
    const conversations = await loadConversations(prisma);
    const groupedConversations = groupConversationsByState(conversations);

    // Load artifact data for the first (most recent) conversation
    let selectedArtifact: ArtifactData | undefined;
    let timelineItems: TimelineItem[] = [];
    let completionPercentage = 0;
    let completedItems = 0;
    let totalItems = 0;

    if (conversations.length > 0) {
      const firstConversation = conversations[0];
      const job = await prisma.job.findUnique({
        where: { id: firstConversation.id },
        include: {
          messages: {
            where: { kind: 'image' },
            orderBy: { createdAt: 'asc' },
          },
          agentRuns: {
            orderBy: { createdAt: 'desc' },
            take: 10, // Get recent agent runs for this job
          },
        },
      });
      if (job) {
        const artifact = extractArtifactFromIntake(job.intake);
        if (artifact) {
          // Extract photos from image messages
          const photos: PhotoEntry[] = job.messages
            .filter((msg) => msg.mediaPath)
            .map((msg) => ({
              url: `/media/${msg.mediaPath}`,
              timestamp: msg.createdAt.toISOString(),
            }));

          selectedArtifact = {
            ...artifact,
            clientName: artifact.clientName || firstConversation.contactName,
            clientPhone: artifact.clientPhone || firstConversation.contactPhone,
            photos: photos.length > 0 ? photos : undefined,
          };

          // Extract and format timeline items from job's agent runs
          const allJobActions = [];
          for (const run of job.agentRuns) {
            try {
              const toolCalls = JSON.parse(run.toolCalls) as Array<{
                name: string;
                args: unknown;
                result: unknown;
              }>;
              const actions = extractActionsFromToolCalls(toolCalls);
              allJobActions.push(...actions);
            } catch (err) {
              console.error(`Failed to parse toolCalls for run ${run.id}:`, err);
            }
          }
          timelineItems = formatTimelineItems(allJobActions);

          // Calculate intake completion progress
          const progress = calculateIntakeCompletion(job.intake);
          completionPercentage = progress.completionPercentage;
          completedItems = progress.completedItems;
          totalItems = progress.totalItems;
        }
      }
    }

    return reply.view(
      'inbox.hbs',
      {
        title: 'Inbox',
        username,
        currentPage: 'inbox',
        userInitials,
        operationalSummary,
        groupedConversations,
        selectedArtifact,
        timelineItems,
        completionPercentage,
        completedItems,
        totalItems,
        ...data,
        adapter: adapterState.state(),
      },
      { layout: 'layouts/base.handlebars' },
    );
  });
}
