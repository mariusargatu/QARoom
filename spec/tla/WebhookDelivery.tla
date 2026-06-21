-------------------------- MODULE WebhookDelivery --------------------------
(***************************************************************************)
(* A TLA+ model of one webhook delivery's lifecycle (QARoom Milestone 11,  *)
(* ADR-0019; verifiable-invariants experiment Phase 3, ADR-0024).          *)
(*                                                                         *)
(* This proves the at-least-once / terminal-reachability protocol that the *)
(* TYPE SYSTEM cannot express, under all interleavings of attempt/fail/    *)
(* retry/exhaust — the concurrency invariant behind the delivery worker    *)
(* (services/webhooks/src/worker.ts) and the hand-authored XState machine  *)
(* (packages/contracts/src/machines/webhook-delivery.machine.ts).          *)
(*                                                                         *)
(* The model is the COMMITTED-state projection: the in-memory              *)
(* AttemptStarted --> Delivering leg is not persisted, so a crash before   *)
(* the DB commit simply leaves the row in Pending/Retrying (the worker's   *)
(* transaction rolls back) and the delivery is re-claimed — at-least-once. *)
(* The committed edges therefore collapse to:                              *)
(*                                                                         *)
(*   Pending  | Retrying  --2xx-->            Delivered     (terminal)      *)
(*   Pending  | Retrying  --fail, budget-->   Retrying                      *)
(*   Pending  | Retrying  --fail, exhausted-> DeadLettered  (terminal)      *)
(*                                                                         *)
(* This same legal-edge relation is enforced AT THE REAL BOUNDARY by       *)
(* services/webhooks/src/delivery-invariant.ts (assertLegalDeliveryCommit, *)
(* called before every persist), so the model and the code are connected,  *)
(* not parallel. See spec/tla/README.md.                                   *)
(***************************************************************************)
EXTENDS Naturals

CONSTANT MaxAttempts        \* = WEBHOOK_RETRY_POLICY.max_attempts (contracts/webhook-retry.ts)

ASSUME MaxAttempts \in Nat /\ MaxAttempts >= 1

VARIABLES
    status,                 \* the committed webhook_deliveries.status
    attempts,               \* committed attempt count (0 .. MaxAttempts)
    delivered               \* TRUE only if a real 2xx caused the Delivered state

vars == <<status, attempts, delivered>>

Terminal == {"Delivered", "DeadLettered"}
States   == {"Pending", "Delivering", "Retrying"} \union Terminal

TypeOK ==
    /\ status \in States
    /\ attempts \in 0..MaxAttempts
    /\ delivered \in BOOLEAN

Init ==
    /\ status = "Pending"
    /\ attempts = 0
    /\ delivered = FALSE

(* One committed attempt from a re-claimable state. The receiver's response is the source of   *)
(* nondeterminism: it either accepts (2xx) or fails; on failure the attempt budget decides       *)
(* between another retry and dead-lettering.                                                     *)
Attempt ==
    /\ status \in {"Pending", "Retrying"}
    /\ \/ /\ status' = "Delivered"                 \* receiver returned 2xx
          /\ delivered' = TRUE
          /\ UNCHANGED attempts
       \/ /\ attempts + 1 < MaxAttempts            \* failed, budget remains
          /\ status' = "Retrying"
          /\ attempts' = attempts + 1
          /\ UNCHANGED delivered
       \/ /\ attempts + 1 >= MaxAttempts           \* failed, budget exhausted
          /\ status' = "DeadLettered"
          /\ attempts' = attempts + 1
          /\ UNCHANGED delivered

(***************************************************************************)
(* SPEC-LEVEL FALSIFIER (mirrors the CHAOS_WEBHOOK_DROP_ON_FAIL toggle).    *)
(* Uncomment DropOnFail and add it to Next: it marks a FAILED send as       *)
(* Delivered WITHOUT a 2xx, so TLC finds a trace violating NoSilentDrop —   *)
(* the model-level twin of the deliberate-bug demo the at-least-once        *)
(* property test catches in code. See README.md.                           *)
(***************************************************************************)
\* DropOnFail ==
\*     /\ status \in {"Pending", "Retrying"}
\*     /\ status' = "Delivered"
\*     /\ delivered' = FALSE
\*     /\ UNCHANGED attempts

Next == Attempt
\* Next == Attempt \/ DropOnFail   \* <- the falsifier variant

Spec == Init /\ [][Next]_vars /\ WF_vars(Attempt)

----------------------------------------------------------------------------
(* INVARIANTS *)

\* A delivery is reported Delivered only when a real 2xx happened — never silently dropped.
NoSilentDrop == (status = "Delivered") => delivered

\* Dead-lettering happens only once the full attempt budget is spent — never a premature give-up.
ExhaustionLegit == (status = "DeadLettered") => (attempts = MaxAttempts)

\* At-least-once spine: a non-terminal delivery is never stuck — Attempt is always enabled, so the
\* worker can always make progress (a crash just leaves it re-claimable).
NoStuckDelivery == (status \notin Terminal) => ENABLED Attempt

(* TEMPORAL *)

\* Under weak fairness on Attempt and a bounded budget, every delivery eventually reaches a
\* terminal state — no event is abandoned mid-flight.
EventuallyTerminal == <>(status \in Terminal)

=============================================================================
