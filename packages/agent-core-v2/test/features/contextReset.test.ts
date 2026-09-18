import { describe, expect, it } from 'vitest';

import type { ContextMessage } from '#/agent/contextMemory/types';
import type { WireRecord } from '#/wire/record';

import { collectCheckpointSections, renderCheckpoint, wireRecordText } from '#/features/contextReset/checkpoint';
import { tokenize, topTerms } from '#/features/contextReset/textTokens';
import { ContextResetService } from '#/features/contextReset/contextResetService';
import { Disposable } from '#/_base/di/lifecycle';

function wireRecord(payload: Record<string, unknown>): WireRecord {
  return { time: 1, ...payload } as unknown as WireRecord;
}

async function* journalOf(records: WireRecord[]): AsyncIterable<WireRecord> {
  for (const record of records) yield record;
}

describe('textTokens', () => {
  it('tokenizes CJK as bigrams and ascii as runs', () => {
    expect(tokenize('美规水晶盒 USNS011 尺寸')).toEqual(['美规', '规水', '水晶', '晶盒', 'usns011', '尺寸']);
  });
  it('topTerms ranks by frequency and drops stops', () => {
    expect(topTerms('青瓷 青瓷 良品率 良品率 釉面', 2)).toEqual(['青瓷', '良品']);
  });
});

describe('checkpoint', () => {
  it('extracts text from append_message and loop events', () => {
    expect(
      wireRecordText(wireRecord({ type: 'context.append_message', message: { role: 'user', content: [{ type: 'text', text: '问' }] } })),
    ).toBe('问');
    expect(
      wireRecordText(wireRecord({ type: 'context.append_loop_event', event: { type: 'content.part', part: { type: 'text', text: '答' } } })),
    ).toBe('答');
    expect(wireRecordText(wireRecord({ type: 'metadata' }))).toBe('');
  });

  it('collects mechanical state and topic map from the journal', async () => {
    const records = [
      wireRecord({ type: 'context.append_message', message: { role: 'user', content: [{ type: 'text', text: '美规水晶盒的尺寸是多少' }] } }),
      wireRecord({ type: 'context.append_loop_event', event: { type: 'content.part', part: { type: 'text', text: 'USNS011 长 45cm' } } }),
    ];
    const sections = await collectCheckpointSections(journalOf(records));
    expect(sections.mechanical).toContain('Wire journal: 2 records');
    expect(sections.mechanical).toContain('美规水晶盒');
    const rendered = renderCheckpoint(sections);
    expect(rendered).toContain('CONTEXT WINDOW RESET');
    expect(rendered).toContain('(vault empty)');
  });
});

class CompactionStub extends Disposable {
  began: { source: string; instruction?: string } | undefined;
  private finishCbs: Array<() => void> = [];
  readonly onDidFinishCompaction = (cb: () => void) => {
    this.finishCbs.push(cb);
    return { dispose: () => {} };
  };
  begin(input: { source: string; instruction?: string }): boolean {
    this.began = input;
    return true;
  }
  finish(): void {
    for (const cb of this.finishCbs) cb();
  }
}

class ContextMemoryStub extends Disposable {
  appended: ContextMessage[] = [];
  append(...messages: ContextMessage[]): void {
    this.appended.push(...messages);
  }
}

describe('ContextResetService', () => {
  it('runs compaction and appends the checkpoint injection after it finishes', async () => {
    const compaction = new CompactionStub();
    const contextMemory = new ContextMemoryStub();
    const wire = {
      readJournal: () =>
        journalOf([
          wireRecord({ type: 'context.append_message', message: { role: 'user', content: [{ type: 'text', text: '记住这个约束' }] } }),
        ]),
    };
    const service = new ContextResetService(
      { agentId: 'main' } as never,
      contextMemory as never,
      compaction as never,
      wire as never,
    );
    const ok = await service.run();
    expect(ok).toBe(true);
    expect(compaction.began?.source).toBe('manual');
    expect(contextMemory.appended).toHaveLength(0);
    compaction.finish();
    expect(contextMemory.appended).toHaveLength(1);
    const message = contextMemory.appended[0]!;
    expect(message.origin).toEqual({ kind: 'injection', variant: 'reset-checkpoint' });
    const text = message.content.map((part) => (part.type === 'text' ? part.text : '')).join('');
    expect(text).toContain('CONTEXT WINDOW RESET');
    expect(text).toContain('记住这个约束');
  });

  it('does not append for compactions that were not resets', async () => {
    const compaction = new CompactionStub();
    const contextMemory = new ContextMemoryStub();
    const wire = { readJournal: () => journalOf([]) };
    new ContextResetService({ agentId: 'main' } as never, contextMemory as never, compaction as never, wire as never);
    compaction.finish();
    expect(contextMemory.appended).toHaveLength(0);
  });
});
