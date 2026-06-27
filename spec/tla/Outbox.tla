------------------------------- MODULE Outbox ------------------------------
(***************************************************************************)
(* A TLA+ model of one event through the transactional outbox + relay      *)
(* (QARoom Milestone 4, Commitment 17; verifiable-invariants ADR-0024      *)
(* Phase 3; T19).                                                          *)
(*                                                                         *)
(* The committed-state twin of packages/messaging/src/outbox.ts            *)
(* (outboxPublish, written in the business transaction) and                *)
(* packages/messaging/src/relay.ts (createRelay/drainOnce, which selects   *)
(* unpublished rows FOR UPDATE SKIP LOCKED, publishes each to NATS, then    *)
(* stamps published_at). The lifecycle of one event:                       *)
(*                                                                         *)
(*   BusinessCommit  : the row appears atomically with the business write   *)
(*   RelayPublishFail: NATS rejected; attempts++, row stays pending (retry) *)
(*   RelayPublishOk  : NATS accepted the publish                            *)
(*   RelayMarkSent   : relay stamps published_at (UPDATE outbox)            *)
(*                                                                         *)
(* MaxAttempts bounds transient publish failures so the model is finite     *)
(* and the broker eventually accepts (the at-least-once liveness premise).  *)
(*                                                                         *)
(* The same at-least-once edge relation is enforced AT THE REAL BOUNDARY by *)
(* packages/messaging/src/outbox-invariant.ts (assertLegalOutboxCommit),    *)
(* which rejects marking a row sent without a successful publish — the      *)
(* lost-event bug. See spec/tla/README.md.                                  *)
(***************************************************************************)
EXTENDS Naturals

CONSTANT MaxAttempts        \* upper bound on transient publish failures before the broker accepts

ASSUME MaxAttempts \in Nat /\ MaxAttempts >= 1

VARIABLES
    committed,              \* did the business transaction commit (outbox row exists)?
    published,              \* did a real NATS publish succeed?
    markedSent,             \* did the relay stamp published_at?
    attempts                \* transient publish-failure count (0 .. MaxAttempts)

vars == <<committed, published, markedSent, attempts>>

TypeOK ==
    /\ committed \in BOOLEAN
    /\ published \in BOOLEAN
    /\ markedSent \in BOOLEAN
    /\ attempts \in 0..MaxAttempts

Init ==
    /\ committed = FALSE
    /\ published = FALSE
    /\ markedSent = FALSE
    /\ attempts = 0

\* The business write and the outbox insert share one transaction: the row becomes visible to
\* the relay only after the business state commits.
BusinessCommit ==
    /\ ~committed
    /\ committed' = TRUE
    /\ UNCHANGED <<published, markedSent, attempts>>

\* A transient publish failure leaves the row pending (attempts++) for the next drain — never lost.
RelayPublishFail ==
    /\ committed
    /\ ~published
    /\ attempts < MaxAttempts
    /\ attempts' = attempts + 1
    /\ UNCHANGED <<committed, published, markedSent>>

\* The publish succeeds: NATS accepted the event.
RelayPublishOk ==
    /\ committed
    /\ ~published
    /\ published' = TRUE
    /\ UNCHANGED <<committed, markedSent, attempts>>

\* The relay stamps published_at — only AFTER a successful publish (at-least-once).
RelayMarkSent ==
    /\ published
    /\ ~markedSent
    /\ markedSent' = TRUE
    /\ UNCHANGED <<committed, published, attempts>>

(***************************************************************************)
(* SPEC-LEVEL FALSIFIER (an outbox drop-on-fail bug). Uncomment             *)
(* BugMarkSentOnFail and add it to Next: it stamps published_at WITHOUT a   *)
(* successful publish, so the event is reported delivered but never reached *)
(* NATS — TLC finds a trace violating SentImpliesPublished. The runtime     *)
(* twin: assertLegalOutboxCommit('Pending','Sent', publishOk=FALSE) throws. *)
(***************************************************************************)
\* BugMarkSentOnFail ==
\*     /\ committed
\*     /\ ~published
\*     /\ ~markedSent
\*     /\ markedSent' = TRUE
\*     /\ UNCHANGED <<committed, published, attempts>>

Next ==
    \/ BusinessCommit
    \/ RelayPublishFail
    \/ RelayPublishOk
    \/ RelayMarkSent
\*     \/ BugMarkSentOnFail   \* <- the falsifier variant

Spec == Init /\ [][Next]_vars /\ WF_vars(Next)

----------------------------------------------------------------------------
(* INVARIANTS *)

\* The transactional-outbox guarantee: an event is published only after its business write
\* committed — the relay never sees, and never publishes, an uncommitted event.
PublishedImpliesCommitted == published => committed

\* At-least-once: a row is marked sent (published_at stamped) only after a REAL publish — an
\* event is never reported delivered while still unsent. This is the lost-event guard.
SentImpliesPublished == markedSent => published

(* TEMPORAL *)

\* Every committed event is eventually marked sent: under weak fairness, transient publish
\* failures are bounded, so the publish eventually succeeds and the relay stamps it — no event
\* is stranded in the outbox.
EventuallyDelivered == <>markedSent

\* The leads-to form: once committed, delivery (mark-sent) is inevitable.
CommitLeadsToSent == committed ~> markedSent

=============================================================================
