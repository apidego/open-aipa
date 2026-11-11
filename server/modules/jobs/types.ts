import { z } from 'zod';
import type { Schedule } from './schedule.js';
export type JobKind = 'automation' | 'task';
export interface Job {
  id: string;
  user_id: string;
  kind: JobKind;
  name: string;
  description: string;
  input_prompt: string;
  prompt: string;
  script: string | null;
  schedule: string;
  channel: string;
  notification_mode: 'always' | 'conditional';
  allow_ai: number;
  status: 'draft' | 'active' | 'paused' | 'completed';
  next_run: number | null;
  script_state: string;
  created_at: number;
}
export const outcomeSchema = z.object({
  notify: z.boolean(),
  title: z.string().max(120),
  message: z.string().max(16000),
});
export type Outcome = z.infer<typeof outcomeSchema>;
export interface Plan {
  clarification: string | null;
  name: string;
  description: string;
  prompt: string;
  script: string | null;
  schedule: Schedule;
  channel: string;
  notificationMode: 'always' | 'conditional';
}
export type PlanJob = (
  userId: string,
  kind: JobKind,
  prompt: string,
  timezone: string,
  allowAI: boolean,
) => Promise<Plan>;
