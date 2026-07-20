import { isIsoUtc } from './lifecycle.mjs';

const TASK_LINE = /^- \[( |x|!)\]\s+(.*)$/;
const METADATA_LINE = /^ {2}- \*\*([^*]+):\*\*(?: (.*))?$/;
const RESOLVED_VALUE = /^`([^`]+)`$/;
const STATE_BY_MARK = { ' ': 'todo', x: 'done', '!': 'blocked' };

function taskContent(raw) {
  let text = raw.trim();
  let criteria = [];
  const crMatch = text.match(/\(([^)]*\bCR\d+[^)]*)\)\s*$/);
  if (crMatch) {
    criteria = crMatch[1].match(/CR\d+/g) ?? [];
    text = text.slice(0, crMatch.index).trim();
  }
  return { text, criteria };
}

function issueFor(taskNumber) {
  return {
    taskNumber,
    message: `invalid task metadata structure for task #${taskNumber}`,
  };
}

export function parseTaskBlocks(body) {
  const lines = Array.isArray(body) ? body : String(body).split('\n');
  const tasks = [];
  const issuesByTask = new Map();

  const addIssue = (taskNumber) => {
    if (!issuesByTask.has(taskNumber)) issuesByTask.set(taskNumber, issueFor(taskNumber));
  };

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const match = lines[lineIndex].match(TASK_LINE);
    if (match) {
      const { text, criteria } = taskContent(match[2]);
      tasks.push({
        text,
        rawText: match[2],
        state: STATE_BY_MARK[match[1]],
        criteria,
        lineIndex,
        metadataLineIndices: [],
      });
      continue;
    }

    const metadata = lines[lineIndex].match(METADATA_LINE);
    if (!metadata) continue;
    const task = tasks.at(-1);
    const taskNumber = tasks.length || 1;
    const expectedLine = task ? task.lineIndex + task.metadataLineIndices.length + 1 : -1;
    if (!task || lineIndex !== expectedLine) {
      addIssue(taskNumber);
      continue;
    }
    task.metadataLineIndices.push(lineIndex);
    if (metadata[1] === 'Resolved') {
      const value = String(metadata[2] ?? '').match(RESOLVED_VALUE);
      if (value && isIsoUtc(value[1])) task.resolvedAt = value[1];
      else addIssue(tasks.length);
    } else if (metadata[1] === 'Blocked' && String(metadata[2] ?? '').trim()) {
      task.reason = metadata[2];
    } else {
      addIssue(tasks.length);
    }
  }

  for (let index = 0; index < tasks.length; index++) {
    const task = tasks[index];
    task.number = index + 1;
    const valid =
      (task.state === 'todo' && task.metadataLineIndices.length === 0) ||
      (task.state === 'done' &&
        task.metadataLineIndices.length === 1 &&
        task.resolvedAt !== undefined &&
        task.reason === undefined) ||
      (task.state === 'blocked' &&
        task.metadataLineIndices.length === 1 &&
        task.reason !== undefined &&
        task.resolvedAt === undefined);
    if (!valid) addIssue(task.number);
  }

  return {
    tasks,
    issues: [...issuesByTask.values()].sort((a, b) => a.taskNumber - b.taskNumber),
  };
}

export function taskMetadataLine(state, { iso, reason } = {}) {
  if (state === 'done') return `  - **Resolved:** \`${iso}\``;
  if (state === 'blocked') return `  - **Blocked:** ${reason}`;
  return null;
}
