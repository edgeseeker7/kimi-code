import { Service } from '#/_base/di/service';
import { createDecorator } from '#/_base/di/instantiation';
import { IAgentContextMemoryService } from '#/agent/contextMemory/contextMemory';
import type { ContextMessage } from '#/agent/contextMemory/types';
import { IAgentFullCompactionService } from '#/agent/fullCompaction/fullCompaction';
import { IAgentScopeContext } from '#/agent/scopeContext/scopeContext';
import { IWireService } from '#/wire/wire';

import { collectCheckpointSections, renderCheckpoint } from './checkpoint';

export interface IContextResetService {
  readonly _serviceBrand: undefined;
  run(): Promise<boolean>;
}

export const IContextResetService =
  createDecorator<IContextResetService>('contextResetService');

const SKETCH_INSTRUCTION = [
  'Produce the sketch section of a context-reset checkpoint: the current goal state,',
  'decisions already made (with WHY), open questions, and any verbatim constraints',
  'the user issued. Terse bullet points, no narrative. This sketch will be marked',
  'UNVERIFIED; verbatim facts live elsewhere in the checkpoint.',
].join(' ');

export class ContextResetService extends Service implements IContextResetService {
  declare readonly _serviceBrand: undefined;

  private pendingCheckpoint: string | undefined;

  constructor(
    @IAgentScopeContext private readonly scopeContext: IAgentScopeContext,
    @IAgentContextMemoryService private readonly contextMemory: IAgentContextMemoryService,
    @IAgentFullCompactionService private readonly compaction: IAgentFullCompactionService,
    @IWireService private readonly wire: IWireService,
  ) {
    super();
    this._register(
      this.compaction.onDidFinishCompaction(() => {
        const checkpoint = this.pendingCheckpoint;
        if (checkpoint === undefined) return;
        this.pendingCheckpoint = undefined;
        const message: ContextMessage = {
          role: 'user',
          content: [{ type: 'text', text: checkpoint }],
          toolCalls: [],
          origin: { kind: 'injection', variant: 'reset-checkpoint' },
        };
        this.contextMemory.append(message);
      }),
    );
  }

  async run(): Promise<boolean> {
    const sections = await collectCheckpointSections(this.wire.readJournal());
    this.pendingCheckpoint = renderCheckpoint(sections);
    return this.compaction.begin({ source: 'manual', instruction: SKETCH_INSTRUCTION });
  }
}
