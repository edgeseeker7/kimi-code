import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import type { WireRecord } from '#/wire/record';

import { tokenize, topTerms } from './textTokens';

const MAX_MECHANICAL_CHARS = 4000;
const TOPIC_SEGMENTS = 10;
const RECENT_USER_KEPT = 5;

interface CurrentPointer {
  readonly sessionKey: string;
  readonly wire?: string;
  readonly ts?: number;
}

interface PinsFileEntry {
  readonly handle: string;
  readonly label?: string;
  readonly text: string;
  readonly scope?: string;
}

interface NoteEntry {
  readonly id: string;
  readonly text: string;
  readonly tags?: readonly string[];
  readonly supersedes?: readonly string[];
}

function cmRoot(): string {
  return join(process.env.KIMI_CODE_HOME ?? join(homedir(), '.kimi-code'), 'context-manager');
}

function readCurrentPointer(): CurrentPointer | null {
  try {
    return JSON.parse(readFileSync(join(cmRoot(), 'current.json'), 'utf8')) as CurrentPointer;
  } catch {
    return null;
  }
}

function readPins(sessionKey: string): readonly PinsFileEntry[] {
  try {
    return JSON.parse(readFileSync(join(cmRoot(), sessionKey, 'pins.json'), 'utf8')) as PinsFileEntry[];
  } catch {
    return [];
  }
}

function readNotes(sessionKey: string): readonly NoteEntry[] {
  try {
    const lines = readFileSync(join(cmRoot(), sessionKey, 'notes.jsonl'), 'utf8').split('\n');
    const notes = lines.filter(Boolean).map((line) => JSON.parse(line) as NoteEntry);
    const superseded = new Set(notes.flatMap((n) => n.supersedes ?? []));
    return notes.filter((n) => !superseded.has(n.id));
  } catch {
    return [];
  }
}

export function wireRecordText(record: WireRecord): string {
  const anyRecord = record as unknown as Record<string, unknown>;
  const type = anyRecord['type'];
  if (type === 'context.append_message' || type === 'prompt.accepted') {
    const msg = (anyRecord['message'] ?? anyRecord) as { content?: unknown };
    return contentText(msg.content);
  }
  if (type === 'context.append_loop_event') {
    const event = (anyRecord['event'] ?? {}) as Record<string, unknown>;
    if (event['type'] === 'content.part') {
      const part = (event['part'] ?? {}) as { text?: string; think?: string };
      return part.text ?? part.think ?? '';
    }
    if (event['type'] === 'tool.call') {
      return `${event['name'] ?? ''} ${JSON.stringify(event['arguments'] ?? {})}`;
    }
    if (event['type'] === 'tool.result') {
      return contentText(event['content'] ?? event['result']);
    }
  }
  return '';
}

function contentText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((block) => (typeof block === 'string' ? block : ((block as { text?: string })?.text ?? '')))
    .filter(Boolean)
    .join('\n');
}

function isUserMessageRecord(record: WireRecord): boolean {
  const anyRecord = record as unknown as Record<string, unknown>;
  if (anyRecord['type'] !== 'context.append_message') return false;
  const msg = anyRecord['message'] as { role?: string } | undefined;
  return msg?.role === 'user';
}

export interface CheckpointSections {
  readonly pins: string;
  readonly notes: string;
  readonly mechanical: string;
  readonly topicMap: string;
}

export async function collectCheckpointSections(records: AsyncIterable<WireRecord>): Promise<CheckpointSections> {
  const pointer = readCurrentPointer();
  const pins = pointer === null ? [] : readPins(pointer.sessionKey);
  const notes = pointer === null ? [] : readNotes(pointer.sessionKey);

  const all: string[] = [];
  const recentUser: string[] = [];
  let total = 0;
  for await (const record of records) {
    total += 1;
    const text = wireRecordText(record);
    if (text.length > 0) {
      all.push(text);
      if (isUserMessageRecord(record)) recentUser.push(text);
    }
  }

  const slices: string[] = [];
  const sliceSize = Math.max(1, Math.ceil(all.length / TOPIC_SEGMENTS));
  for (let i = 0; i < all.length; i += sliceSize) {
    const terms = topTerms(all.slice(i, i + sliceSize).join('\n'), 5);
    if (terms.length > 0) slices.push(terms.join('/'));
  }

  const pinsText =
    pins.length === 0
      ? '(vault empty)'
      : pins.map((p) => `[${p.handle}] ${p.label ?? ''}\n${p.text}`).join('\n\n');
  const notesText =
    notes.length === 0 ? '(diary empty)' : notes.map((n) => `${n.id}: ${n.text}`).join('\n');
  const mechanical = [
    `Wire journal: ${total} records (seq = line number, history_read can page any of it back).`,
    '',
    'Recent user messages (newest last):',
    ...recentUser.slice(-RECENT_USER_KEPT).map((t) => `- ${t.replace(/\s+/g, ' ').slice(0, 300)}`),
  ].join('\n');

  return {
    pins: pinsText.slice(0, MAX_MECHANICAL_CHARS),
    notes: notesText.slice(0, MAX_MECHANICAL_CHARS),
    mechanical: mechanical.slice(0, MAX_MECHANICAL_CHARS),
    topicMap: slices.slice(0, TOPIC_SEGMENTS).join(' | '),
  };
}

export function renderCheckpoint(sections: CheckpointSections): string {
  return [
    'CONTEXT WINDOW RESET (kimi-context-manager) — earlier context was compacted; nothing was deleted.',
    'The full wire journal persists; use history_search/history_read to page any of it back. Authority order: pins (verbatim) > notes > sketch (LLM summary above, UNVERIFIED) > retrieval hints.',
    '',
    '## Vault pins (verbatim, authoritative)',
    sections.pins,
    '',
    '## Durable notes',
    sections.notes,
    '',
    '## Mechanical state at reset (extracted, authoritative)',
    sections.mechanical,
    '',
    '## Whole-history topic map (10 segments, retrieval hints only)',
    sections.topicMap,
    '',
    '## Memory tools available',
    '- history_search({ query }) — VERBATIM entities from the question, several terms beat one paraphrase.',
    '- history_read({ fromSeq, toSeq }) — read the actual hit ranges.',
    '- notes_append / notes_read — write down decisions and WHY before they scroll away.',
    '- context_alloc / context_free / context_list — pin one-wrong-character-breaks facts verbatim.',
  ].join('\n');
}
