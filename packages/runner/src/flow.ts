import { FlowManifestSchema, type Binding, type FlowManifest, type GateResult, type HumanGate, type StepOptions } from '@sctech/profilevault-contract';
import type { Page } from 'playwright';
import type { SafeUi } from './safe-ui.js';

export interface Validator<T = unknown> { parse(input: unknown): T }
export interface FlowContext<I = unknown> {
  input: I; mode: 'L2' | 'L3' | null; binding: Binding; page: Page; state: Record<string, unknown>;
  step<T>(name: string, fn: () => Promise<T>, opts?: StepOptions): Promise<T>;
  ui: SafeUi;
  humanGate(gate: HumanGate): Promise<GateResult>;
  fail(code: string, message: string, detail?: Record<string, unknown>): never;
  log(message: string, data?: Record<string, unknown>): void;
  artifact(name: string, data: Buffer | string): Promise<string>;
}
export interface FlowDefinition<I = unknown, O = unknown> { manifest: FlowManifest; input: Validator<I>; output: Validator<O>; run(ctx: FlowContext<I>): Promise<O> }
export function defineFlow<I, O>(manifest: Omit<FlowManifest, 'modes' | 'countsAsUpload' | 'errors'> & Partial<Pick<FlowManifest, 'modes' | 'countsAsUpload' | 'errors'>>, input: Validator<I>, output: Validator<O>, run: (ctx: FlowContext<I>) => Promise<O>): FlowDefinition<I, O> {
  return { manifest: FlowManifestSchema.parse(manifest), input, output, run };
}
