import { LifecycleScope } from '#/app/scopes';
import { Feature } from '#/features/feature';
import { registerFeature } from '#/features/featureRegistry';

import { ContextResetService, IContextResetService } from './contextResetService';

export class ContextResetFeature extends Feature {
  static override readonly name = 'contextReset';

  constructor() {
    super();
    this.contributeService(LifecycleScope.Agent, IContextResetService, ContextResetService);
    this.contributeCommand({
      name: 'reset',
      description:
        'Reset the context window: compact the conversation and re-anchor on a checkpoint (vault pins, durable notes, mechanical state, topic map). The full wire journal persists and stays searchable with history_search/history_read.',
      run: async (ctx) => {
        await ctx.get(IContextResetService).run();
      },
    });
  }
}

registerFeature(ContextResetFeature);
