import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import {
  buildPendingUserInputAnswers,
  isPendingUserInputOptionSelected,
  setPendingUserInputCustomAnswer,
  togglePendingUserInputOptionSelection,
  type PendingUserInputDraftAnswer,
} from "@t3tools/client-runtime/state/pending-user-input";
import {
  derivePendingThreadRequests,
  type ThreadPendingApproval,
  type ThreadPendingUserInput,
} from "@t3tools/client-runtime/state/thread-requests";
import type { ProviderApprovalDecision } from "@t3tools/contracts";
import { T, useGT } from "gt-react";
import { useState } from "react";

import { useThreadProjection } from "../../state/entities";
import { threadEnvironment } from "../../state/threads";
import { useOrchestrationCommand } from "../../state/use-orchestration-command";

interface ApprovalChoice {
  readonly decision: ProviderApprovalDecision;
  readonly label: string;
  readonly warning?: string;
  readonly deny: boolean;
}

function approvalChoices(
  approval: ThreadPendingApproval,
  gt: ReturnType<typeof useGT>,
): ReadonlyArray<ApprovalChoice> {
  if (approval.options !== undefined && approval.options.length > 0) {
    return approval.options.map((option) => ({
      decision: option.decision,
      label: option.label,
      ...(option.warning === undefined ? {} : { warning: option.warning }),
      deny: option.decision === "decline" || option.decision === "cancel",
    }));
  }
  return [
    { decision: "accept", label: gt("Allow once"), deny: false },
    { decision: "acceptForSession", label: gt("Allow for session"), deny: false },
    { decision: "decline", label: gt("Deny"), deny: true },
  ];
}

function ApprovalActions(props: {
  readonly thread: EnvironmentThreadShell;
  readonly approval: ThreadPendingApproval;
}) {
  const gt = useGT();
  const respond = useOrchestrationCommand(threadEnvironment.respondToApproval, {
    reportFailure: false,
  });
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const { thread, approval } = props;
  const live = approval.responseCapability === "live";

  const submit = async (decision: ProviderApprovalDecision) => {
    setBusy(true);
    setFailed(false);
    const result = await respond({
      environmentId: thread.environmentId,
      input: { threadId: thread.id, requestId: approval.requestId, decision },
    });
    if (result._tag === "Failure") setFailed(true);
    setBusy(false);
  };

  return (
    <div data-now="actions">
      {approval.detail ? <pre data-now="detail">{approval.detail}</pre> : null}
      {approval.reason ? <span data-now="hint">{approval.reason}</span> : null}
      {live ? (
        <span data-now="buttons">
          {approvalChoices(approval, gt).map((choice) => (
            <button
              key={`${choice.decision}:${choice.label}`}
              type="button"
              data-now="act"
              data-deny={choice.deny}
              disabled={busy}
              onClick={() => void submit(choice.decision)}
            >
              {choice.label}
            </button>
          ))}
        </span>
      ) : (
        <span data-now="hint">
          <T>This request can only be answered in the thread.</T>
        </span>
      )}
      {approvalChoices(approval, gt)
        .flatMap((choice) => (choice.warning === undefined ? [] : [choice.warning]))
        .map((warning) => (
          <span key={warning} data-now="hint" data-error="true">
            {warning}
          </span>
        ))}
      {failed ? (
        <span data-now="hint" data-error="true">
          <T>Could not send the decision. Open the thread.</T>
        </span>
      ) : null}
    </div>
  );
}

function UserInputActions(props: {
  readonly thread: EnvironmentThreadShell;
  readonly input: ThreadPendingUserInput;
}) {
  const gt = useGT();
  const respond = useOrchestrationCommand(threadEnvironment.respondToUserInput, {
    reportFailure: false,
  });
  const [drafts, setDrafts] = useState<Record<string, PendingUserInputDraftAnswer>>({});
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const { thread, input } = props;
  const answerable = input.responseCapability !== "not_resumable";
  const answers = buildPendingUserInputAnswers(input.questions, drafts);

  const submit = async () => {
    if (answers === null) return;
    setBusy(true);
    setFailed(false);
    const result = await respond({
      environmentId: thread.environmentId,
      input: { threadId: thread.id, requestId: input.requestId, answers },
    });
    if (result._tag === "Failure") setFailed(true);
    setBusy(false);
  };

  if (!answerable) {
    return (
      <span data-now="hint">
        <T>This question can only be answered in the thread.</T>
      </span>
    );
  }

  return (
    <div data-now="actions">
      {input.questions.map((question) => (
        <div key={question.id} data-now="question">
          <span data-now="hint">{question.question}</span>
          <span data-now="buttons">
            {question.options.map((option) => {
              const value = option.value ?? option.label;
              return (
                <button
                  key={value}
                  type="button"
                  data-now="act"
                  data-selected={isPendingUserInputOptionSelected(
                    question,
                    drafts[question.id],
                    value,
                  )}
                  disabled={busy}
                  onClick={() =>
                    setDrafts((current) => ({
                      ...current,
                      [question.id]: togglePendingUserInputOptionSelection(
                        question,
                        current[question.id],
                        value,
                      ),
                    }))
                  }
                >
                  {option.label}
                </button>
              );
            })}
          </span>
          {question.options
            .filter((option) =>
              isPendingUserInputOptionSelected(
                question,
                drafts[question.id],
                option.value ?? option.label,
              ),
            )
            .map((option) => (
              <span key={option.label} data-now="hint">
                {option.description}
              </span>
            ))}
          {question.allowCustomAnswer !== false ? (
            <input
              data-now="field"
              placeholder={gt("Or type an answer")}
              value={drafts[question.id]?.customAnswer ?? ""}
              disabled={busy}
              onChange={(event) =>
                setDrafts((current) => ({
                  ...current,
                  [question.id]: setPendingUserInputCustomAnswer(
                    question,
                    current[question.id],
                    event.target.value,
                  ),
                }))
              }
              onKeyDown={(event) => {
                if (event.key === "Enter" && answers !== null) void submit();
              }}
            />
          ) : null}
        </div>
      ))}
      <span data-now="buttons">
        <button
          type="button"
          data-now="act"
          data-primary="true"
          disabled={busy || answers === null}
          onClick={() => void submit()}
        >
          <T>Send answer</T>
        </button>
      </span>
      {failed ? (
        <span data-now="hint" data-error="true">
          <T>Could not send the answer. Open the thread.</T>
        </span>
      ) : null}
    </div>
  );
}

/** The part of a needs-you card that answers the thread's pending request in place. */
export function NowNeedsActions(props: { readonly thread: EnvironmentThreadShell }) {
  const { thread } = props;
  const projection =
    useThreadProjection(scopeThreadRef(thread.environmentId, thread.id))?.projection ?? null;
  if (projection === null || projection.thread.id !== thread.id) {
    return (
      <span data-now="hint">
        <T>Loading request…</T>
      </span>
    );
  }
  const pending = derivePendingThreadRequests(projection);
  const approval = pending.approvals[0];
  if (approval !== undefined) return <ApprovalActions thread={thread} approval={approval} />;
  const input = pending.userInputs[0];
  if (input !== undefined) return <UserInputActions thread={thread} input={input} />;
  return null;
}
