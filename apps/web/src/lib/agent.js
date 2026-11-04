import { chatTools } from './ai.js';

/**
 * Tool loop for Deep mode. Runs model → tools → model until the model answers
 * without tool calls or maxRounds is hit. `chat` is injectable so tests can
 * drive the loop with a scripted model instead of the gateway.
 */

export async function runToolLoop({
  model,
  system,
  userText,
  toolDefs,
  runTool,
  maxRounds = 3,
  onTool = null,
  onUsage = null,
  chat = null,
}) {
  const call = chat || ((messages) => chatTools({ model, messages, tools: toolDefs }));
  const messages = [
    { role: 'system', content: system },
    { role: 'user', content: userText },
  ];
  const total = { in: 0, out: 0, estimated: false };
  let lastContent = '';
  for (let round = 0; round < maxRounds; round += 1) {
    const { content, toolCalls, usage } = await call(messages);
    total.in += usage.in || 0;
    total.out += usage.out || 0;
    total.estimated = total.estimated || Boolean(usage.estimated);
    if (onUsage) onUsage(usage);
    lastContent = content || lastContent;
    const calls = (toolCalls || []).filter((c) => c && c.name).slice(0, 4);
    if (!calls.length) break;
    if (onTool) for (const c of calls) onTool(c.name, c.args);
    messages.push({
      role: 'assistant',
      content: content || '',
      tool_calls: calls.map((c, i) => ({
        id: c.id || `call_${round}_${i}`,
        type: 'function',
        function: { name: c.name, arguments: JSON.stringify(c.args || {}) },
      })),
    });
    const results = await Promise.all(calls.map((c) => runTool(c.name, c.args || {})));
    calls.forEach((c, i) => {
      messages.push({ role: 'tool', tool_call_id: c.id || `call_${round}_${i}`, content: String(results[i] || '') });
    });
    if (round === maxRounds - 1) {
      // Out of rounds: one last prose-only nudge so the user gets an answer.
      const fin = await call([...messages, { role: 'user', content: 'Answer now with what you have. No more tool calls.' }]);
      total.in += fin.usage.in || 0;
      total.out += fin.usage.out || 0;
      if (onUsage) onUsage(fin.usage);
      if (fin.content && fin.content.trim()) lastContent = fin.content;
    }
  }
  return {
    text: lastContent.trim() || 'I could not shape an answer from these references — try rephrasing the question.',
    usage: total,
  };
}
