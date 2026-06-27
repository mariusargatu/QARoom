------------------------------- MODULE Dedup -------------------------------
(***************************************************************************)
(* A TLA+ model of the at-least-once consumer dedup protocol (QARoom       *)
(* Milestone 4, Commitment 17; verifiable-invariants ADR-0024 Phase 3; T19)*)
(*                                                                         *)
(* The committed-state twin of packages/messaging/src/dedup.ts             *)
(* (alreadyProcessed / markProcessed) and the consume path that wraps a    *)
(* handler's effects + the processed_events insert in ONE transaction.     *)
(* JetStream delivers a given Nats-Msg-Id AT LEAST ONCE — the broker may   *)
(* redeliver an event any number of times. Dedup makes the EFFECT happen   *)
(* exactly once anyway:                                                     *)
(*                                                                         *)
(*   deliver, ~recorded  -->  apply effect + record   (atomic, one tx)      *)
(*   deliver,  recorded  -->  skip (no effect)         (the dedup guard)     *)
(*                                                                         *)
(* MaxDeliveries bounds the broker's redelivery so the state space is       *)
(* finite; the protocol must hold for every redelivery count up to it.      *)
(*                                                                         *)
(* The same safety relation is enforced AT THE REAL BOUNDARY by             *)
(* packages/messaging/src/dedup-invariant.ts (assertIdempotentApply), which *)
(* throws if a handler tries to APPLY an effect for an already-recorded     *)
(* event — a double-apply. See spec/tla/README.md.                          *)
(***************************************************************************)
EXTENDS Naturals

CONSTANT MaxDeliveries      \* upper bound on how many times the broker redelivers the event

ASSUME MaxDeliveries \in Nat /\ MaxDeliveries >= 1

VARIABLES
    recorded,               \* is (subscription, event) present in processed_events?
    applied,                \* how many times the handler EFFECT ran (the dedup target: <= 1)
    delivered               \* how many times the broker has delivered the event so far

vars == <<recorded, applied, delivered>>

TypeOK ==
    /\ recorded \in BOOLEAN
    /\ applied \in 0..MaxDeliveries
    /\ delivered \in 0..MaxDeliveries

Init ==
    /\ recorded = FALSE
    /\ applied = 0
    /\ delivered = 0

(* One broker delivery. The receiver's first sight of the event applies the effect and records   *)
(* it in the SAME transaction (markProcessed alongside the handler); any later redelivery is a    *)
(* recognised duplicate and is skipped, so the effect never runs twice.                           *)
Deliver ==
    /\ delivered < MaxDeliveries
    /\ delivered' = delivered + 1
    /\ \/ /\ ~recorded                      \* first sight: apply + record, atomically
          /\ applied' = applied + 1
          /\ recorded' = TRUE
       \/ /\ recorded                       \* duplicate: the dedup guard skips it
          /\ UNCHANGED <<applied, recorded>>

(***************************************************************************)
(* SPEC-LEVEL FALSIFIER (mirrors deleting markProcessed — the Milestone-4   *)
(* dedup deliberate-bug). Uncomment BugDeliver and add it to Next: it       *)
(* applies the effect on EVERY delivery without ever recording, so a        *)
(* redelivered event re-runs the effect and TLC finds a trace violating     *)
(* NoDoubleApply — the model twin of the bug the duplicate-delivery         *)
(* property test catches in code. See README.md.                            *)
(***************************************************************************)
\* BugDeliver ==
\*     /\ delivered < MaxDeliveries
\*     /\ delivered' = delivered + 1
\*     /\ applied' = applied + 1
\*     /\ UNCHANGED recorded

Next == Deliver
\* Next == Deliver \/ BugDeliver   \* <- the falsifier variant

Spec == Init /\ [][Next]_vars /\ WF_vars(Deliver)

----------------------------------------------------------------------------
(* INVARIANTS *)

\* The dedup guarantee: an at-least-once-delivered event applies its effect AT MOST ONCE,
\* no matter how many times the broker redelivers it.
NoDoubleApply == applied <= 1

\* Apply and record are one atomic transaction: the event is recorded exactly when its effect
\* has run once — never recorded-without-applying, never applied-without-recording.
RecordedIffApplied == recorded <=> (applied = 1)

(* TEMPORAL *)

\* A delivered event is eventually processed: under weak fairness the first delivery records it,
\* and from then on it stays recorded (later redeliveries are skips) — no event is abandoned.
EventuallyProcessed == <>recorded

=============================================================================
