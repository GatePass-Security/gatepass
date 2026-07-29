/**
 * Audited outbound writer (Constitution Principle III, SC-005). EVERY external write — PR
 * comment, check run, evidence push, suggested-fix pull request — must go through this
 * writer, which records an append-only AuditEvent.
 *
 * `fix_pr` is the one action that touches a customer repository's contents, and it exists
 * under a deliberately narrow rule (Principle III, as amended): a suggested-fix pull request
 * is opened only on an explicit human request against an org that opted in, only onto a NEW
 * branch, never onto the default branch, never force-pushed, and never touching CI
 * configuration. The audit event is what makes that claim checkable after the fact rather
 * than merely asserted — its subject records the repo, the branch, and every path written.
 *
 * There is still no action here for writing CI configuration, and there must never be one.
 */

export type AuditAction =
  "pr_comment" | "check_run" | "evidence_push" | "questionnaire_export" | "public_report" | "fix_pr";

export interface AuditEvent {
  seq: number;
  at: string;
  orgId: string | null;
  actor: string;
  action: AuditAction;
  subject: Record<string, unknown>;
}

export interface AuditSink {
  append(event: AuditEvent): void | Promise<void>;
}

/** In-memory sink (tests / dev). Production swaps in an append-only DB-backed sink. */
export class InMemoryAuditSink implements AuditSink {
  readonly events: AuditEvent[] = [];
  append(event: AuditEvent): void {
    this.events.push(event);
  }
}

export class AuditedWriter {
  private seq = 0;
  constructor(
    private readonly sink: AuditSink,
    private readonly actor: string,
  ) {}

  /**
   * Perform an outbound write through `fn`, recording an audit event. `action` is a closed
   * set that excludes any code/CI mutation. Returns fn's result.
   */
  async write<T>(
    action: AuditAction,
    orgId: string | null,
    subject: Record<string, unknown>,
    fn: () => Promise<T> | T,
  ): Promise<T> {
    const result = await fn();
    await this.sink.append({
      seq: ++this.seq,
      at: new Date().toISOString(),
      orgId,
      actor: this.actor,
      action,
      subject,
    });
    return result;
  }
}
