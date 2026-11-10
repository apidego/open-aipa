import { newAsyncContext, getQuickJS } from 'quickjs-emscripten';
import { z } from 'zod';
import type { Context } from '../../core/context.js';
import type { RunAgent } from '../agent.js';
import { connectedIntegrations } from '../../integrations/registry.js';
import { outcomeSchema, type Job } from './types.js';
export async function validateScript(source: string) {
  if (!source.trim() || source.length > 30000) throw new Error('Invalid script length');
  const engine = await getQuickJS();
  const vm = engine.newContext();
  vm.runtime.setMemoryLimit(16 * 1024 * 1024);
  const deadline = Date.now() + 1000;
  vm.runtime.setInterruptHandler(() => Date.now() > deadline);
  try {
    vm.unwrapResult(vm.evalCode(`new Function("pa", ${JSON.stringify(source)})`)).dispose();
  } finally {
    vm.dispose();
  }
}
export async function runScript(ctx: Context, job: Job, runAgent: RunAgent, cpuMs = 1000) {
  const vm = await newAsyncContext();
  const start = Date.now();
  let suspended = 0,
    calls = 0,
    aiCalls = 0;
  vm.runtime.setMemoryLimit(16 * 1024 * 1024);
  vm.runtime.setMaxStackSize(256 * 1024);
  vm.runtime.setInterruptHandler(
    () => Date.now() - start > 120000 || Date.now() - start - suspended > cpuMs,
  );
  try {
    const bridge = vm.newAsyncifiedFunction('__call', async (methodHandle, dataHandle) => {
      if (Date.now() - start > 120000 || ++calls > 20) throw new Error('Script limit reached');
      if (!ctx.store.get('SELECT id FROM jobs WHERE id=? AND user_id=?', job.id, job.user_id))
        throw new Error('Job unavailable');
      const method = vm.getString(methodHandle),
        raw = vm.getString(dataHandle);
      if (raw.length > 32000) throw new Error('Tool input too large');
      const args: unknown = JSON.parse(raw);
      const before = Date.now();
      let result: unknown;
      try {
        if (method === 'ai') {
          if (!job.allow_ai || ++aiCalls > 2) throw new Error('AI access unavailable');
          const prompt = z.string().min(1).max(16000).parse(args);
          result = await runAgent(job.user_id, [{ role: 'user', content: prompt }], undefined, {
            signal: AbortSignal.timeout(Math.max(1, 120000 - (Date.now() - start))),
          });
        } else {
          const { name, input } = z
            .object({ name: z.string().max(100), input: z.unknown() })
            .parse(args);
          if (method !== 'tool') throw new Error('Unknown capability');
          const provider = connectedIntegrations(ctx, job.user_id).find(
            (p) => p.scriptTools?.includes(name) && p.tools.some((t) => t.name === name),
          );
          if (!provider) throw new Error('Integration not connected');
          result = await provider.execute(ctx, job.user_id, name, input);
        }
      } catch {
        throw new Error('Capability request failed');
      } finally {
        suspended += Date.now() - before;
      }
      const encoded = JSON.stringify(result ?? null);
      if (encoded.length > 256000 || Date.now() - start > 120000)
        throw new Error('Script limit reached');
      return vm.newString(encoded);
    });
    vm.setProp(vm.global, '__call', bridge);
    bridge.dispose();
    const context = JSON.stringify({
      state: JSON.parse(job.script_state),
      now: new Date().toISOString(),
    });
    const result = await vm.evalCodeAsync(`(() => {
      const context = ${context};
      const call = __call; delete globalThis.__call;
      const pa = Object.freeze({ state:context.state, now:context.now,
        tool:(name,input)=>JSON.parse(call('tool',JSON.stringify({name,input}))),
        ai:(prompt)=>JSON.parse(call('ai',JSON.stringify(prompt))) });
      const execute = new Function('pa', ${JSON.stringify('"use strict";\n' + job.script)});
      return JSON.stringify(execute(pa));
    })()`);
    const handle = vm.unwrapResult(result);
    let raw: string;
    try {
      raw = vm.getString(handle);
    } finally {
      handle.dispose();
    }
    if (raw.length > 50000) throw new Error('Script result too large');
    const parsed = z
      .object({
        notify: z.boolean(),
        title: z.string().max(120),
        message: z.string().max(16000),
        state: z.record(z.string(), z.unknown()),
      })
      .parse(JSON.parse(raw));
    const state = JSON.stringify(parsed.state);
    if (state.length > 16000) throw new Error('Script state too large');
    return { ...outcomeSchema.parse(parsed), state };
  } finally {
    vm.dispose();
  }
}
